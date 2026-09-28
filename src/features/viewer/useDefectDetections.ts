import { useCogniteSdk } from '@cognite/app-sdk/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfDefectDetectionService } from './DefectDetectionService';
import type { DefectDetection, DefectStatus, DefectUpdates, NewManualDefect } from './DefectDetectionService';

// ---- Dependency injection for useCogniteSdk ----

type UseDefectDetectionsDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseDefectDetectionsDeps = { useCogniteSdk };

export const UseDefectDetectionsContext =
  createContext<UseDefectDetectionsDeps>(defaultDeps);

// ---- Query key factory ----

const queryKey = (areaSpace: string, areaExternalId: string) =>
  ['defectDetections', areaSpace, areaExternalId] as const;

// ---- Query hook ----

export function useDefectDetections(
  areaSpace: string,
  areaExternalId: string,
): UseQueryResult<DefectDetection[], Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDefectDetectionsContext);
  const sdk = useCogniteSdkDep();

  return useQuery({
    queryKey: queryKey(areaSpace, areaExternalId),
    queryFn: () =>
      new CdfDefectDetectionService(sdk).listForArea(areaSpace, areaExternalId),
    enabled: Boolean(areaSpace && areaExternalId),
    staleTime: 5 * 60 * 1000,
  });
}

// ---- Mutation hooks ----

export function useUpdateDefectStatus(
  areaSpace: string,
  areaExternalId: string,
): UseMutationResult<void, Error, { space: string; externalId: string; status: DefectStatus }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDefectDetectionsContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId, status }) =>
      new CdfDefectDetectionService(sdk).updateStatus(space, externalId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKey(areaSpace, areaExternalId),
      });
    },
  });
}

export function useUpdateDefect(
  areaSpace: string,
  areaExternalId: string,
): UseMutationResult<void, Error, { space: string; externalId: string; updates: DefectUpdates }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDefectDetectionsContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId, updates }) =>
      new CdfDefectDetectionService(sdk).update(space, externalId, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKey(areaSpace, areaExternalId),
      });
    },
  });
}

export function useCreateDefect(
  areaSpace: string,
  areaExternalId: string,
): UseMutationResult<DefectDetection, Error, NewManualDefect> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDefectDetectionsContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newDefect) =>
      new CdfDefectDetectionService(sdk).createManual(areaSpace, areaExternalId, newDefect),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKey(areaSpace, areaExternalId),
      });
    },
  });
}

export function useDeleteDefect(
  areaSpace: string,
  areaExternalId: string,
): UseMutationResult<void, Error, { space: string; externalId: string }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDefectDetectionsContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId }) =>
      new CdfDefectDetectionService(sdk).delete(space, externalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKey(areaSpace, areaExternalId),
      });
    },
  });
}
