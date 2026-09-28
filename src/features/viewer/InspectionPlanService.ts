import type { CogniteClient, NodeDefinition } from '@cognite/sdk';
import {
  AUTOASSESS_SPACE,
  INSPECTION_PLAN_VIEW,
  INSPECTION_PLAN_CONTAINER,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

export type PlanStatus = 'Draft' | 'Ready' | 'Complete';

export interface InspectionPlan {
  space: string;
  externalId: string;
  areaExternalId: string;
  /** externalId of the InspectionResult (campaign) this plan's task coordinates are expressed against. */
  mapExternalId: string | null;
  status: PlanStatus;
  /** Unix epoch milliseconds — from DMS node metadata, not a custom property. */
  createdTime: number;
  name: string | null;
  description: string | null;
}

export interface NewInspectionPlan {
  /** externalId of the InspectionResult (campaign) to use as the plan's reference map. */
  mapExternalId: string;
  name?: string;
  description?: string;
}

export interface UpdateInspectionPlanInput {
  name?: string;
  description?: string;
  /** externalId of the InspectionResult (campaign) to switch the plan's reference map to. */
  mapExternalId?: string;
}

export interface InspectionPlanService {
  listForArea(areaSpace: string, areaExternalId: string): Promise<InspectionPlan[]>;
  create(
    areaSpace: string,
    areaExternalId: string,
    input: NewInspectionPlan,
  ): Promise<InspectionPlan>;
  updateStatus(space: string, externalId: string, status: PlanStatus): Promise<void>;
  update(space: string, externalId: string, input: UpdateInspectionPlanInput): Promise<void>;
  delete(space: string, externalId: string): Promise<void>;
}

export class CdfInspectionPlanService implements InspectionPlanService {
  constructor(private readonly client: CogniteClient) {}

  async listForArea(areaSpace: string, areaExternalId: string): Promise<InspectionPlan[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...INSPECTION_PLAN_VIEW } }],
      filter: {
        and: [
          {
            equals: {
              property: getContainerProperty(INSPECTION_PLAN_CONTAINER, 'area'),
              value: { space: areaSpace, externalId: areaExternalId },
            },
          },
          {
            not: {
              exists: { property: getContainerProperty(INSPECTION_PLAN_CONTAINER, 'deletedAt') },
            },
          },
        ],
      },
      limit: 1000,
    });

    return response.items
      .filter(isNode)
      .map(mapNodeToInspectionPlan)
      .sort((a, b) => b.createdTime - a.createdTime);
  }

  async create(
    areaSpace: string,
    areaExternalId: string,
    input: NewInspectionPlan,
  ): Promise<InspectionPlan> {
    const externalId = `plan-${crypto.randomUUID()}`;
    const name = input.name?.trim() || undefined;
    const description = input.description?.trim() || undefined;
    const response = await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space: AUTOASSESS_SPACE,
          externalId,
          sources: [
            {
              source: { type: 'view', ...INSPECTION_PLAN_VIEW },
              properties: {
                area: { space: areaSpace, externalId: areaExternalId },
                map: { space: areaSpace, externalId: input.mapExternalId },
                status: 'Draft',
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
              },
            },
          ],
        },
      ],
    });

    const node = response.items.find((item) => item.instanceType === 'node');
    if (!node) throw new Error('Plan creation returned no node');
    return {
      space: node.space,
      externalId: node.externalId,
      areaExternalId,
      mapExternalId: input.mapExternalId,
      status: 'Draft',
      createdTime: node.createdTime,
      name: name ?? null,
      description: description ?? null,
    };
  }

  async updateStatus(space: string, externalId: string, status: PlanStatus): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...INSPECTION_PLAN_VIEW },
              properties: { status },
            },
          ],
        },
      ],
    });
  }

  async update(
    space: string,
    externalId: string,
    input: UpdateInspectionPlanInput,
  ): Promise<void> {
    const properties: Record<string, string | { space: string; externalId: string }> = {};
    if (input.name !== undefined) properties['name'] = input.name.trim();
    if (input.description !== undefined) properties['description'] = input.description.trim();
    if (input.mapExternalId !== undefined) {
      properties['map'] = { space, externalId: input.mapExternalId };
    }

    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [{ source: { type: 'view', ...INSPECTION_PLAN_VIEW }, properties }],
        },
      ],
    });
  }

  async delete(space: string, externalId: string): Promise<void> {
    await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space,
          externalId,
          sources: [
            {
              source: { type: 'view', ...INSPECTION_PLAN_VIEW },
              properties: { deletedAt: new Date().toISOString() },
            },
          ],
        },
      ],
    });
  }
}

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

const VALID_STATUSES = new Set<string>(['Draft', 'Ready', 'Complete']);

function mapNodeToInspectionPlan(item: NodeDefinition): InspectionPlan {
  const props =
    item.properties?.[INSPECTION_PLAN_VIEW.space]?.[getViewKey(INSPECTION_PLAN_VIEW)] ?? {};
  const areaRef = props['area'] as { space: string; externalId: string } | undefined;
  const mapRef = props['map'] as { space: string; externalId: string } | undefined;
  const rawStatus = String(props['status'] ?? 'Draft');
  const status: PlanStatus = VALID_STATUSES.has(rawStatus)
    ? (rawStatus as PlanStatus)
    : 'Draft';
  const name = (props['name'] as string | undefined) ?? null;
  const description = (props['description'] as string | undefined) ?? null;

  return {
    space: item.space,
    externalId: item.externalId,
    areaExternalId: areaRef?.externalId ?? '',
    mapExternalId: mapRef?.externalId ?? null,
    status,
    createdTime: item.createdTime ?? 0,
    name,
    description,
  };
}
