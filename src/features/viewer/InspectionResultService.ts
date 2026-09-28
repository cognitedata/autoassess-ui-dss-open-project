import type { CogniteClient, NodeDefinition } from '@cognite/sdk';

import {
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

import type { CampaignWrite } from './campaigns/campaignEdit';

export type ResultStatus = 'InProgress' | 'Complete';

export interface InspectionResult {
  space: string;
  externalId: string;
  areaExternalId: string;
  /** ISO-8601 date string, e.g. "2024-09-15" */
  date: string;
  status: ResultStatus;
  /** CDF file IDs for PLY mesh models associated with this result. */
  cdfFileIds: number[];
  /** CDF file IDs for PCD point cloud files associated with this result. */
  pcdFileIds: number[];
  /** Display labels for each PCD file (index-aligned with pcdFileIds). */
  pcdFileLabels: string[];
}

export interface InspectionResultService {
  listForArea(areaSpace: string, areaExternalId: string): Promise<InspectionResult[]>;
  /** Upsert campaign nodes (date / file lists; area + status for new ones) in one request. */
  saveCampaigns(writes: CampaignWrite[]): Promise<void>;
}

/** Only the part of the SDK this service needs — keeps test doubles honest. */
export type InspectionResultSdk = { instances: Pick<CogniteClient['instances'], 'list' | 'upsert'> };

export class CdfInspectionResultService implements InspectionResultService {
  constructor(private readonly client: InspectionResultSdk) {}

  async saveCampaigns(writes: CampaignWrite[]): Promise<void> {
    if (writes.length === 0) return;
    await this.client.instances.upsert({
      items: writes.map((write) => ({
        instanceType: 'node' as const,
        space: write.space,
        externalId: write.externalId,
        sources: [
          {
            source: { type: 'view' as const, ...INSPECTION_RESULT_VIEW },
            properties: {
              ...(write.create && {
                area: { space: write.create.areaSpace, externalId: write.create.areaExternalId },
                status: 'Complete',
                createdBy: 'autoassess-web',
              }),
              ...(write.campaignDate !== undefined && { campaignDate: write.campaignDate }),
              cdfFileIds: write.cdfFileIds,
              pcdFileIds: write.pcdFileIds,
              pcdFileLabels: write.pcdFileLabels,
            },
          },
        ],
      })),
    });
  }

  async listForArea(areaSpace: string, areaExternalId: string): Promise<InspectionResult[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...INSPECTION_RESULT_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(INSPECTION_RESULT_CONTAINER, 'area'),
          value: { space: areaSpace, externalId: areaExternalId },
        },
      },
      limit: 1000,
    });

    return response.items
      .filter(isNode)
      .map(mapNodeToInspectionResult)
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

const VALID_STATUSES = new Set<string>(['InProgress', 'Complete']);

function mapNodeToInspectionResult(item: NodeDefinition): InspectionResult {
  const props =
    item.properties?.[INSPECTION_RESULT_VIEW.space]?.[getViewKey(INSPECTION_RESULT_VIEW)] ?? {};
  const areaRef = props['area'] as { space: string; externalId: string } | undefined;
  const rawStatus = String(props['status'] ?? 'Complete');
  const status: ResultStatus = VALID_STATUSES.has(rawStatus)
    ? (rawStatus as ResultStatus)
    : 'Complete';
  const rawFileIds = props['cdfFileIds'];
  const cdfFileIds = Array.isArray(rawFileIds) ? rawFileIds.map(Number) : [];

  const rawPcdFileIds = props['pcdFileIds'];
  const pcdFileIds = Array.isArray(rawPcdFileIds) ? rawPcdFileIds.map(Number) : [];

  const rawPcdFileLabels = props['pcdFileLabels'];
  const pcdFileLabels = Array.isArray(rawPcdFileLabels) ? rawPcdFileLabels.map(String) : [];

  return {
    space: item.space,
    externalId: item.externalId,
    areaExternalId: areaRef?.externalId ?? '',
    date: String(props['campaignDate'] ?? ''),
    status,
    cdfFileIds,
    pcdFileIds,
    pcdFileLabels,
  };
}
