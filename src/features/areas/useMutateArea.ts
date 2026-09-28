import { createContext, useContext } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseMutationResult } from '@tanstack/react-query';
import { CdfAreaService } from './AreaService';
import type { Area } from './AreaService';

type UseMutateAreaDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseMutateAreaDeps = { useCogniteSdk };

export const UseMutateAreaContext = createContext<UseMutateAreaDeps>(defaultDeps);

export function useDeleteArea(
  vesselExternalId: string,
): UseMutationResult<void, Error, Pick<Area, 'space' | 'externalId'>> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateAreaContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId }: Pick<Area, 'space' | 'externalId'>) =>
      new CdfAreaService(sdk).deleteArea(space, externalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['areas', vesselExternalId] });
    },
  });
}

export function useUpdateArea(
  vesselExternalId: string,
): UseMutationResult<void, Error, Pick<Area, 'space' | 'externalId'> & { name: string }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateAreaContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId, name }) =>
      new CdfAreaService(sdk).updateArea(space, externalId, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['areas', vesselExternalId] });
    },
  });
}

export function useSetGroundPlane(
  space: string,
  externalId: string,
  vesselExternalId: string,
): UseMutationResult<void, Error, [number, number, number]> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateAreaContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (normal: [number, number, number]) =>
      new CdfAreaService(sdk).setGroundPlane(space, externalId, normal),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['area', space, externalId] });
      void queryClient.invalidateQueries({ queryKey: ['areas', vesselExternalId] });
    },
  });
}

export function useSetDefaultCameraPose(
  space: string,
  externalId: string,
  vesselExternalId: string,
): UseMutationResult<void, Error, { position: [number, number, number]; target: [number, number, number] }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateAreaContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ position, target }: { position: [number, number, number]; target: [number, number, number] }) =>
      new CdfAreaService(sdk).setDefaultCameraPose(space, externalId, position, target),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['area', space, externalId] });
      void queryClient.invalidateQueries({ queryKey: ['areas', vesselExternalId] });
    },
  });
}

export function useCreateArea(
  vesselSpace: string,
  vesselExternalId: string,
): UseMutationResult<Area, Error, { name: string; areaType: string }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateAreaContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; areaType: string }) =>
      new CdfAreaService(sdk).createArea({ ...input, vesselSpace, vesselExternalId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['areas', vesselExternalId] });
    },
  });
}
