import type { CogniteClient, NodeDefinition, PropertyValueGroupV3 } from '@cognite/sdk';
import {
  AUTOASSESS_SPACE,
  INSPECTION_TASK_VIEW,
  INSPECTION_TASK_CONTAINER,
  INSPECTION_PLAN_VIEW,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

export type InspectionType = 'visual' | 'ndt_thickness';
export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  visual: 'Visual inspection',
  ndt_thickness: 'NDT thickness measurement',
};
export const INSPECTION_TYPES = Object.keys(INSPECTION_TYPE_LABELS) as InspectionType[];

export type TaskKind = 'element' | 'region';

export interface InspectionTask {
  space: string;
  externalId: string;
  planExternalId: string;
  taskKind: TaskKind;
  inspectionType: InspectionType;
  /** Set for element tasks. ExternalId of the targeted StructuralElement. */
  targetElementExternalId?: string;
  /** Set for region tasks. World-space position [x, y, z]. */
  position3d?: [number, number, number];
  /** Set for region tasks. Surface normal vector [nx, ny, nz]. */
  normalVector?: [number, number, number];
  /** Set for region tasks. Radius in metres. */
  radiusM?: number;
  /** Stable ID of the recommendation that generated this task, if any. */
  suggestionId?: string;
}

export type NewElementTask = {
  taskKind: 'element';
  inspectionType: InspectionType;
  targetElementExternalId: string;
  suggestionId?: string;
};

export type NewRegionTask = {
  taskKind: 'region';
  inspectionType: InspectionType;
  position3d: [number, number, number];
  normalVector: [number, number, number];
  radiusM: number;
  suggestionId?: string;
};

export type NewTask = NewElementTask | NewRegionTask;

export interface InspectionTaskService {
  listForPlan(planSpace: string, planExternalId: string): Promise<InspectionTask[]>;
  addTask(planSpace: string, planExternalId: string, task: NewTask): Promise<InspectionTask>;
  removeTask(space: string, externalId: string): Promise<void>;
}

export class CdfInspectionTaskService implements InspectionTaskService {
  constructor(private readonly client: CogniteClient) {}

  async listForPlan(planSpace: string, planExternalId: string): Promise<InspectionTask[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...INSPECTION_TASK_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(INSPECTION_TASK_CONTAINER, 'plan'),
          value: { space: planSpace, externalId: planExternalId },
        },
      },
      limit: 1000,
    });

    return response.items.filter(isNode).map(mapNodeToInspectionTask);
  }

  async addTask(
    planSpace: string,
    planExternalId: string,
    task: NewTask,
  ): Promise<InspectionTask> {
    const externalId = `task-${crypto.randomUUID()}`;

    const baseProperties: PropertyValueGroupV3 = {
      plan: { space: planSpace, externalId: planExternalId },
      taskType: task.taskKind,
      inspectionType: task.inspectionType,
      ...(task.suggestionId !== undefined ? { suggestionId: task.suggestionId } : {}),
    };
    const taskProperties: PropertyValueGroupV3 =
      task.taskKind === 'element'
        ? {
            ...baseProperties,
            targetElement: { space: AUTOASSESS_SPACE, externalId: task.targetElementExternalId },
          }
        : {
            ...baseProperties,
            position3d: task.position3d,
            normalVector: task.normalVector,
            radiusM: task.radiusM,
          };

    const response = await this.client.instances.upsert({
      items: [
        {
          instanceType: 'node',
          space: AUTOASSESS_SPACE,
          externalId,
          sources: [
            {
              source: { type: 'view', ...INSPECTION_TASK_VIEW },
              properties: taskProperties,
            },
          ],
        },
      ],
    });

    const node = response.items.find((item) => item.instanceType === 'node');
    if (!node) throw new Error('Task creation returned no node');

    // Construct from known inputs + slim node response (upsert returns SlimNodeDefinition)
    const baseTask: InspectionTask = {
      space: node.space,
      externalId: node.externalId,
      planExternalId,
      taskKind: task.taskKind,
      inspectionType: task.inspectionType,
      ...(task.suggestionId !== undefined ? { suggestionId: task.suggestionId } : {}),
    };
    if (task.taskKind === 'element') {
      return { ...baseTask, targetElementExternalId: task.targetElementExternalId };
    }
    return {
      ...baseTask,
      position3d: task.position3d,
      normalVector: task.normalVector,
      radiusM: task.radiusM,
    };
  }

  async removeTask(space: string, externalId: string): Promise<void> {
    await this.client.instances.delete([{ instanceType: 'node', space, externalId }]);
  }
}

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

const VALID_INSPECTION_TYPES = new Set<string>(['visual', 'ndt_thickness']);
const VALID_TASK_KINDS = new Set<string>(['element', 'region']);

function mapNodeToInspectionTask(item: NodeDefinition): InspectionTask {
  const props =
    item.properties?.[INSPECTION_TASK_VIEW.space]?.[getViewKey(INSPECTION_TASK_VIEW)] ?? {};

  const planRef = props['plan'] as { space: string; externalId: string } | undefined;
  const rawTaskKind = String(props['taskType'] ?? 'element');
  const taskKind: TaskKind = VALID_TASK_KINDS.has(rawTaskKind)
    ? (rawTaskKind as TaskKind)
    : 'element';
  const rawInspectionType = String(props['inspectionType'] ?? 'visual');
  const inspectionType: InspectionType = VALID_INSPECTION_TYPES.has(rawInspectionType)
    ? (rawInspectionType as InspectionType)
    : 'visual';

  const task: InspectionTask = {
    space: item.space,
    externalId: item.externalId,
    planExternalId: planRef?.externalId ?? '',
    taskKind,
    inspectionType,
  };

  if (taskKind === 'element') {
    const elementRef = props['targetElement'] as { space: string; externalId: string } | undefined;
    task.targetElementExternalId = elementRef?.externalId;
  } else {
    const pos = props['position3d'] as number[] | undefined;
    const norm = props['normalVector'] as number[] | undefined;
    const radius = props['radiusM'] as number | undefined;
    if (pos && pos.length === 3) task.position3d = [pos[0], pos[1], pos[2]];
    if (norm && norm.length === 3) task.normalVector = [norm[0], norm[1], norm[2]];
    if (typeof radius === 'number') task.radiusM = radius;
  }

  const rawSuggestionId = props['suggestionId'];
  if (typeof rawSuggestionId === 'string') task.suggestionId = rawSuggestionId;

  return task;
}

// Re-export for use in setup-dm and other consumers that need the view reference key.
export { INSPECTION_PLAN_VIEW };
