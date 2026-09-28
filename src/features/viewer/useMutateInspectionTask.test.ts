import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAddTask,
  useRemoveTask,
  UseMutateInspectionTaskContext,
} from './useMutateInspectionTask';
import { INSPECTION_TASK_VIEW } from '../../shared/cdf/dataModel';
import type { CogniteClient } from '@cognite/sdk';

function makeTaskNode() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'task-new-001',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [INSPECTION_TASK_VIEW.space]: {
        [`${INSPECTION_TASK_VIEW.externalId}/${INSPECTION_TASK_VIEW.version}`]: {
          plan: { space: 'autoassess', externalId: 'plan-001' },
          taskType: 'element',
          inspectionType: 'visual',
          targetElement: { space: 'autoassess', externalId: 'element-3-15' },
        },
      },
    },
  };
}

describe('useMutateInspectionTask', () => {
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockInstancesDelete: ReturnType<typeof vi.fn>;
  let mockContext: { useCogniteSdk: () => CogniteClient };
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesUpsert = vi.fn();
    mockInstancesDelete = vi.fn();
    const mockSdk = {
      instances: {
        upsert: mockInstancesUpsert,
        delete: mockInstancesDelete,
      },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseMutateInspectionTaskContext.Provider, { value: mockContext }, children),
      );
  });

  describe('useAddTask', () => {
    it('should add an element task and return the created task', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeTaskNode()] });

      const { result } = renderHook(
        () => useAddTask('autoassess', 'plan-001'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({
          taskKind: 'element',
          inspectionType: 'visual',
          targetElementExternalId: 'element-3-15',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.taskKind).toBe('element');
    });

    it('should add a region task', async () => {
      const regionNode = {
        ...makeTaskNode(),
        properties: {
          [INSPECTION_TASK_VIEW.space]: {
            [`${INSPECTION_TASK_VIEW.externalId}/${INSPECTION_TASK_VIEW.version}`]: {
              plan: { space: 'autoassess', externalId: 'plan-001' },
              taskType: 'region',
              inspectionType: 'ndt_thickness',
              position3d: [1, 2, 3],
              normalVector: [0, 1, 0],
              radiusM: 0.3,
            },
          },
        },
      };
      mockInstancesUpsert.mockResolvedValue({ items: [regionNode] });

      const { result } = renderHook(
        () => useAddTask('autoassess', 'plan-001'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({
          taskKind: 'region',
          inspectionType: 'ndt_thickness',
          position3d: [1, 2, 3],
          normalVector: [0, 1, 0],
          radiusM: 0.3,
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.taskKind).toBe('region');
    });

    it('should surface errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useAddTask('autoassess', 'plan-001'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({
          taskKind: 'element',
          inspectionType: 'visual',
          targetElementExternalId: 'element-3-15',
        });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useRemoveTask', () => {
    it('should call delete with the correct space and externalId', async () => {
      mockInstancesDelete.mockResolvedValue({ items: [] });

      const { result } = renderHook(
        () => useRemoveTask('autoassess', 'plan-001'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({ space: 'autoassess', externalId: 'task-abc-123' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesDelete).toHaveBeenCalledWith([
        { instanceType: 'node', space: 'autoassess', externalId: 'task-abc-123' },
      ]);
    });

    it('should surface errors', async () => {
      mockInstancesDelete.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useRemoveTask('autoassess', 'plan-001'),
        { wrapper },
      );

      await act(async () => {
        result.current.mutate({ space: 'autoassess', externalId: 'task-abc-123' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });
});
