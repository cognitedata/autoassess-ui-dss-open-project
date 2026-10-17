import type { CogniteClient, FileInfo } from '@cognite/sdk';

import { AUTOASSESS_SPACE } from '../../../shared/cdf/dataModel';

/**
 * A mesh as a CDF CAD model, built by `dss worker` / `dss campaign build-3d-model`.
 *
 * Every mesh file (CogniteFile) has its own model, stored as Core DM nodes whose ids derive
 * from the file's external id: `{file}-cad-model` (CogniteCADModel: classic 3D model id and
 * collision-proxy file id in its tags, palette in its description) and `{file}-cad-revision`
 * (CogniteCADRevision with the classic revision id). A campaign shows the models of the
 * files its `cdfFileIds` lists right now, so a file moved to another campaign takes its model.
 *
 * Models built before that are keyed by campaign (`{campaign}-cad-model`); one is shown for
 * the campaign's meshes that were uploaded before it and have no model of their own.
 */
export interface CampaignCadModel {
  /** Unique per rendered model: `{campaign}/{model node externalId}`. */
  key: string;
  campaignExternalId: string;
  /** The mesh file this model was built from; null for a legacy campaign-keyed model. */
  sourceFileId: number | null;
  modelId: number;
  revisionId: number;
  status: string;
  /** Numeric id of the decimated PLY used for picking, surface normals and image rays. */
  collisionProxyFileId: number;
  hasTexture: boolean;
  /** CAD node (OBJ group) name → segment colour, for the "defects" colour mode. */
  palette: Record<string, [number, number, number]>;
  /**
   * Segment colour (lowercase 6-digit hex, no `#`) → class name (for example "manhole"),
   * from a `mesh_legend.json` or the default NTNU convention at build time. Empty for
   * models built before legends existed.
   */
  legend: Record<string, string>;
}

/** A campaign and the mesh files it lists (`cdfFileIds`). */
export interface CampaignMeshes {
  externalId: string;
  cdfFileIds: number[];
}

export interface MeshWithoutModel {
  campaignExternalId: string;
  fileId: number;
}

export interface CampaignCadModels {
  models: CampaignCadModel[];
  /** Meshes no model shows yet (waiting for `dss worker`, or never built). */
  meshesWithoutModel: MeshWithoutModel[];
}

/** Model state of one mesh file, for the edit-campaign dialog. */
export type FileModelStatus = 'ready' | 'processing' | 'failed' | 'campaign-model' | 'none';

export interface CampaignCadModelService {
  listForCampaigns(campaigns: CampaignMeshes[]): Promise<CampaignCadModels>;
  /** Per mesh file: its own model's state, else whether its campaign's legacy model shows it. */
  modelStatusForFiles(files: { fileId: number; campaignExternalId: string | null }[]): Promise<Map<number, FileModelStatus>>;
}

const CAD_MODEL_VIEW = { type: 'view', space: 'cdf_cdm', externalId: 'CogniteCADModel', version: 'v1' } as const;
const CAD_REVISION_VIEW = { type: 'view', space: 'cdf_cdm', externalId: 'CogniteCADRevision', version: 'v1' } as const;
const MAX_EXTERNAL_ID = 255;
const CHUNK = 1000;

/** Only the part of the SDK this service needs — keeps test doubles honest. */
export type CadModelSdk = {
  instances: Pick<CogniteClient['instances'], 'retrieve'>;
  files: Pick<CogniteClient['files'], 'retrieve'>;
};

/** `base + suffix`, cut to CDF's 255-character limit exactly like the SDK's `derived_id`. */
export function derivedId(base: string, suffix: string): string {
  return base.slice(0, MAX_EXTERNAL_ID - suffix.length) + suffix;
}

type ParsedModel = Omit<CampaignCadModel, 'key' | 'campaignExternalId'> & { nodeId: string; createdTime: number };

type ResolvedCampaign = {
  campaign: string;
  legacy: ParsedModel | undefined;
  files: { fileId: number; own: ParsedModel | undefined; coveredByLegacy: boolean }[];
};

export class CdfCampaignCadModelService implements CampaignCadModelService {
  constructor(private readonly client: CadModelSdk) {}

