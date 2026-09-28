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

export interface CampaignCadModelService {
  listForCampaigns(campaigns: CampaignMeshes[]): Promise<CampaignCadModels>;
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

export class CdfCampaignCadModelService implements CampaignCadModelService {
  constructor(private readonly client: CadModelSdk) {}

  async listForCampaigns(campaigns: CampaignMeshes[]): Promise<CampaignCadModels> {
    const withMeshes = campaigns.filter((c) => c.cdfFileIds.length > 0);
    if (withMeshes.length === 0) return { models: [], meshesWithoutModel: [] };

    const files = await this.retrieveFiles([...new Set(withMeshes.flatMap((c) => c.cdfFileIds))]);
    const fileXids = [...new Set([...files.values()].map((f) => f.xid))];
    const [perFile, legacy] = await Promise.all([
      this.find(fileXids),
      this.find(withMeshes.map((c) => c.externalId)),
    ]);

    const models: CampaignCadModel[] = [];
    const meshesWithoutModel: MeshWithoutModel[] = [];
    for (const campaign of withMeshes) {
      const legacyModel = legacy.get(campaign.externalId);
      let showLegacy = false;
      for (const fileId of campaign.cdfFileIds) {
        const file = files.get(fileId);
        const own = file ? perFile.get(file.xid) : undefined;
        if (own) {
          models.push(toCampaignModel(campaign.externalId, own));
        } else if (legacyModel && (!file || (file.createdTime > 0 && file.createdTime <= legacyModel.createdTime))) {
          showLegacy = true;
        } else {
          meshesWithoutModel.push({ campaignExternalId: campaign.externalId, fileId });
        }
      }
      if (showLegacy && legacyModel) models.push(toCampaignModel(campaign.externalId, legacyModel));
    }
    return { models, meshesWithoutModel };
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
  const { palette, hasTexture } = parseDescription(model.props.description);
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
  };
}

function idFromTags(tags: string[], name: string): number | null {
  const tag = tags.find((t) => t.startsWith(`${name}:`));
  if (!tag) return null;
  const value = Number(tag.slice(name.length + 1));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseDescription(description: unknown): Pick<CampaignCadModel, 'palette' | 'hasTexture'> {
  try {
    const parsed = JSON.parse(String(description)) as { palette?: unknown; hasTexture?: unknown };
    const palette: CampaignCadModel['palette'] = {};
    if (parsed.palette && typeof parsed.palette === 'object') {
      for (const [name, rgb] of Object.entries(parsed.palette as Record<string, unknown>)) {
        if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((c) => typeof c === 'number')) {
          palette[name] = [rgb[0], rgb[1], rgb[2]];
        }
      }
    }
    return { palette, hasTexture: parsed.hasTexture === true };
  } catch {
    return { palette: {}, hasTexture: false };
  }
}
