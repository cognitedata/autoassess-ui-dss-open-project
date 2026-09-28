import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { useInspectionPlans as defaultUseInspectionPlans } from './useInspectionPlans';
import { useInspectionTasks as defaultUseInspectionTasks } from './useInspectionTasks';
import { useInspectionResults as defaultUseInspectionResults } from './useInspectionResults';
import type { InspectionResult } from './InspectionResultService';
import {
  useCreatePlan as defaultUseCreatePlan,
  useUpdatePlanStatus as defaultUseUpdatePlanStatus,
  useUpdatePlan as defaultUseUpdatePlan,
  useDeletePlan as defaultUseDeletePlan,
} from './useMutateInspectionPlan';
import { useAddTask as defaultUseAddTask } from './useMutateInspectionTask';
import { useRemoveTask as defaultUseRemoveTask } from './useMutateInspectionTask';
import { useActivePlanStore } from './activePlanStore';
import type {
  InspectionPlan,
  NewInspectionPlan,
  UpdateInspectionPlanInput,
  PlanStatus,
} from './InspectionPlanService';
import type { InspectionTask, InspectionType, NewTask } from './InspectionTaskService';
import type { SelectionHit } from './selection';

const DEFAULT_REGION_RADIUS_M = 0.3;

// ---- Dependency injection types ----

type UseInspectionPlansFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<InspectionPlan[], Error>;

type UseInspectionResultsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<InspectionResult[], Error>;

/** A selectable reference map for a plan — a completed scan (campaign) of the area. */
export interface MapOption {
  externalId: string;
  label: string;
}

type UseInspectionTasksFn = (
  planSpace: string,
  planExternalId: string,
) => UseQueryResult<InspectionTask[], Error>;

type UseCreatePlanFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseMutationResult<InspectionPlan, Error, NewInspectionPlan>;

type UseUpdatePlanStatusFn = () => UseMutationResult<
  void,
  Error,
  { space: string; externalId: string; areaSpace: string; areaExternalId: string; status: PlanStatus }
>;

type UseUpdatePlanFn = () => UseMutationResult<
  void,
  Error,
  { space: string; externalId: string; areaSpace: string; areaExternalId: string } &
    UpdateInspectionPlanInput
>;

type UseDeletePlanFn = () => UseMutationResult<
  void,
  Error,
  { space: string; externalId: string; areaSpace: string; areaExternalId: string }
>;

type UseAddTaskFn = (
  planSpace: string,
  planExternalId: string,
) => UseMutationResult<InspectionTask, Error, NewTask>;

type UseRemoveTaskFn = (
  planSpace: string,
  planExternalId: string,
) => UseMutationResult<void, Error, { space: string; externalId: string }>;

export type InspectionPlansViewModelContextType = {
  useInspectionPlans: UseInspectionPlansFn;
  useInspectionTasks: UseInspectionTasksFn;
  useInspectionResults: UseInspectionResultsFn;
  useCreatePlan: UseCreatePlanFn;
  useUpdatePlanStatus: UseUpdatePlanStatusFn;
  useUpdatePlan: UseUpdatePlanFn;
  useDeletePlan: UseDeletePlanFn;
  useAddTask: UseAddTaskFn;
  useRemoveTask: UseRemoveTaskFn;
};

const defaultDeps: InspectionPlansViewModelContextType = {
  useInspectionPlans: defaultUseInspectionPlans,
  useInspectionTasks: defaultUseInspectionTasks,
  useInspectionResults: defaultUseInspectionResults,
  useCreatePlan: defaultUseCreatePlan,
  useUpdatePlanStatus: defaultUseUpdatePlanStatus,
  useUpdatePlan: defaultUseUpdatePlan,
  useDeletePlan: defaultUseDeletePlan,
  useAddTask: defaultUseAddTask,
  useRemoveTask: defaultUseRemoveTask,
};

export const InspectionPlansViewModelContext =
  createContext<InspectionPlansViewModelContextType>(defaultDeps);

// ---- Public interface ----