  async listForCampaigns(campaigns: CampaignMeshes[]): Promise<CampaignCadModels> {
    const models: CampaignCadModel[] = [];
    const meshesWithoutModel: MeshWithoutModel[] = [];
    for (const { campaign, files, legacy } of await this.resolve(campaigns, true)) {
      let showLegacy = false;
      for (const { fileId, own, coveredByLegacy } of files) {
        if (own) models.push(toCampaignModel(campaign, own));
        else if (coveredByLegacy) showLegacy = true;
        else meshesWithoutModel.push({ campaignExternalId: campaign, fileId });
      }
      if (showLegacy && legacy) models.push(toCampaignModel(campaign, legacy));
    }
    return { models, meshesWithoutModel };
  }

  async modelStatusForFiles(
    files: { fileId: number; campaignExternalId: string | null }[],
  ): Promise<Map<number, FileModelStatus>> {
    const byCampaign = new Map<string, number[]>();
    for (const { fileId, campaignExternalId } of files) {
      const key = campaignExternalId ?? '';
      byCampaign.set(key, [...(byCampaign.get(key) ?? []), fileId]);
    }
    const unassigned = byCampaign.get('') ?? [];
    byCampaign.delete('');
    const campaigns = [...byCampaign].map(([externalId, cdfFileIds]) => ({ externalId, cdfFileIds }));
    const resolved = [
      ...(await this.resolve(campaigns, true)),
      ...(await this.resolve([{ externalId: '', cdfFileIds: unassigned }], false)),
    ];
    const statuses = new Map<number, FileModelStatus>();
    for (const { files: entries } of resolved) {
      for (const { fileId, own, coveredByLegacy } of entries) {
        statuses.set(fileId, own ? ownStatus(own.status) : coveredByLegacy ? 'campaign-model' : 'none');
      }
    }
    return statuses;
  }

  /** Per campaign and mesh file: the file's own model, or whether the legacy model covers it. */
  private async resolve(campaigns: CampaignMeshes[], withLegacy: boolean): Promise<ResolvedCampaign[]> {
    const withMeshes = campaigns.filter((c) => c.cdfFileIds.length > 0);
    if (withMeshes.length === 0) return [];
    const files = await this.retrieveFiles([...new Set(withMeshes.flatMap((c) => c.cdfFileIds))]);
    const [perFile, legacy] = await Promise.all([
      this.find([...new Set([...files.values()].map((f) => f.xid))]),
      withLegacy ? this.find(withMeshes.map((c) => c.externalId)) : Promise.resolve(new Map<string, ParsedModel>()),
    ]);
    return withMeshes.map((campaign) => {
      const legacyModel = legacy.get(campaign.externalId);
      return {
        campaign: campaign.externalId,
        legacy: legacyModel,
        files: campaign.cdfFileIds.map((fileId) => {
          const file = files.get(fileId);
          const own = file ? perFile.get(file.xid) : undefined;
          const coveredByLegacy = !own && legacyModel !== undefined &&
            (!file || (file.createdTime > 0 && file.createdTime <= legacyModel.createdTime));
          return { fileId, own, coveredByLegacy };
        }),
      };
    });
  }

  /** Numeric file id → CogniteFile external id + created time (classic files are left out). */
  private async retrieveFiles(fileIds: number[]): Promise<Map<number, { xid: string; createdTime: number }>> {
    const found = new Map<number, { xid: string; createdTime: number }>();
    for (let i = 0; i < fileIds.length; i += CHUNK) {
      const infos: FileInfo[] = await this.client.files.retrieve(
        fileIds.slice(i, i + CHUNK).map((id) => ({ id })),
        { ignoreUnknownIds: true },
      );
      for (const info of infos) {
        if (info.instanceId) {
          found.set(info.id, { xid: info.instanceId.externalId, createdTime: new Date(info.createdTime).getTime() || 0 });
        }
      }
    }
    return found;
  }

  /** Model + revision nodes for each base id (file xid or campaign id), keyed by that base. */
  private async find(baseIds: string[]): Promise<Map<string, ParsedModel>> {
    if (baseIds.length === 0) return new Map();
    const [models, revisions] = await Promise.all([
      this.retrieve(baseIds.map((id) => derivedId(id, '-cad-model')), CAD_MODEL_VIEW),
      this.retrieve(baseIds.map((id) => derivedId(id, '-cad-revision')), CAD_REVISION_VIEW),
    ]);
    const found = new Map<string, ParsedModel>();
    for (const base of baseIds) {
      const nodeId = derivedId(base, '-cad-model');
      const parsed = parseModel(nodeId, models.get(nodeId), revisions.get(derivedId(base, '-cad-revision')));
      if (parsed) found.set(base, parsed);
    }
    return found;
  }

