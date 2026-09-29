import type { CogniteClient, NodeDefinition } from '@cognite/sdk';

import { AUTOASSESS_SPACE } from '../../../shared/cdf/dataModel';

export type AreaFileKind = 'mesh' | 'pointcloud';

/** An uploaded mesh / point cloud of an area (a CogniteFile tagged `area:<id>`). */
export interface AreaFile {
  fileId: number;
  externalId: string;
  name: string;
  kind: AreaFileKind;
  /** From the `label:<l>` tag (point clouds), else null. */
  label: string | null;
  createdTime: number;
  uploaded: boolean;
}

export interface AreaFileService {
  listForArea(areaExternalId: string): Promise<AreaFile[]>;
}

const FILE_VIEW = { type: 'view', space: 'cdf_cdm', externalId: 'CogniteFile', version: 'v1' } as const;
const FILE_VIEW_KEY = 'CogniteFile/v1';
const KIND_BY_TAG: Record<string, AreaFileKind> = { ply_mesh: 'mesh', pcd_pointcloud: 'pointcloud' };
const CHUNK = 1000;

/** Only the part of the SDK this service needs — keeps test doubles honest. */
export type AreaFileSdk = {
  instances: Pick<CogniteClient['instances'], 'list'>;
  files: Pick<CogniteClient['files'], 'retrieve'>;
};

export class CdfAreaFileService implements AreaFileService {
  constructor(private readonly client: AreaFileSdk) {}

  async listForArea(areaExternalId: string): Promise<AreaFile[]> {
    const nodes = await this.listNodes(areaExternalId);
    const candidates = nodes.flatMap((node) => {
      const props = node.properties?.[FILE_VIEW.space]?.[FILE_VIEW_KEY] ?? {};
      const tags = Array.isArray(props.tags) ? props.tags.map(String) : [];
      const kind = tags.map((t) => KIND_BY_TAG[t]).find(Boolean);
      if (!kind) return [];
      const label = tags.find((t) => t.startsWith('label:'))?.slice('label:'.length) ?? null;
      return [{
        externalId: node.externalId,
        name: String(props.name ?? node.externalId),
        kind,
        label,
        createdTime: node.createdTime,
        uploaded: props.isUploaded === true,
      }];
    });
    const ids = await this.numericIds(candidates.map((c) => c.externalId));
    return candidates
      .flatMap((c) => (ids.has(c.externalId) ? [{ fileId: ids.get(c.externalId) ?? 0, ...c }] : []))
      .sort((a, b) => b.createdTime - a.createdTime);
  }

  private async listNodes(areaExternalId: string): Promise<NodeDefinition[]> {
    const nodes: NodeDefinition[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.client.instances.list({
        instanceType: 'node',
        sources: [{ source: FILE_VIEW }],
        filter: {
          and: [
            { equals: { property: ['node', 'space'], value: AUTOASSESS_SPACE } },
            { containsAny: { property: [FILE_VIEW.space, FILE_VIEW_KEY, 'tags'], values: [`area:${areaExternalId}`] } },
          ],
        },
        limit: 1000,
        ...(cursor && { cursor }),
      });
      for (const item of response.items) if (item.instanceType === 'node') nodes.push(item);
      cursor = response.nextCursor ?? undefined;
    } while (cursor);
    return nodes;
  }

  private async numericIds(externalIds: string[]): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    for (let i = 0; i < externalIds.length; i += CHUNK) {
      const infos = await this.client.files.retrieve(
        externalIds.slice(i, i + CHUNK).map((externalId) => ({ instanceId: { space: AUTOASSESS_SPACE, externalId } })),
        { ignoreUnknownIds: true },
      );
      for (const info of infos) if (info.instanceId) found.set(info.instanceId.externalId, info.id);
    }
    return found;
  }
}