export interface InspectionPlansViewModel {
  plans: InspectionPlan[];
  isLoadingPlans: boolean;
  activePlan: InspectionPlan | null;
  tasks: InspectionTask[];
  isLoadingTasks: boolean;
  /** Completed scans (campaigns) for the area, newest first — selectable as a plan's reference map. */
  availableMaps: MapOption[];
  /** The latest completed scan's externalId, or null if the area has none yet. */
  defaultMapExternalId: string | null;
  /** False when the area has no completed scan — a plan cannot be created without a map. */
  canCreatePlan: boolean;
  createPlan(input: NewInspectionPlan): void;
  isCreatingPlan: boolean;
  selectPlan(plan: InspectionPlan): void;
  deactivatePlan(): void;
  /** Toggle Draft ↔ Ready. No-op when plan is In Progress or Complete (read-only). */
  togglePlanStatus(): void;
  isTogglingStatus: boolean;
  updatePlan(input: UpdateInspectionPlanInput): void;
  isUpdatingPlan: boolean;
  deletePlan(): void;
  isDeletingPlan: boolean;
  addTaskFromHit(hit: SelectionHit, inspectionType: InspectionType): void;
  /** Add a task directly from a NewTask (e.g. from a recommendation). */
  addTask(task: NewTask): void;
  isAddingTask: boolean;
  removeTask(space: string, externalId: string): void;
}

// ---- Implementation ----

