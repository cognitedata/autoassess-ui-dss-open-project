import type { CogniteClient, NodeDefinition, PropertyValueGroupV3 } from '@cognite/sdk';

import {
  AUTOASSESS_SPACE,
  DEFECT_DETECTION_VIEW,
  DEFECT_DETECTION_CONTAINER,
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

export type DefectStatus = 'New' | 'UnderReview' | 'Confirmed' | 'Dismissed';

export interface DefectDetection {
  space: string;
  externalId: string;
  /** externalId of the InspectionResult (campaign) this defect belongs to. Absent for manual defects. */
  campaignExternalId?: string;
  /** ML confidence score, 0–1. */
  probability: number;
  /** Defect class label, e.g. "corrosion", "crack". */
  defectClass: string;
  /**
   * Oriented bounding box — 9 floats:
   *   [cx, cy, cz,  hx, hy, hz,  rx, ry, rz]
   * where c = centre, h = half-extents, r = Euler rotation (radians).
   * The first three values (cx, cy, cz) are the world-space position used for
   * camera fly-to.
   */
  boundingBox3d: number[];
  /** Surface normal [nx, ny, nz]. Stored when defect is created from a surface hit. */
  normal3d?: [number, number, number];
  /** Origin of the defect. Absent on legacy rows — treat as 'ml'. */
  source?: 'ml' | 'manual';
  status: DefectStatus;
  createdTime?: Date;
  lastUpdatedTime?: Date;
}

export interface NewManualDefect {
  position: [number, number, number];
  normal?: [number, number, number];
  defectClass: string;
  probability: number;
}

export type DefectUpdates = {
  defectClass?: string;
  probability?: number;
  status?: DefectStatus;
};

export interface DefectDetectionService {
  listForArea(areaSpace: string, areaExternalId: string): Promise<DefectDetection[]>;
  /** @deprecated Prefer update({ status }). Kept for backward compatibility. */
  updateStatus(space: string, externalId: string, status: DefectStatus): Promise<void>;
  update(space: string, externalId: string, updates: DefectUpdates): Promise<void>;
  createManual(areaSpace: string, areaExternalId: string, defect: NewManualDefect): Promise<DefectDetection>;
  delete(space: string, externalId: string): Promise<void>;
}

export class CdfDefectDetectionService implements DefectDetectionService {
  constructor(private readonly client: CogniteClient) {}

  async listForArea(areaSpace: string, areaExternalId: string): Promise<DefectDetection[]> {
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

    const areaFilter = {
      equals: {
        property: getContainerProperty(DEFECT_DETECTION_CONTAINER, 'area'),
        value: { space: areaSpace, externalId: areaExternalId },
      },
    };

    // Step 2: query defects by campaign (ML) OR direct area link (manual).
    const filter =
      campaignRefs.length > 0
        ? {
            or: [
              {
                in: {
                  property: getContainerProperty(DEFECT_DETECTION_CONTAINER, 'campaign'),
                  values: campaignRefs,
                },
              },
              areaFilter,
            ],
          }
        : areaFilter;

    const defectsResponse = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...DEFECT_DETECTION_VIEW } }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter: filter as any,
      limit: 1000,
    });

    return defectsResponse.items.filter(isNode).map(mapNodeToDefectDetection);
  }

  async updateStatus(space: string, externalId: string, status: DefectStatus): Promise<void> {
    return this.update(space, externalId, { status });
  }

  async update(space: string, externalId: string, updates: DefectUpdates): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...DEFECT_DETECTION_VIEW },
              properties: { ...updates },
            },
          ],
        },
      ],
    });
  }

  async createManual(
    areaSpace: string,
    areaExternalId: string,
    defect: NewManualDefect,
  ): Promise<DefectDetection> {
    const externalId = `manual-${crypto.randomUUID()}`;
    const [cx, cy, cz] = defect.position;
    const boundingBox3d = [cx, cy, cz, 0, 0, 0, 0, 0, 0];

    const properties: PropertyValueGroupV3 = {
      area: { space: areaSpace, externalId: areaExternalId },
      defectClass: defect.defectClass,
      probability: defect.probability,
      boundingBox3d,
      source: 'manual',
      status: 'New',
      ...(defect.normal ? { normal3d: defect.normal } : {}),
    };

    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space: AUTOASSESS_SPACE,
          externalId,
          sources: [
            {
              source: { type: 'view', ...DEFECT_DETECTION_VIEW },
              properties,
            },
          ],
        },
      ],
    });

    return {
      space: AUTOASSESS_SPACE,
      externalId,
      probability: defect.probability,
      defectClass: defect.defectClass,
      boundingBox3d,
      ...(defect.normal ? { normal3d: defect.normal } : {}),
      source: 'manual',
      status: 'New',
    };
  }

  async delete(space: string, externalId: string): Promise<void> {
    await this.client.instances.delete([{ instanceType: 'node', space, externalId }]);
  }
}

// ---- Internal helpers ----

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

const VALID_STATUSES = new Set<string>(['New', 'UnderReview', 'Confirmed', 'Dismissed']);
const VALID_SOURCES = new Set<string>(['ml', 'manual']);

function mapNodeToDefectDetection(item: NodeDefinition): DefectDetection {
  const props =
    item.properties?.[DEFECT_DETECTION_VIEW.space]?.[getViewKey(DEFECT_DETECTION_VIEW)] ?? {};

  const campaignRef = props['campaign'] as { space: string; externalId: string } | undefined;
  const rawStatus = String(props['status'] ?? 'New');
  const status: DefectStatus = VALID_STATUSES.has(rawStatus)
    ? (rawStatus as DefectStatus)
    : 'New';
  const rawBbox = props['boundingBox3d'];
  const boundingBox3d = Array.isArray(rawBbox) ? rawBbox.map(Number) : [];

  const rawNormal = props['normal3d'];
  const normal3d: [number, number, number] | undefined =
    Array.isArray(rawNormal) && rawNormal.length === 3
      ? [Number(rawNormal[0]), Number(rawNormal[1]), Number(rawNormal[2])]
      : undefined;

  const rawSource = props['source'];
  const source =
    typeof rawSource === 'string' && VALID_SOURCES.has(rawSource)
      ? (rawSource as 'ml' | 'manual')
      : undefined;

  const result: DefectDetection = {
    space: item.space,
    externalId: item.externalId,
    campaignExternalId: campaignRef?.externalId,
    probability: typeof props['probability'] === 'number' ? props['probability'] : 0,
    defectClass: String(props['defectClass'] ?? ''),
    boundingBox3d,
    status,
  };

  if (normal3d) result.normal3d = normal3d;
  if (source) result.source = source;
  if (item.createdTime) result.createdTime = new Date(item.createdTime);
  if (item.lastUpdatedTime) result.lastUpdatedTime = new Date(item.lastUpdatedTime);

  return result;
}

export { AUTOASSESS_SPACE };
