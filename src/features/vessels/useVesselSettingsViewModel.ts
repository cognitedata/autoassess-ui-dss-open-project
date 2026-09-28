import { createContext, useCallback, useContext } from 'react';
import { useVessel as defaultUseVessel } from './useVessel';
import { useUpdateVessel as defaultUseUpdateVessel, useDeleteVessel as defaultUseDeleteVessel } from './useMutateVessel';
import type { Vessel } from './VesselService';

type UseVesselFn = (externalId: string) => {
  data: Vessel | undefined;
  isLoading: boolean;
  error: Error | null;
};

type UseUpdateVesselFn = () => {
  mutate: (input: Pick<Vessel, 'space' | 'externalId'> & { name: string }) => void;
  isPending: boolean;
};

type UseDeleteVesselFn = () => {
  mutate: (vessel: Pick<Vessel, 'space' | 'externalId'>) => void;
  isPending: boolean;
};

export type VesselSettingsViewModelContextType = {
  useVessel: UseVesselFn;
  useUpdateVessel: UseUpdateVesselFn;
  useDeleteVessel: UseDeleteVesselFn;
};

const defaultDeps: VesselSettingsViewModelContextType = {
  useVessel: defaultUseVessel,
  useUpdateVessel: defaultUseUpdateVessel,
  useDeleteVessel: defaultUseDeleteVessel,
};

export const VesselSettingsViewModelContext =
  createContext<VesselSettingsViewModelContextType>(defaultDeps);

export interface VesselSettingsViewModel {
  vessel: Vessel | undefined;
  isLoading: boolean;
  error: Error | null;
  updateVessel: (name: string) => void;
  isUpdating: boolean;
  deleteVessel: () => void;
  isDeleting: boolean;
}

export function useVesselSettingsViewModel(vesselExternalId: string): VesselSettingsViewModel {
  const { useVessel, useUpdateVessel, useDeleteVessel } = useContext(VesselSettingsViewModelContext);
  const { data: vessel, isLoading, error } = useVessel(vesselExternalId);
  const { mutate: updateMutate, isPending: isUpdating } = useUpdateVessel();
  const { mutate: deleteMutate, isPending: isDeleting } = useDeleteVessel();

  const updateVessel = useCallback(
    (name: string) => {
      if (vessel) updateMutate({ space: vessel.space, externalId: vessel.externalId, name });
    },
    [vessel, updateMutate],
  );

  const deleteVessel = useCallback(() => {
    if (vessel) deleteMutate({ space: vessel.space, externalId: vessel.externalId });
  }, [vessel, deleteMutate]);

  return {
    vessel,
    isLoading,
    error,
    updateVessel,
    isUpdating,
    deleteVessel,
    isDeleting,
  };
}
