import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import {
  useInspectionPlansViewModel,
  InspectionPlansViewModelContext,
} from './useInspectionPlansViewModel';
import type { InspectionPlansViewModelContextType } from './useInspectionPlansViewModel';
import { useActivePlanStore } from './activePlanStore';
import { createMockInspectionPlan } from '../../__mocks__/inspectionPlans';
import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import { createMockElementTask, createMockRegionTask } from '../../__mocks__/inspectionTasks';
import type {
  InspectionPlan,
  NewInspectionPlan,
  UpdateInspectionPlanInput,
  PlanStatus,
} from './InspectionPlanService';
import type { InspectionResult } from './InspectionResultService';
import type { InspectionTask, NewTask } from './InspectionTaskService';
import { Vector3 } from 'three';

// ---- Query result helpers ----

function makeSuccess<T>(data: T): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    error: null,
    status: 'success',
    isSuccess: true,
    isError: false,
    isPending: false,
    isFetching: false,
  } as UseQueryResult<T, Error>;
}

function makePending<T>(): UseQueryResult<T, Error> {
  return {
    data: undefined,
    isLoading: true,
    error: null,
    status: 'pending',
    isSuccess: false,
    isError: false,
    isPending: true,
    isFetching: true,
  } as UseQueryResult<T, Error>;
}

function makeMutation<TData, TVariables>(
  overrides: Partial<UseMutationResult<TData, Error, TVariables>> = {},
): UseMutationResult<TData, Error, TVariables> {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    data: undefined,
    error: null,
    reset: vi.fn(),
    status: 'idle',
    variables: undefined,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    submittedAt: 0,
    ...overrides,
  } as unknown as UseMutationResult<TData, Error, TVariables>;
}

// ---- Test suite ----

