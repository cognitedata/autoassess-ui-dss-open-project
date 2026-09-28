import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CogniteClient } from '@cognite/sdk';
import { CdfInspectionTaskService } from './InspectionTaskService';
import type { InspectionTaskService } from './InspectionTaskService';
import {
  INSPECTION_TASK_VIEW,
  INSPECTION_TASK_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';

function makeMockTaskNode(
  overrides: Record<string, unknown> = {},
  nodeOverrides: Record<string, unknown> = {},
) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'task-abc-123',
    version: 1,
    lastUpdatedTime: 1700000000000,
    createdTime: 1700000000000,
    properties: {
      [INSPECTION_TASK_VIEW.space]: {
        [`${INSPECTION_TASK_VIEW.externalId}/${INSPECTION_TASK_VIEW.version}`]: {
          plan: { space: 'autoassess', externalId: 'plan-area-01581-001' },
          taskType: 'element',
          inspectionType: 'visual',
          targetElement: { space: 'autoassess', externalId: 'element-3-15' },
          ...overrides,
        },
      },
    },
    ...nodeOverrides,
  };
}

function makeMockRegionTaskNode(overrides: Record<string, unknown> = {}) {
  return makeMockTaskNode({
    taskType: 'region',
    inspectionType: 'ndt_thickness',
    targetElement: undefined,
    position3d: [1.1, 2.2, 3.3],
    normalVector: [0.0, 1.0, 0.0],
    radiusM: 0.3,
    ...overrides,
  });
}

