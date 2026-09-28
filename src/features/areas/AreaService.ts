import type { CogniteClient, NodeDefinition } from '@cognite/sdk';
import { AUTOASSESS_SPACE, AREA_VIEW, AREA_CONTAINER, getContainerProperty, getViewKey } from '../../shared/cdf/dataModel';

export interface Area {
  space: string;
  externalId: string;
  name: string;
  areaType: string;
  vesselExternalId: string;
  groundPlane?: [number, number, number];
  initialCameraPosition?: [number, number, number];
  initialCameraTarget?: [number, number, number];
}

export interface NewArea {
  name: string;
  areaType: string;
  vesselSpace: string;
  vesselExternalId: string;
}

export interface AreaService {
  listAreasForVessel(vesselSpace: string, vesselExternalId: string): Promise<Area[]>;
  getArea(space: string, externalId: string): Promise<Area>;
  createArea(input: NewArea): Promise<Area>;
  updateArea(space: string, externalId: string, input: { name: string }): Promise<void>;
  deleteArea(space: string, externalId: string): Promise<void>;
  setGroundPlane(space: string, externalId: string, normal: [number, number, number]): Promise<void>;
  setDefaultCameraPose(space: string, externalId: string, position: [number, number, number], target: [number, number, number]): Promise<void>;
}

export class CdfAreaService implements AreaService {
  constructor(private readonly client: CogniteClient) {}

  async listAreasForVessel(vesselSpace: string, vesselExternalId: string): Promise<Area[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...AREA_VIEW } }],
      filter: {
        and: [
          {
            equals: {
              property: getContainerProperty(AREA_CONTAINER, 'vessel'),
              value: { space: vesselSpace, externalId: vesselExternalId },
            },
          },
          {
            not: { exists: { property: getContainerProperty(AREA_CONTAINER, 'deletedAt') } },
          },
        ],
      },
      limit: 1000,
    });
    return response.items.filter(isNode).map(mapNodeToArea);
  }

  async updateArea(space: string, externalId: string, input: { name: string }): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...AREA_VIEW },
              properties: { name: input.name },
            },
          ],
        },
      ],
    });
  }

  async deleteArea(space: string, externalId: string): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...AREA_VIEW },
              properties: { deletedAt: new Date().toISOString() },
            },
          ],
        },
      ],
    });
  }

  async getArea(space: string, externalId: string): Promise<Area> {
    const response = await this.client.instances.retrieve({
      items: [{ instanceType: 'node', space, externalId }],
      sources: [{ source: { type: 'view', ...AREA_VIEW } }],
    });
    const node = response.items.find(isNode);
    if (!node) throw new Error(`Area not found: ${space}/${externalId}`);
    return mapNodeToArea(node);
  }

  async setGroundPlane(
    space: string,
    externalId: string,
    normal: [number, number, number],
  ): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...AREA_VIEW },
              properties: { groundPlane: normal },
            },
          ],
        },
      ],
    });
  }

  async setDefaultCameraPose(
    space: string,
    externalId: string,
    position: [number, number, number],
    target: [number, number, number],
  ): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...AREA_VIEW },
              properties: {
                initialCameraPosition: position,
                initialCameraTarget: target,
              },
            },
          ],
        },
      ],
    });
  }

  async createArea(input: NewArea): Promise<Area> {
    const externalId = `area-${crypto.randomUUID()}`;
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space: AUTOASSESS_SPACE,
          externalId,
          sources: [
            {
              source: { type: 'view', ...AREA_VIEW },
              properties: {
                name: input.name,
                areaType: input.areaType,
                vessel: { space: input.vesselSpace, externalId: input.vesselExternalId },
              },
            },
          ],
        },
      ],
    });
    return {
      space: AUTOASSESS_SPACE,
      externalId,
      name: input.name,
      areaType: input.areaType,
      vesselExternalId: input.vesselExternalId,
    };
  }
}

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

function parseFloat64List3(value: unknown): [number, number, number] | undefined {
  return Array.isArray(value) && value.length === 3
    ? [value[0] as number, value[1] as number, value[2] as number]
    : undefined;
}

function mapNodeToArea(item: NodeDefinition): Area {
  const props =
    item.properties?.[AREA_VIEW.space]?.[getViewKey(AREA_VIEW)] ?? {};
  const vesselRef = props['vessel'] as { space: string; externalId: string } | undefined;
  return {
    space: item.space,
    externalId: item.externalId,
    name: String(props['name'] ?? ''),
    areaType: String(props['areaType'] ?? ''),
    vesselExternalId: vesselRef?.externalId ?? '',
    groundPlane: parseFloat64List3(props['groundPlane']),
    initialCameraPosition: parseFloat64List3(props['initialCameraPosition']),
    initialCameraTarget: parseFloat64List3(props['initialCameraTarget']),
  };
}
