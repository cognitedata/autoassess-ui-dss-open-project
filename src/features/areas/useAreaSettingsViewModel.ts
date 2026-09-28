import { createContext, useCallback, useContext } from 'react';
import { useAreas as defaultUseAreas } from './useAreas';
import { useUpdateArea as defaultUseUpdateArea, useDeleteArea as defaultUseDeleteArea } from './useMutateArea';
import type { Area } from './AreaService';

type UseAreasFn = (vesselExternalId: string) => {
  data: Area[] | undefined;
  isLoading: boolean;
  error: Error | null;
};

type UseUpdateAreaFn = (vesselExternalId: string) => {
  mutate: (input: Pick<Area, 'space' | 'externalId'> & { name: string }) => void;
  isPending: boolean;
};

type UseDeleteAreaFn = (vesselExternalId: string) => {
  mutate: (area: Pick<Area, 'space' | 'externalId'>) => void;
  isPending: boolean;
};

export type AreaSettingsViewModelContextType = {
  useAreas: UseAreasFn;
  useUpdateArea: UseUpdateAreaFn;
  useDeleteArea: UseDeleteAreaFn;
};

const defaultDeps: AreaSettingsViewModelContextType = {
  useAreas: defaultUseAreas,
  useUpdateArea: defaultUseUpdateArea,
  useDeleteArea: defaultUseDeleteArea,
};

export const AreaSettingsViewModelContext =
  createContext<AreaSettingsViewModelContextType>(defaultDeps);

export interface AreaSettingsViewModel {
  area: Area | undefined;
  isLoading: boolean;
  error: Error | null;
  updateArea: (name: string) => void;
  isUpdating: boolean;
  deleteArea: () => void;
  isDeleting: boolean;
}

export function useAreaSettingsViewModel(
  vesselExternalId: string,
  areaExternalId: string,
): AreaSettingsViewModel {
  const { useAreas, useUpdateArea, useDeleteArea } = useContext(AreaSettingsViewModelContext);
  const { data: areas = [], isLoading, error } = useAreas(vesselExternalId);
  const area = areas.find((a) => a.externalId === areaExternalId);
  const { mutate: updateMutate, isPending: isUpdating } = useUpdateArea(vesselExternalId);
  const { mutate: deleteMutate, isPending: isDeleting } = useDeleteArea(vesselExternalId);

  const updateArea = useCallback(
    (name: string) => {
      if (area) updateMutate({ space: area.space, externalId: area.externalId, name });
    },
    [area, updateMutate],
  );

  const deleteArea = useCallback(() => {
    if (area) deleteMutate({ space: area.space, externalId: area.externalId });
  }, [area, deleteMutate]);

  return {
    area,
    isLoading,
    error,
    updateArea,
    isUpdating,
    deleteArea,
    isDeleting,
  };
}