export function useInspectionPlansViewModel(
  areaSpace: string,
  areaExternalId: string,
): InspectionPlansViewModel {
  const {
    useInspectionPlans,
    useInspectionTasks,
    useInspectionResults,
    useCreatePlan,
    useUpdatePlanStatus,
    useUpdatePlan,
    useDeletePlan,
    useAddTask,
    useRemoveTask,
  } = useContext(InspectionPlansViewModelContext);

  const activePlan = useActivePlanStore((s) => s.activePlan);
  const setActivePlan = useActivePlanStore((s) => s.setActivePlan);
  const clearActivePlan = useActivePlanStore((s) => s.clearActivePlan);
  const setActivePlanTasks = useActivePlanStore((s) => s.setActivePlanTasks);
  const updateActivePlan = useActivePlanStore((s) => s.updateActivePlan);

  const plansQuery = useInspectionPlans(areaSpace, areaExternalId);
  const tasksQuery = useInspectionTasks(
    activePlan?.space ?? '',
    activePlan?.externalId ?? '',
  );
  const resultsQuery = useInspectionResults(areaSpace, areaExternalId);

  const availableMaps = useMemo<MapOption[]>(
    () =>
      (resultsQuery.data ?? [])
        .filter((r) => r.status === 'Complete')
        .map((r) => ({ externalId: r.externalId, label: `Campaign ${r.date}` })),
    [resultsQuery.data],
  );
  const defaultMapExternalId = availableMaps[0]?.externalId ?? null;

  // Sync React Query task results into the store so 3D layers can observe imperatively.
  const tasks = tasksQuery.data ?? [];
  useEffect(() => {
    setActivePlanTasks(tasks);
  }, [tasks, setActivePlanTasks]);

  const createPlanMutation = useCreatePlan(areaSpace, areaExternalId);
  const updateStatusMutation = useUpdatePlanStatus();
  const updatePlanMutation = useUpdatePlan();
  const deletePlanMutation = useDeletePlan();
  const addTaskMutation = useAddTask(
    activePlan?.space ?? '',
    activePlan?.externalId ?? '',
  );
  const removeTaskMutation = useRemoveTask(
    activePlan?.space ?? '',
    activePlan?.externalId ?? '',
  );

  const createPlan = useCallback(
    (input: NewInspectionPlan) => {
      createPlanMutation.mutate(input, {
        onSuccess: (newPlan) => setActivePlan(newPlan),
      });
    },
    [createPlanMutation, setActivePlan],
  );

  const togglePlanStatus = useCallback(() => {
    if (!activePlan) return;
    if (activePlan.status !== 'Draft' && activePlan.status !== 'Ready') return;
    const newStatus: PlanStatus = activePlan.status === 'Draft' ? 'Ready' : 'Draft';
    updateStatusMutation.mutate(
      {
        space: activePlan.space,
        externalId: activePlan.externalId,
        areaSpace,
        areaExternalId,
        status: newStatus,
      },
      {
        onSuccess: () => updateActivePlan((p) => ({ ...p, status: newStatus })),
      },
    );
  }, [activePlan, updateStatusMutation, areaSpace, areaExternalId, updateActivePlan]);

  const updatePlan = useCallback(
    (input: UpdateInspectionPlanInput) => {
      if (!activePlan) return;
      // The map can only be changed while the plan is Draft — once Ready, it's
      // locked like its tasks. The UI already prevents reaching this state;
      // this guard is defense-in-depth against stale/direct callers.
      const { mapExternalId, ...rest } = input;
      const safeInput: UpdateInspectionPlanInput =
        activePlan.status === 'Draft' ? input : rest;
      updatePlanMutation.mutate(
        {
          space: activePlan.space,
          externalId: activePlan.externalId,
          areaSpace,
          areaExternalId,
          ...safeInput,
        },
        {
          onSuccess: () =>
            updateActivePlan((p) => ({
              ...p,
              ...(safeInput.name !== undefined && { name: safeInput.name.trim() || null }),
              ...(safeInput.description !== undefined && {
                description: safeInput.description.trim() || null,
              }),
              ...(safeInput.mapExternalId !== undefined && {
                mapExternalId: safeInput.mapExternalId,
              }),
            })),
        },
      );
    },
    [activePlan, updatePlanMutation, areaSpace, areaExternalId, updateActivePlan],
  );

  const deletePlan = useCallback(() => {
    if (!activePlan) return;
    deletePlanMutation.mutate(
      { space: activePlan.space, externalId: activePlan.externalId, areaSpace, areaExternalId },
      { onSuccess: () => clearActivePlan() },
    );
  }, [activePlan, deletePlanMutation, areaSpace, areaExternalId, clearActivePlan]);

  const addTask = useCallback(
    (task: NewTask) => {
      if (!activePlan || activePlan.status !== 'Draft') return;
      addTaskMutation.mutate(task);
    },
    [activePlan, addTaskMutation],
  );

  const addTaskFromHit = useCallback(
    (hit: SelectionHit, inspectionType: InspectionType) => {
      if (!activePlan || activePlan.status !== 'Draft') return;

      if (hit.kind === 'ndt' || hit.kind === 'task' || hit.kind === 'image') return;

      const newTask: NewTask =
        hit.kind === 'element'
          ? {
              taskKind: 'element',
              inspectionType,
              targetElementExternalId: hit.element.externalId,
            }
          : hit.kind === 'region'
            ? {
                taskKind: 'region',
                inspectionType,
                position3d: [hit.position.x, hit.position.y, hit.position.z],
                normalVector: [hit.normal.x, hit.normal.y, hit.normal.z],
                radiusM: DEFAULT_REGION_RADIUS_M,
              }
            : {
                taskKind: 'region',
                inspectionType,
                position3d: hit.defect.boundingBox3d.slice(0, 3) as [number, number, number],
                normalVector: hit.defect.normal3d ?? [0, 1, 0],
                radiusM: DEFAULT_REGION_RADIUS_M,
              };

      addTaskMutation.mutate(newTask);
    },
    [activePlan, addTaskMutation],
  );

  const removeTask = useCallback(
    (space: string, externalId: string) => {
      removeTaskMutation.mutate({ space, externalId });
    },
    [removeTaskMutation],
  );

  return {
    plans: plansQuery.data ?? [],
    isLoadingPlans: plansQuery.isLoading,
    activePlan,
    tasks,
    isLoadingTasks: tasksQuery.isLoading,
    availableMaps,
    defaultMapExternalId,
    canCreatePlan: availableMaps.length > 0,
    createPlan,
    isCreatingPlan: createPlanMutation.isPending,
    selectPlan: setActivePlan,
    deactivatePlan: clearActivePlan,
    togglePlanStatus,
    isTogglingStatus: updateStatusMutation.isPending,
    updatePlan,
    isUpdatingPlan: updatePlanMutation.isPending,
    deletePlan,
    isDeletingPlan: deletePlanMutation.isPending,
    addTask,
    addTaskFromHit,
    isAddingTask: addTaskMutation.isPending,
    removeTask,
  };
}