describe(CdfInspectionTaskService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockInstancesDelete: ReturnType<typeof vi.fn>;
  let service: InspectionTaskService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    mockInstancesUpsert = vi.fn();
    mockInstancesDelete = vi.fn();
    const mockClient = {
      instances: {
        list: mockInstancesList,
        upsert: mockInstancesUpsert,
        delete: mockInstancesDelete,
      } as unknown as CogniteClient['instances'],
    };
    service = new CdfInspectionTaskService(mockClient as CogniteClient);
  });

  describe('listForPlan', () => {
    it('should request tasks filtered by plan reference', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      await service.listForPlan('autoassess', 'plan-area-01581-001');

      expect(mockInstancesList).toHaveBeenCalledWith({
        instanceType: 'node',
        sources: [{ source: { type: 'view', ...INSPECTION_TASK_VIEW } }],
        filter: {
          equals: {
            property: getContainerProperty(INSPECTION_TASK_CONTAINER, 'plan'),
            value: { space: 'autoassess', externalId: 'plan-area-01581-001' },
          },
        },
        limit: 1000,
      });
    });

    it('should map element task nodes to InspectionTask[]', async () => {
      mockInstancesList.mockResolvedValue({ items: [makeMockTaskNode()] });

      const tasks = await service.listForPlan('autoassess', 'plan-area-01581-001');

      expect(tasks).toEqual([
        {
          space: 'autoassess',
          externalId: 'task-abc-123',
          planExternalId: 'plan-area-01581-001',
          taskKind: 'element',
          inspectionType: 'visual',
          targetElementExternalId: 'element-3-15',
        },
      ]);
    });

    it('should map region task nodes to InspectionTask[]', async () => {
      mockInstancesList.mockResolvedValue({ items: [makeMockRegionTaskNode()] });

      const tasks = await service.listForPlan('autoassess', 'plan-area-01581-001');

      expect(tasks).toEqual([
        {
          space: 'autoassess',
          externalId: 'task-abc-123',
          planExternalId: 'plan-area-01581-001',
          taskKind: 'region',
          inspectionType: 'ndt_thickness',
          position3d: [1.1, 2.2, 3.3],
          normalVector: [0.0, 1.0, 0.0],
          radiusM: 0.3,
        },
      ]);
    });

    it('should default unknown taskType to element', async () => {
      mockInstancesList.mockResolvedValue({
        items: [makeMockTaskNode({ taskType: 'unknown' })],
      });

      const [task] = await service.listForPlan('autoassess', 'plan-area-01581-001');

      expect(task.taskKind).toBe('element');
    });

    it('should default unknown inspectionType to visual', async () => {
      mockInstancesList.mockResolvedValue({
        items: [makeMockTaskNode({ inspectionType: 'unknown' })],
      });

      const [task] = await service.listForPlan('autoassess', 'plan-area-01581-001');

      expect(task.inspectionType).toBe('visual');
    });

    it('should return an empty array when no tasks exist', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      const tasks = await service.listForPlan('autoassess', 'plan-area-01581-001');

      expect(tasks).toEqual([]);
    });

    it('should propagate SDK errors', async () => {
      mockInstancesList.mockRejectedValue(new Error('Network error'));

      await expect(
        service.listForPlan('autoassess', 'plan-area-01581-001'),
      ).rejects.toThrow('Network error');
    });
  });

  describe('addTask (element)', () => {
    it('should upsert an element task node with correct properties', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockTaskNode()] });

      await service.addTask('autoassess', 'plan-area-01581-001', {
        taskKind: 'element',
        inspectionType: 'visual',
        targetElementExternalId: 'element-3-15',
      });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: 'autoassess',
            externalId: expect.stringMatching(/^task-/),
            sources: [
              {
                source: { type: 'view', ...INSPECTION_TASK_VIEW },
                properties: {
                  plan: { space: 'autoassess', externalId: 'plan-area-01581-001' },
                  taskType: 'element',
                  inspectionType: 'visual',
                  targetElement: { space: 'autoassess', externalId: 'element-3-15' },
                },
              },
            ],
          }),
        ],
      });
    });

    it('should return the mapped InspectionTask', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockTaskNode()] });

      const task = await service.addTask('autoassess', 'plan-area-01581-001', {
        taskKind: 'element',
        inspectionType: 'visual',
        targetElementExternalId: 'element-3-15',
      });

      expect(task.taskKind).toBe('element');
      expect(task.targetElementExternalId).toBe('element-3-15');
    });

    it('should throw if upsert returns no node', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await expect(
        service.addTask('autoassess', 'plan-area-01581-001', {
          taskKind: 'element',
          inspectionType: 'visual',
          targetElementExternalId: 'element-3-15',
        }),
      ).rejects.toThrow('Task creation returned no node');
    });
  });

  describe('addTask (region)', () => {
    it('should upsert a region task node with position/normal/radius', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockRegionTaskNode()] });

      await service.addTask('autoassess', 'plan-area-01581-001', {
        taskKind: 'region',
        inspectionType: 'ndt_thickness',
        position3d: [1.1, 2.2, 3.3],
        normalVector: [0.0, 1.0, 0.0],
        radiusM: 0.3,
      });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [
              {
                source: { type: 'view', ...INSPECTION_TASK_VIEW },
                properties: {
                  plan: { space: 'autoassess', externalId: 'plan-area-01581-001' },
                  taskType: 'region',
                  inspectionType: 'ndt_thickness',
                  position3d: [1.1, 2.2, 3.3],
                  normalVector: [0.0, 1.0, 0.0],
                  radiusM: 0.3,
                },
              },
            ],
          }),
        ],
      });
    });

    it('should propagate SDK errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      await expect(
        service.addTask('autoassess', 'plan-area-01581-001', {
          taskKind: 'region',
          inspectionType: 'visual',
          position3d: [0, 0, 0],
          normalVector: [0, 1, 0],
          radiusM: 0.3,
        }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('removeTask', () => {
    it('should delete the task node by space and externalId', async () => {
      mockInstancesDelete.mockResolvedValue({ items: [] });

      await service.removeTask('autoassess', 'task-abc-123');

      expect(mockInstancesDelete).toHaveBeenCalledWith([
        { instanceType: 'node', space: 'autoassess', externalId: 'task-abc-123' },
      ]);
    });

    it('should propagate SDK errors', async () => {
      mockInstancesDelete.mockRejectedValue(new Error('Network error'));

      await expect(service.removeTask('autoassess', 'task-abc-123')).rejects.toThrow(
        'Network error',
      );
    });
  });
});