describe(useInspectionPlansViewModel.name, () => {
  let mockDeps: InspectionPlansViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    // Reset Zustand store
    useActivePlanStore.setState({ activePlan: null, activePlanTasks: [] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    mockDeps = {
      useInspectionPlans: vi.fn(() => makeSuccess([])),
      useInspectionTasks: vi.fn(() => makeSuccess([])),
      useInspectionResults: vi.fn(() => makeSuccess<InspectionResult[]>([])),
      useCreatePlan: vi.fn(() => makeMutation<InspectionPlan, NewInspectionPlan>()),
      useUpdatePlanStatus: vi.fn(() => makeMutation<void, { space: string; externalId: string; areaSpace: string; areaExternalId: string; status: PlanStatus }>()),
      useUpdatePlan: vi.fn(() =>
        makeMutation<
          void,
          { space: string; externalId: string; areaSpace: string; areaExternalId: string } &
            UpdateInspectionPlanInput
        >(),
      ),
      useDeletePlan: vi.fn(() =>
        makeMutation<
          void,
          { space: string; externalId: string; areaSpace: string; areaExternalId: string }
        >(),
      ),
      useAddTask: vi.fn(() => makeMutation<InspectionTask, NewTask>()),
      useRemoveTask: vi.fn(() => makeMutation<void, { space: string; externalId: string }>()),
    };

    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          InspectionPlansViewModelContext.Provider,
          { value: mockDeps },
          children,
        ),
      );
  });

  it('should return isLoadingPlans=true when plans are loading', () => {
    vi.mocked(mockDeps.useInspectionPlans).mockReturnValue(makePending());

    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isLoadingPlans).toBe(true);
    expect(result.current.plans).toEqual([]);
  });

  it('should return plans list when loaded', () => {
    const plan = createMockInspectionPlan();
    vi.mocked(mockDeps.useInspectionPlans).mockReturnValue(makeSuccess([plan]));

    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.plans).toEqual([plan]);
  });

  it('should have no active plan initially', () => {
    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );
    expect(result.current.activePlan).toBeNull();
  });

  it('should set active plan on selectPlan', () => {
    const plan = createMockInspectionPlan();
    vi.mocked(mockDeps.useInspectionPlans).mockReturnValue(makeSuccess([plan]));

    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.selectPlan(plan);
    });

    expect(result.current.activePlan).toEqual(plan);
  });

  it('should clear active plan on deactivatePlan', () => {
    useActivePlanStore.setState({ activePlan: createMockInspectionPlan() });

    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.deactivatePlan();
    });

    expect(result.current.activePlan).toBeNull();
  });

  it('should return tasks for the active plan', async () => {
    const plan = createMockInspectionPlan();
    useActivePlanStore.setState({ activePlan: plan });
    const tasks = [createMockElementTask()];
    vi.mocked(mockDeps.useInspectionTasks).mockReturnValue(makeSuccess(tasks));

    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.tasks).toEqual(tasks));
  });

  it('should sync tasks into activePlanStore', async () => {
    const plan = createMockInspectionPlan();
    useActivePlanStore.setState({ activePlan: plan });
    const tasks = [createMockElementTask(), createMockRegionTask()];
    vi.mocked(mockDeps.useInspectionTasks).mockReturnValue(makeSuccess(tasks));

    renderHook(() => useInspectionPlansViewModel('autoassess', 'area-01581'), { wrapper });

    await waitFor(() =>
      expect(useActivePlanStore.getState().activePlanTasks).toEqual(tasks),
    );
  });

  it('should call createPlan mutation with the given input and setActivePlan on success', () => {
    const newPlan = createMockInspectionPlan({ externalId: 'plan-new', name: 'Q3 hull survey' });
    const mutateMock = vi.fn().mockImplementation((_vars, options) => {
      options?.onSuccess?.(newPlan);
    });
    vi.mocked(mockDeps.useCreatePlan).mockReturnValue(
      makeMutation<InspectionPlan, NewInspectionPlan>({ mutate: mutateMock }),
    );

    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.createPlan({ name: 'Q3 hull survey', mapExternalId: 'result-2024-09-15' });
    });

    expect(mutateMock).toHaveBeenCalledWith(
      { name: 'Q3 hull survey', mapExternalId: 'result-2024-09-15' },
      expect.any(Object),
    );
    expect(useActivePlanStore.getState().activePlan?.externalId).toBe('plan-new');
  });

  describe('availableMaps', () => {
    it('should list only Complete inspection results as available maps, newest first', () => {
      vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
        makeSuccess<InspectionResult[]>([
          createMockInspectionResult({ externalId: 'result-new', date: '2024-09-15', status: 'Complete' }),
          createMockInspectionResult({ externalId: 'result-in-progress', date: '2024-10-01', status: 'InProgress' }),
        ]),
      );

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      expect(result.current.availableMaps).toEqual([
        { externalId: 'result-new', label: 'Campaign 2024-09-15' },
      ]);
      expect(result.current.defaultMapExternalId).toBe('result-new');
      expect(result.current.canCreatePlan).toBe(true);
    });

    it('should report canCreatePlan=false and defaultMapExternalId=null when the area has no completed scan', () => {
      vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
        makeSuccess<InspectionResult[]>([
          createMockInspectionResult({ externalId: 'result-in-progress', status: 'InProgress' }),
        ]),
      );

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      expect(result.current.availableMaps).toEqual([]);
      expect(result.current.defaultMapExternalId).toBeNull();
      expect(result.current.canCreatePlan).toBe(false);
    });
  });

  describe('togglePlanStatus', () => {
    it('should toggle Draft → Ready', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useUpdatePlanStatus).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.togglePlanStatus();
      });

      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Ready' }),
        expect.any(Object),
      );
    });

    it('should toggle Ready → Draft', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useUpdatePlanStatus).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.togglePlanStatus();
      });

      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Draft' }),
        expect.any(Object),
      );
    });

    it('should not toggle when status is Complete', () => {
      const plan = createMockInspectionPlan({ status: 'Complete' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useUpdatePlanStatus).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.togglePlanStatus();
      });

      expect(mutateMock).not.toHaveBeenCalled();
    });
  });

  describe('updatePlan', () => {
    it('should call the update mutation with the active plan ids and input', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useUpdatePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.updatePlan({ name: 'Q3 hull survey' });
      });

      expect(mutateMock).toHaveBeenCalledWith(
        {
          space: plan.space,
          externalId: plan.externalId,
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          name: 'Q3 hull survey',
        },
        expect.any(Object),
      );
    });

    it('should update the active plan in the store on success', () => {
      const plan = createMockInspectionPlan({ status: 'Draft', name: 'Old name' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn().mockImplementation((_vars, options) => {
        options?.onSuccess?.();
      });
      vi.mocked(mockDeps.useUpdatePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.updatePlan({ name: 'New name' });
      });

      expect(useActivePlanStore.getState().activePlan?.name).toBe('New name');
    });

    it('should no-op when there is no active plan', () => {
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useUpdatePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.updatePlan({ name: 'New name' });
      });

      expect(mutateMock).not.toHaveBeenCalled();
    });

    it('should forward mapExternalId when the active plan is Draft', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useUpdatePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.updatePlan({ mapExternalId: 'result-2024-09-15' });
      });

      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ mapExternalId: 'result-2024-09-15' }),
        expect.any(Object),
      );
    });

    it('should strip mapExternalId when the active plan is not Draft', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useUpdatePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.updatePlan({ mapExternalId: 'result-2024-09-15', name: 'New name' });
      });

      expect(mutateMock).toHaveBeenCalledWith(
        {
          space: plan.space,
          externalId: plan.externalId,
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
          name: 'New name',
        },
        expect.any(Object),
      );
    });

    it('should update the active plan mapExternalId in the store on success', () => {
      const plan = createMockInspectionPlan({ status: 'Draft', mapExternalId: 'result-old' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn().mockImplementation((_vars, options) => {
        options?.onSuccess?.();
      });
      vi.mocked(mockDeps.useUpdatePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.updatePlan({ mapExternalId: 'result-new' });
      });

      expect(useActivePlanStore.getState().activePlan?.mapExternalId).toBe('result-new');
    });
  });

  describe('deletePlan', () => {
    it('should call the delete mutation with the active plan ids', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useDeletePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.deletePlan();
      });

      expect(mutateMock).toHaveBeenCalledWith(
        {
          space: plan.space,
          externalId: plan.externalId,
          areaSpace: 'autoassess',
          areaExternalId: 'area-01581',
        },
        expect.any(Object),
      );
    });

    it('should clear the active plan on success', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn().mockImplementation((_vars, options) => {
        options?.onSuccess?.();
      });
      vi.mocked(mockDeps.useDeletePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.deletePlan();
      });

      expect(result.current.activePlan).toBeNull();
    });

    it('should no-op when there is no active plan', () => {
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useDeletePlan).mockReturnValue(makeMutation({ mutate: mutateMock }));

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.deletePlan();
      });

      expect(mutateMock).not.toHaveBeenCalled();
    });
  });

  describe('addTaskFromHit', () => {
    it('should add element task from element selection hit', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useAddTask).mockReturnValue(
        makeMutation<InspectionTask, NewTask>({ mutate: mutateMock }),
      );

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.addTaskFromHit(
          {
            kind: 'element',
            element: {
              space: 'autoassess',
              externalId: 'element-3-15',
              elementType: 'wall',
              label: 3015,
              center: [1, 2, 3],
              areaExternalId: 'area-01581',
            },
          },
          'visual',
        );
      });

      expect(mutateMock).toHaveBeenCalledWith({
        taskKind: 'element',
        inspectionType: 'visual',
        targetElementExternalId: 'element-3-15',
      });
    });

    it('should add region task from region selection hit', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useAddTask).mockReturnValue(
        makeMutation<InspectionTask, NewTask>({ mutate: mutateMock }),
      );

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.addTaskFromHit(
          {
            kind: 'region',
            position: new Vector3(1.1, 2.2, 3.3),
            normal: new Vector3(0, 1, 0),
          },
          'ndt_thickness',
        );
      });

      expect(mutateMock).toHaveBeenCalledWith({
        taskKind: 'region',
        inspectionType: 'ndt_thickness',
        position3d: [1.1, 2.2, 3.3],
        normalVector: [0, 1, 0],
        radiusM: 0.3,
      });
    });

    it('should no-op when no active plan', () => {
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useAddTask).mockReturnValue(
        makeMutation<InspectionTask, NewTask>({ mutate: mutateMock }),
      );

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.addTaskFromHit(
          { kind: 'element', element: { space: 'a', externalId: 'e', elementType: 'wall', label: 1, center: [0, 0, 0], areaExternalId: 'x' } },
          'visual',
        );
      });

      expect(mutateMock).not.toHaveBeenCalled();
    });

    it('should no-op when plan is not Draft', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      useActivePlanStore.setState({ activePlan: plan });
      const mutateMock = vi.fn();
      vi.mocked(mockDeps.useAddTask).mockReturnValue(
        makeMutation<InspectionTask, NewTask>({ mutate: mutateMock }),
      );

      const { result } = renderHook(
        () => useInspectionPlansViewModel('autoassess', 'area-01581'),
        { wrapper },
      );

      act(() => {
        result.current.addTaskFromHit(
          { kind: 'element', element: { space: 'a', externalId: 'e', elementType: 'wall', label: 1, center: [0, 0, 0], areaExternalId: 'x' } },
          'visual',
        );
      });

      expect(mutateMock).not.toHaveBeenCalled();
    });
  });

  it('should call removeTask mutation', () => {
    const plan = createMockInspectionPlan({ status: 'Draft' });
    useActivePlanStore.setState({ activePlan: plan });
    const mutateMock = vi.fn();
    vi.mocked(mockDeps.useRemoveTask).mockReturnValue(makeMutation({ mutate: mutateMock }));

    const { result } = renderHook(
      () => useInspectionPlansViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.removeTask('autoassess', 'task-abc-123');
    });

    expect(mutateMock).toHaveBeenCalledWith({ space: 'autoassess', externalId: 'task-abc-123' });
  });
});
