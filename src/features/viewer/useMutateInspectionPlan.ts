import { createContext, useContext } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseMutationResult } from '@tanstack/react-query';
import { CdfInspectionPlanService } from './InspectionPlanService';
import type {
  InspectionPlan,
  NewInspectionPlan,
  PlanStatus,
  UpdateInspectionPlanInput,
} from './InspectionPlanService';
import { CdfInspectionTaskService } from './InspectionTaskService';

const DELETE_TASKS_CHUNK_SIZE = 1000;

type UseMutateInspectionPlanDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseMutateInspectionPlanDeps = { useCogniteSdk };

export const UseMutateInspectionPlanContext =
  createContext<UseMutateInspectionPlanDeps>(defaultDeps);

export function useCreatePlan(
  areaSpace: string,
  areaExternalId: string,
): UseMutationResult<InspectionPlan, Error, NewInspectionPlan> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateInspectionPlanContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewInspectionPlan) =>
      new CdfInspectionPlanService(sdk).create(areaSpace, areaExternalId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['inspectionPlans', areaSpace, areaExternalId],
      });
    },
  });
}

export function useUpdatePlanStatus(): UseMutationResult<
  void,
  Error,
  { space: string; externalId: string; areaSpace: string; areaExternalId: string; status: PlanStatus }
> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateInspectionPlanContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId, status }) =>
      new CdfInspectionPlanService(sdk).updateStatus(space, externalId, status),
    onSuccess: (_data, { areaSpace, areaExternalId }) => {
      void queryClient.invalidateQueries({
        queryKey: ['inspectionPlans', areaSpace, areaExternalId],
      });
    },
  });
}

export function useUpdatePlan(): UseMutationResult<
  void,
  Error,
  { space: string; externalId: string; areaSpace: string; areaExternalId: string } &
    UpdateInspectionPlanInput
> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateInspectionPlanContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId, name, description, mapExternalId }) =>
      new CdfInspectionPlanService(sdk).update(space, externalId, {
        name,
        description,
        mapExternalId,
      }),
    onSuccess: (_data, { areaSpace, areaExternalId }) => {
      void queryClient.invalidateQueries({
        queryKey: ['inspectionPlans', areaSpace, areaExternalId],
      });
    },
  });
}

type DeletePlanDeps = {
  listTasksForPlan: (
    planSpace: string,
    planExternalId: string,
  ) => Promise<{ space: string; externalId: string }[]>;
  deleteTasks: (tasks: { space: string; externalId: string }[]) => Promise<void>;
};

export function useDeletePlan(
  overrides?: Partial<DeletePlanDeps>,
): UseMutationResult<
  void,
  Error,
  { space: string; externalId: string; areaSpace: string; areaExternalId: string }
> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateInspectionPlanContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  const defaultDeps: DeletePlanDeps = {
    listTasksForPlan: (planSpace, planExternalId) =>
      new CdfInspectionTaskService(sdk).listForPlan(planSpace, planExternalId),
    deleteTasks: async (tasks) => {
      for (let i = 0; i < tasks.length; i += DELETE_TASKS_CHUNK_SIZE) {
        const chunk = tasks.slice(i, i + DELETE_TASKS_CHUNK_SIZE);
        await sdk.instances.delete(chunk.map((t) => ({ instanceType: 'node' as const, ...t })));
      }
    },
  };
  const { listTasksForPlan, deleteTasks } = { ...defaultDeps, ...overrides };

  return useMutation({
    mutationFn: async ({ space, externalId }) => {
      const tasks = await listTasksForPlan(space, externalId);
      await deleteTasks(tasks.map((t) => ({ space: t.space, externalId: t.externalId })));
      await new CdfInspectionPlanService(sdk).delete(space, externalId);
    },
    onSuccess: (_data, { areaSpace, areaExternalId }) => {
      void queryClient.invalidateQueries({
        queryKey: ['inspectionPlans', areaSpace, areaExternalId],
      });
    },
  });
}
