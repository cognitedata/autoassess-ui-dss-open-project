import type { CogniteClient, NodeDefinition } from '@cognite/sdk';
import { AUTOASSESS_SPACE, VESSEL_VIEW, VESSEL_CONTAINER, getViewKey, getContainerProperty } from '../../shared/cdf/dataModel';

export interface Vessel {
  space: string;
  externalId: string;
  name: string;
  vesselType: string;
}

export interface NewVessel {
  name: string;
  vesselType: string;
}

export interface VesselService {
  listVessels(): Promise<Vessel[]>;
  createVessel(input: NewVessel): Promise<Vessel>;
  updateVessel(space: string, externalId: string, input: { name: string }): Promise<void>;
  deleteVessel(space: string, externalId: string): Promise<void>;
}

export class CdfVesselService implements VesselService {
  constructor(private readonly client: CogniteClient) {}

  async listVessels(): Promise<Vessel[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...VESSEL_VIEW } }],
      filter: {
        not: { exists: { property: getContainerProperty(VESSEL_CONTAINER, 'deletedAt') } },
      },
      limit: 1000,
    });
    return response.items.filter(isNode).map(mapNodeToVessel);
  }

  async updateVessel(space: string, externalId: string, input: { name: string }): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...VESSEL_VIEW },
              properties: { name: input.name },
            },
          ],
        },
      ],
    });
  }

  async deleteVessel(space: string, externalId: string): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...VESSEL_VIEW },
              properties: { deletedAt: new Date().toISOString() },
            },
          ],
        },
      ],
    });
  }

  async createVessel(input: NewVessel): Promise<Vessel> {
    const externalId = `vessel-${crypto.randomUUID()}`;
    const response = await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space: AUTOASSESS_SPACE,
          externalId,
          sources: [
            {
              source: { type: 'view', ...VESSEL_VIEW },
              properties: { name: input.name, vesselType: input.vesselType },
            },
          ],
        },
      ],
    });
    const node = response.items.find((item) => item.instanceType === 'node');
    if (!node) throw new Error('Vessel creation returned no node');
    return { space: node.space, externalId: node.externalId, name: input.name, vesselType: input.vesselType };
  }
}

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

function mapNodeToVessel(item: NodeDefinition): Vessel {
  const props =
    item.properties?.[VESSEL_VIEW.space]?.[getViewKey(VESSEL_VIEW)] ?? {};
  return {
    space: item.space,
    externalId: item.externalId,
    name: String(props['name'] ?? ''),
    vesselType: String(props['vesselType'] ?? ''),
  };
}
