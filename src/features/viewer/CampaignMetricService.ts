import type { CogniteClient, NodeDefinition } from '@cognite/sdk';

import {
  AUTOASSESS_SPACE,
  CAMPAIGN_METRIC_VIEW,
  CAMPAIGN_METRIC_CONTAINER,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

export type MetricUnit = 'decimal' | 'percentage';

export interface CampaignMetric {
  space: string;
  externalId: string;
  campaignExternalId: string;
  name: string;
  value: number;
  unit: MetricUnit;
}

export interface CampaignMetricService {
  listForCampaign(campaignSpace: string, campaignExternalId: string): Promise<CampaignMetric[]>;
}

export class CdfCampaignMetricService implements CampaignMetricService {
  constructor(private readonly client: CogniteClient) {}

  async listForCampaign(
    campaignSpace: string,
    campaignExternalId: string,
  ): Promise<CampaignMetric[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...CAMPAIGN_METRIC_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(CAMPAIGN_METRIC_CONTAINER, 'campaign'),
          value: { space: campaignSpace, externalId: campaignExternalId },
        },
      },
      limit: 1000,
    });
    return response.items.filter(isNode).map(mapNodeToMetric);
  }
}

// ---- Internal helpers ----

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

const VALID_UNITS = new Set<string>(['decimal', 'percentage']);

function mapNodeToMetric(item: NodeDefinition): CampaignMetric {
  const props =
    item.properties?.[CAMPAIGN_METRIC_VIEW.space]?.[getViewKey(CAMPAIGN_METRIC_VIEW)] ?? {};

  const campaignRef = props['campaign'] as { space: string; externalId: string } | undefined;
  const rawUnit = String(props['unit'] ?? 'decimal');
  const unit: MetricUnit = VALID_UNITS.has(rawUnit) ? (rawUnit as MetricUnit) : 'decimal';

  return {
    space: item.space,
    externalId: item.externalId,
    campaignExternalId: campaignRef?.externalId ?? '',
    name: String(props['name'] ?? ''),
    value: typeof props['value'] === 'number' ? props['value'] : 0,
    unit,
  };
}

export { AUTOASSESS_SPACE };
