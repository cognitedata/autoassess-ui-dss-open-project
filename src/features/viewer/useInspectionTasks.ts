import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CdfInspectionTaskService } from './InspectionTaskService';
import type { InspectionTask } from './InspectionTaskService';

type UseInspectionTasksDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseInspectionTasksDeps = { useCogniteSdk };

export const UseInspectionTasksContext =
  createContext<UseInspectionTasksDeps>(defaultDeps);

export function useInspectionTasks(
  planSpace: string,
  planExternalId: string,
): UseQueryResult<InspectionTask[], Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseInspectionTasksContext);
  const sdk = useCogniteSdkDep();
  return useQuery({
    queryKey: ['inspectionTasks', planSpace, planExternalId],
    queryFn: () => new CdfInspectionTaskService(sdk).listForPlan(planSpace, planExternalId),
    enabled: Boolean(planSpace && planExternalId),
  });
}
