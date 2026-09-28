import type { CogniteClient, NodeDefinition } from '@cognite/sdk';

import {
  AUTOASSESS_SPACE,
  NDT_MEASUREMENT_VIEW,
  NDT_MEASUREMENT_CONTAINER,
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

export interface NdtMeasurement {
  space: string;
  externalId: string;
  /** externalId of the InspectionResult (campaign) this measurement belongs to. */
  campaignExternalId: string;
  /** World-space measurement position [x, y, z]. */
  position3d: [number, number, number];
  /** Measured steel plate thickness in millimetres. */
  thicknessMm: number;
  /** ISO-8601 datetime string of when the measurement was taken. */
  timestamp: string;
}

export interface NdtMeasurementService {
  listForArea(areaSpace: string, areaExternalId: string): Promise<NdtMeasurement[]>;
  listForCampaign(campaignSpace: string, campaignExternalId: string): Promise<NdtMeasurement[]>;
}

export class CdfNdtMeasurementService implements NdtMeasurementService {
  constructor(private readonly client: CogniteClient) {}

  async listForArea(areaSpace: string, areaExternalId: string): Promise<NdtMeasurement[]> {
    // Step 1: resolve all campaign (InspectionResult) IDs for this area.
    const resultsResponse = await this.client.instances.list({
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

    const campaignRefs = resultsResponse.items
      .filter(isNode)
      .map((node) => ({ space: node.space, externalId: node.externalId }));

    if (campaignRefs.length === 0) return [];

    // Step 2: fetch all NDT measurements whose campaign property matches one of the campaigns.
    const measurementsResponse = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...NDT_MEASUREMENT_VIEW } }],
      filter: {
        in: {
          property: getContainerProperty(NDT_MEASUREMENT_CONTAINER, 'campaign'),
          values: campaignRefs,
        },
      },
      limit: 1000,
    });

    return measurementsResponse.items.filter(isNode).map(mapNodeToNdtMeasurement);
  }

  async listForCampaign(campaignSpace: string, campaignExternalId: string): Promise<NdtMeasurement[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...NDT_MEASUREMENT_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(NDT_MEASUREMENT_CONTAINER, 'campaign'),
          value: { space: campaignSpace, externalId: campaignExternalId },
        },
      },
      limit: 1000,
    });
    return response.items.filter(isNode).map(mapNodeToNdtMeasurement);
  }
}

// ---- Internal helpers ----

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

function mapNodeToNdtMeasurement(item: NodeDefinition): NdtMeasurement {
  const props =
    item.properties?.[NDT_MEASUREMENT_VIEW.space]?.[getViewKey(NDT_MEASUREMENT_VIEW)] ?? {};

  const campaignRef = props['campaign'] as { space: string; externalId: string } | undefined;
  const rawPos = props['position3d'];
  const position3d: [number, number, number] = Array.isArray(rawPos)
    ? [Number(rawPos[0]), Number(rawPos[1]), Number(rawPos[2])]
    : [0, 0, 0];

  return {
    space: item.space,
    externalId: item.externalId,
    campaignExternalId: campaignRef?.externalId ?? '',
    position3d,
    thicknessMm: typeof props['thicknessMm'] === 'number' ? props['thicknessMm'] : 0,
    timestamp: String(props['timestamp'] ?? ''),
  };
}

export { AUTOASSESS_SPACE };
