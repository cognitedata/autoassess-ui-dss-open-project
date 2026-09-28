import { createContext, useContext } from 'react';
import { useAreas as defaultUseAreas } from './useAreas';
import { useVessel as defaultUseVessel } from '../vessels/useVessel';
import type { Area } from './AreaService';
import type { Vessel } from '../vessels/VesselService';

type UseAreasFn = (vesselExternalId: string) => {
  data: Area[] | undefined;
  isLoading: boolean;
  error: Error | null;
};

type UseVesselFn = (externalId: string) => {
  data: Vessel | undefined;
  isLoading: boolean;
  error: Error | null;
};

export type AreaListViewModelContextType = {
  useAreas: UseAreasFn;
  useVessel: UseVesselFn;
};

const defaultDeps: AreaListViewModelContextType = {
  useAreas: defaultUseAreas,
  useVessel: defaultUseVessel,
};

export const AreaListViewModelContext =
  createContext<AreaListViewModelContextType>(defaultDeps);

export interface AreaListViewModel {
  areas: Area[];
  vesselName: string;
  isLoading: boolean;
  error: Error | null;
}

export function useAreaListViewModel(vesselExternalId: string): AreaListViewModel {
  const { useAreas, useVessel } = useContext(AreaListViewModelContext);
  const { data: areas = [], isLoading, error } = useAreas(vesselExternalId);
  const { data: vessel } = useVessel(vesselExternalId);
  return {
    areas,
    vesselName: vessel?.name ?? '',
    isLoading,
    error: error ?? null,
  };
}
