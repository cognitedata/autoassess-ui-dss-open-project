import { createContext, useContext } from 'react';
import { useVessels as defaultUseVessels } from './useVessels';
import type { Vessel } from './VesselService';

type UseVesselsFn = () => {
  data: Vessel[] | undefined;
  isLoading: boolean;
  error: Error | null;
};

export type VesselListViewModelContextType = {
  useVessels: UseVesselsFn;
};

const defaultDeps: VesselListViewModelContextType = {
  useVessels: defaultUseVessels,
};

export const VesselListViewModelContext =
  createContext<VesselListViewModelContextType>(defaultDeps);

export interface VesselListViewModel {
  vessels: Vessel[];
  isLoading: boolean;
  error: Error | null;
}

export function useVesselListViewModel(): VesselListViewModel {
  const { useVessels } = useContext(VesselListViewModelContext);
  const { data: vessels = [], isLoading, error } = useVessels();
  return {
    vessels,
    isLoading,
    error: error ?? null,
  };
}
