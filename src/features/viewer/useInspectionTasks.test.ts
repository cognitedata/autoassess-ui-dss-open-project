import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInspectionTasks, UseInspectionTasksContext } from './useInspectionTasks';
import { INSPECTION_TASK_VIEW } from '../../shared/cdf/dataModel';
import type { CogniteClient } from '@cognite/sdk';

function makeTaskNode(externalId = 'task-abc') {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId,
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

// Re-export type so it can be used below
type ContextType = { useCogniteSdk: () => CogniteClient };

describe(useInspectionTasks.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockSdk = {
      instances: { list: mockInstancesList },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseInspectionTasksContext.Provider, { value: mockContext }, children),
      );
  });

  it('should return loading state initially', () => {
    mockInstancesList.mockResolvedValue({ items: [] });
    const { result } = renderHook(
      () => useInspectionTasks('autoassess', 'plan-001'),
      { wrapper },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('should return tasks on success', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeTaskNode()] });
    const { result } = renderHook(
      () => useInspectionTasks('autoassess', 'plan-001'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].externalId).toBe('task-abc');
  });

  it('should return error state on failure', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(
      () => useInspectionTasks('autoassess', 'plan-001'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should not fetch when planExternalId is empty', () => {
    const { result } = renderHook(
      () => useInspectionTasks('autoassess', ''),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockInstancesList).not.toHaveBeenCalled();
  });
});
