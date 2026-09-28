import { createContext, useContext } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseMutationResult } from '@tanstack/react-query';
import { CdfInspectionTaskService } from './InspectionTaskService';
import type { InspectionTask, NewTask } from './InspectionTaskService';

type UseMutateInspectionTaskDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseMutateInspectionTaskDeps = { useCogniteSdk };

export const UseMutateInspectionTaskContext =
  createContext<UseMutateInspectionTaskDeps>(defaultDeps);

export function useAddTask(
  planSpace: string,
  planExternalId: string,
): UseMutationResult<InspectionTask, Error, NewTask> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateInspectionTaskContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: NewTask) =>
      new CdfInspectionTaskService(sdk).addTask(planSpace, planExternalId, task),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['inspectionTasks', planSpace, planExternalId],
      });
    },
  });
}

export function useRemoveTask(
  planSpace: string,
  planExternalId: string,
): UseMutationResult<void, Error, { space: string; externalId: string }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateInspectionTaskContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId }) =>
      new CdfInspectionTaskService(sdk).removeTask(space, externalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['inspectionTasks', planSpace, planExternalId],
      });
    },
  });
}
