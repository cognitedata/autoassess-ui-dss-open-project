import type { CogniteClient } from '@cognite/sdk';

import { AUTOASSESS_SPACE } from '../../../shared/cdf/dataModel';

/**
 * A campaign's mesh as a CDF CAD model (built by `dss campaign upload` / `build-3d-model`).
 *
 * Stored as Core DM nodes with deterministic ids: `{campaign}-cad-model` (CogniteCADModel,
 * classic 3D model id + collision-proxy file id in its tags, palette in its description)
 * and `{campaign}-cad-revision` (CogniteCADRevision with the classic revision id).
 */
export interface CampaignCadModel {
  campaignExternalId: string;
  modelId: number;
  revisionId: number;
  status: string;
  /** Numeric id of the decimated PLY used for picking, surface normals and image rays. */
  collisionProxyFileId: number;
  hasTexture: boolean;
  /** CAD node (OBJ group) name → segment colour, for the "defects" colour mode. */
  palette: Record<string, [number, number, number]>;
}

export interface CampaignCadModelService {
  listForCampaigns(campaignExternalIds: string[]): Promise<CampaignCadModel[]>;
}

const CAD_MODEL_VIEW = { type: 'view', space: 'cdf_cdm', externalId: 'CogniteCADModel', version: 'v1' } as const;
const CAD_REVISION_VIEW = { type: 'view', space: 'cdf_cdm', externalId: 'CogniteCADRevision', version: 'v1' } as const;

/** Only the part of the SDK this service needs — keeps test doubles honest. */
export type InstancesRetriever = { instances: Pick<CogniteClient['instances'], 'retrieve'> };

export class CdfCampaignCadModelService implements CampaignCadModelService {
  constructor(private readonly client: InstancesRetriever) {}

  async listForCampaigns(campaignExternalIds: string[]): Promise<CampaignCadModel[]> {
    if (campaignExternalIds.length === 0) return [];
    const [models, revisions] = await Promise.all([
      this.retrieve(campaignExternalIds.map((id) => `${id}-cad-model`), CAD_MODEL_VIEW),
      this.retrieve(campaignExternalIds.map((id) => `${id}-cad-revision`), CAD_REVISION_VIEW),
    ]);
    return campaignExternalIds.flatMap((campaign) => {
      const model = models.get(`${campaign}-cad-model`);
      const revision = revisions.get(`${campaign}-cad-revision`);
      if (!model || !revision) return [];
      const tags = Array.isArray(model.tags) ? model.tags.map(String) : [];
      const modelId = idFromTags(tags, 'threeDModelId');
      const proxyId = idFromTags(tags, 'collisionProxyFileId');
      const revisionId = typeof revision.revisionId === 'number' ? revision.revisionId : null;
      if (modelId === null || proxyId === null || revisionId === null || !Number.isSafeInteger(revisionId)) {
        return [];
      }
      const { palette, hasTexture } = parseDescription(model.description);
      return [
        {
          campaignExternalId: campaign,
          modelId,
          revisionId,
          status: String(revision.status ?? ''),
          collisionProxyFileId: proxyId,
          hasTexture,
          palette,
        },
      ];
    });
  }

  private async retrieve(
    externalIds: string[],
    view: typeof CAD_MODEL_VIEW | typeof CAD_REVISION_VIEW,
  ): Promise<Map<string, Record<string, unknown>>> {
    const response = await this.client.instances.retrieve({
      items: externalIds.map((externalId) => ({ instanceType: 'node' as const, space: AUTOASSESS_SPACE, externalId })),
      sources: [{ source: view }],
    });
    const key = `${view.externalId}/${view.version}`;
    return new Map(
      response.items.map((item) => [
        item.externalId,
        (item.properties?.[view.space]?.[key] ?? {}) as Record<string, unknown>,
      ]),
    );
  }
}

// ---- Internal helpers ----

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