  private async retrieve(
    externalIds: string[],
    view: typeof CAD_MODEL_VIEW | typeof CAD_REVISION_VIEW,
  ): Promise<Map<string, { props: Record<string, unknown>; createdTime: number }>> {
    const key = `${view.externalId}/${view.version}`;
    const found = new Map<string, { props: Record<string, unknown>; createdTime: number }>();
    for (let i = 0; i < externalIds.length; i += CHUNK) {
      const response = await this.client.instances.retrieve({
        items: externalIds
          .slice(i, i + CHUNK)
          .map((externalId) => ({ instanceType: 'node' as const, space: AUTOASSESS_SPACE, externalId })),
        sources: [{ source: view }],
      });
      for (const item of response.items) {
        found.set(item.externalId, {
          props: (item.properties?.[view.space]?.[key] ?? {}) as Record<string, unknown>,
          createdTime: item.createdTime,
        });
      }
    }
    return found;
  }
}

// ---- Internal helpers ----

function ownStatus(status: string): FileModelStatus {
  if (status === 'Done') return 'ready';
  if (status === 'Failed') return 'failed';
  return 'processing';
}

function toCampaignModel(campaignExternalId: string, parsed: ParsedModel): CampaignCadModel {
  const { nodeId, createdTime: _createdTime, ...model } = parsed;
  return { key: `${campaignExternalId}/${nodeId}`, campaignExternalId, ...model };
}

function parseModel(
  nodeId: string,
  model: { props: Record<string, unknown>; createdTime: number } | undefined,
  revision: { props: Record<string, unknown> } | undefined,
): ParsedModel | null {
  if (!model || !revision) return null;
  const tags = Array.isArray(model.props.tags) ? model.props.tags.map(String) : [];
  const modelId = idFromTags(tags, 'threeDModelId');
  const proxyId = idFromTags(tags, 'collisionProxyFileId');
  const revisionId = typeof revision.props.revisionId === 'number' ? revision.props.revisionId : null;
  if (modelId === null || proxyId === null || revisionId === null || !Number.isSafeInteger(revisionId)) {
    return null;
  }
  const { palette, hasTexture, legend } = parseDescription(model.props.description);
  return {
    nodeId,
    createdTime: model.createdTime,
    sourceFileId: idFromTags(tags, 'sourceFileId'),
    modelId,
    revisionId,
    status: String(revision.props.status ?? ''),
    collisionProxyFileId: proxyId,
    hasTexture,
    palette,
    legend,
  };
}

function idFromTags(tags: string[], name: string): number | null {
  const tag = tags.find((t) => t.startsWith(`${name}:`));
  if (!tag) return null;
  const value = Number(tag.slice(name.length + 1));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseDescription(description: unknown): Pick<CampaignCadModel, 'palette' | 'hasTexture' | 'legend'> {
  try {
    const parsed = JSON.parse(String(description)) as { palette?: unknown; hasTexture?: unknown; legend?: unknown };
    const palette: CampaignCadModel['palette'] = {};
    if (parsed.palette && typeof parsed.palette === 'object') {
      for (const [name, rgb] of Object.entries(parsed.palette as Record<string, unknown>)) {
        if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((c) => typeof c === 'number')) {
          palette[name] = [rgb[0], rgb[1], rgb[2]];
        }
      }
    }
    return { palette, hasTexture: parsed.hasTexture === true, legend: parseLegend(parsed.legend) };
  } catch {
    return { palette: {}, hasTexture: false, legend: {} };
  }
}

/** Colour → class-name legend from the description; malformed entries are dropped. */
function parseLegend(raw: unknown): Record<string, string> {
  const legend: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return legend;
  for (const [key, name] of Object.entries(raw as Record<string, unknown>)) {
    const hex = /^#?([0-9a-f]{6})$/.exec(key.trim().toLowerCase())?.[1];
    if (hex && typeof name === 'string' && name.trim().length > 0) legend[hex] = name.trim();
  }
  return legend;
}
