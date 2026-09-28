import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCreatePlan,
  useUpdatePlanStatus,
  useUpdatePlan,
  useDeletePlan,
  UseMutateInspectionPlanContext,
} from './useMutateInspectionPlan';
import { INSPECTION_PLAN_VIEW } from '../../shared/cdf/dataModel';
import type { CogniteClient } from '@cognite/sdk';
import type { InspectionTask } from './InspectionTaskService';

function makePlanNode() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'plan-new-001',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 1700000000000,
    properties: {
      [INSPECTION_PLAN_VIEW.space]: {
        [`${INSPECTION_PLAN_VIEW.externalId}/${INSPECTION_PLAN_VIEW.version}`]: {
          area: { space: 'autoassess', externalId: 'area-01581' },
          status: 'Draft',
        },
      },
    },
  };
}

describe('useMutateInspectionPlan', () => {
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockInstancesDelete: ReturnType<typeof vi.fn>;
  let mockContext: { useCogniteSdk: () => CogniteClient };
  let queryClient: QueryClient;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesUpsert = vi.fn();
    mockInstancesDelete = vi.fn();
    const mockSdk = {
      instances: { upsert: mockInstancesUpsert, delete: mockInstancesDelete },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseMutateInspectionPlanContext.Provider, { value: mockContext }, children),
      );
  });

  describe('useCreatePlan', () => {
    it('should call create and return the new plan on success', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makePlanNode()] });

      const { result } = renderHook(
        () => useCreatePlan('autoassess', 'area-01581'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({ mapExternalId: 'result-2024-09-15' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.status).toBe('Draft');
    });

    it('should pass name and description through to create', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makePlanNode()] });

      const { result } = renderHook(
        () => useCreatePlan('autoassess', 'area-01581'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({
          mapExternalId: 'result-2024-09-15',
          name: 'Q3 hull survey',
          description: 'Focus on aft hull',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              sources: [
                expect.objectContaining({
                  properties: expect.objectContaining({
                    name: 'Q3 hull survey',
                    description: 'Focus on aft hull',
                  }),
                }),
              ],
            }),
          ],
        }),
      );
    });

    it('should surface errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useCreatePlan('autoassess', 'area-01581'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({ mapExternalId: 'result-2024-09-15' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useUpdatePlanStatus', () => {
    it('should call updateStatus with correct arguments', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      const { result } = renderHook(() => useUpdatePlanStatus(), { wrapper });

      await act(async () => {
        result.current.mutate({
          space: 'autoassess',
          externalId: 'plan-001',
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          status: 'Ready',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              externalId: 'plan-001',
              sources: [
                expect.objectContaining({
                  properties: { status: 'Ready' },
                }),
              ],
            }),
          ],
        }),
      );
    });

    it('should surface errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useUpdatePlanStatus(), { wrapper });

      await act(async () => {
        result.current.mutate({
          space: 'autoassess',
          externalId: 'plan-001',
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          status: 'Ready',
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useUpdatePlan', () => {
    it('should upsert only the provided fields', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      const { result } = renderHook(() => useUpdatePlan(), { wrapper });

      await act(async () => {
        result.current.mutate({
          space: 'autoassess',
          externalId: 'plan-001',
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          name: 'Q3 hull survey',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              externalId: 'plan-001',
              sources: [expect.objectContaining({ properties: { name: 'Q3 hull survey' } })],
            }),
          ],
        }),
      );
    });

    it('should invalidate the inspectionPlans query on success', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdatePlan(), { wrapper });

      await act(async () => {
        result.current.mutate({
          space: 'autoassess',
          externalId: 'plan-001',
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          description: 'Focus on aft hull',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['inspectionPlans', 'autoassess', 'area-01581'],
      });
    });

    it('should forward mapExternalId to update', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      const { result } = renderHook(() => useUpdatePlan(), { wrapper });

      await act(async () => {
        result.current.mutate({
          space: 'autoassess',
          externalId: 'plan-001',
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          mapExternalId: 'result-2024-09-15',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              sources: [
                expect.objectContaining({
                  properties: {
                    map: { space: 'autoassess', externalId: 'result-2024-09-15' },
                  },
                }),
              ],
            }),
          ],
        }),
      );
    });

    it('should surface errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useUpdatePlan(), { wrapper });

      await act(async () => {
        result.current.mutate({
          space: 'autoassess',
          externalId: 'plan-001',
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          name: 'X',
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useDeletePlan', () => {
    const mockPlan = {
      space: 'autoassess',
      externalId: 'plan-001',
      areaSpace: 'autoassess',
      areaExternalId: 'area-01581',
    };

    function mockTask(externalId: string): InspectionTask {
      return {
        space: 'autoassess',
        externalId,
        planExternalId: 'plan-001',
        taskKind: 'element',
        inspectionType: 'visual',
      };
    }

    it('should list tasks, delete them, then soft-delete the plan', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const tasks = [mockTask('task-1'), mockTask('task-2')];
      const mockListTasks = vi.fn<() => Promise<InspectionTask[]>>().mockResolvedValue(tasks);
      const mockDeleteTasks = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      const { result } = renderHook(
        () => useDeletePlan({ listTasksForPlan: mockListTasks, deleteTasks: mockDeleteTasks }),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate(mockPlan);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockListTasks).toHaveBeenCalledWith('autoassess', 'plan-001');
      expect(mockDeleteTasks).toHaveBeenCalledWith([
        { space: 'autoassess', externalId: 'task-1' },
        { space: 'autoassess', externalId: 'task-2' },
      ]);
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              externalId: 'plan-001',
              sources: [
                expect.objectContaining({ properties: { deletedAt: expect.any(String) } }),
              ],
            }),
          ],
        }),
      );
    });

    it('should delete tasks before soft-deleting the plan', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const callOrder: string[] = [];
      const mockListTasks = vi
        .fn<() => Promise<InspectionTask[]>>()
        .mockResolvedValue([mockTask('task-1')]);
      const mockDeleteTasks = vi.fn<() => Promise<void>>().mockImplementation(async () => {
        callOrder.push('deleteTasks');
      });
      mockInstancesUpsert.mockImplementation(async () => {
        callOrder.push('deletePlan');
        return { items: [] };
      });

      const { result } = renderHook(
        () => useDeletePlan({ listTasksForPlan: mockListTasks, deleteTasks: mockDeleteTasks }),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate(mockPlan);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(callOrder).toEqual(['deleteTasks', 'deletePlan']);
    });

    it('should still soft-delete the plan when it has no tasks', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const mockListTasks = vi.fn<() => Promise<InspectionTask[]>>().mockResolvedValue([]);
      const mockDeleteTasks = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      const { result } = renderHook(
        () => useDeletePlan({ listTasksForPlan: mockListTasks, deleteTasks: mockDeleteTasks }),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate(mockPlan);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockDeleteTasks).toHaveBeenCalledWith([]);
      expect(mockInstancesUpsert).toHaveBeenCalledOnce();
    });

    it('should invalidate the inspectionPlans query on success', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const mockListTasks = vi.fn<() => Promise<InspectionTask[]>>().mockResolvedValue([]);
      const mockDeleteTasks = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      const { result } = renderHook(
        () => useDeletePlan({ listTasksForPlan: mockListTasks, deleteTasks: mockDeleteTasks }),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate(mockPlan);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['inspectionPlans', 'autoassess', 'area-01581'],
      });
    });

    it('should surface errors from the task list step without deleting the plan', async () => {
      const mockListTasks = vi
        .fn<() => Promise<InspectionTask[]>>()
        .mockRejectedValue(new Error('List failed'));
      const mockDeleteTasks = vi.fn<() => Promise<void>>();

      const { result } = renderHook(
        () => useDeletePlan({ listTasksForPlan: mockListTasks, deleteTasks: mockDeleteTasks }),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate(mockPlan);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('List failed');
      expect(mockDeleteTasks).not.toHaveBeenCalled();
      expect(mockInstancesUpsert).not.toHaveBeenCalled();
    });

    it('should default to chunking real task deletes in batches of 1000', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      mockInstancesDelete.mockResolvedValue({ items: [] });
      const manyTasks = Array.from({ length: 1500 }, (_, i) => mockTask(`task-${i}`));
      const mockListTasks = vi
        .fn<() => Promise<InspectionTask[]>>()
        .mockResolvedValue(manyTasks);

      const { result } = renderHook(() => useDeletePlan({ listTasksForPlan: mockListTasks }), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate(mockPlan);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesDelete).toHaveBeenCalledTimes(2);
      expect(mockInstancesDelete.mock.calls[0][0]).toHaveLength(1000);
      expect(mockInstancesDelete.mock.calls[1][0]).toHaveLength(500);
    });
  });
});
