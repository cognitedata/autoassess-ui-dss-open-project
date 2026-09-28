import { createContext, useContext } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseMutationResult } from '@tanstack/react-query';
import { CdfVesselService } from './VesselService';
import type { Vessel, NewVessel } from './VesselService';
import { CdfAreaService } from '../areas/AreaService';
import type { Area } from '../areas/AreaService';

type UseMutateVesselDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseMutateVesselDeps = { useCogniteSdk };

export const UseMutateVesselContext = createContext<UseMutateVesselDeps>(defaultDeps);

type DeleteVesselDeps = {
  listAreasForVessel: (space: string, externalId: string) => Promise<Area[]>;
};

export function useDeleteVessel(overrides?: Partial<DeleteVesselDeps>): UseMutationResult<void, Error, Pick<Vessel, 'space' | 'externalId'>> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateVesselContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();
  const defaultDeps: DeleteVesselDeps = {
    listAreasForVessel: (space, externalId) =>
      new CdfAreaService(sdk).listAreasForVessel(space, externalId),
  };
  const { listAreasForVessel } = { ...defaultDeps, ...overrides };

  return useMutation({
    mutationFn: async (vessel: Pick<Vessel, 'space' | 'externalId'>) => {
      const areas = await listAreasForVessel(vessel.space, vessel.externalId);
      await Promise.all(areas.map((a) => new CdfAreaService(sdk).deleteArea(a.space, a.externalId)));
      await new CdfVesselService(sdk).deleteVessel(vessel.space, vessel.externalId);
    },
    onSuccess: (_data, vessel) => {
      void queryClient.invalidateQueries({ queryKey: ['vessels'] });
      void queryClient.invalidateQueries({ queryKey: ['areas', vessel.externalId] });
    },
  });
}

export function useUpdateVessel(): UseMutationResult<void, Error, Pick<Vessel, 'space' | 'externalId'> & { name: string }> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateVesselContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ space, externalId, name }) =>
      new CdfVesselService(sdk).updateVessel(space, externalId, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vessels'] });
    },
  });
}

export function useCreateVessel(): UseMutationResult<Vessel, Error, NewVessel> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseMutateVesselContext);
  const sdk = useCogniteSdkDep();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewVessel) => new CdfVesselService(sdk).createVessel(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vessels'] });
    },
  });
}
