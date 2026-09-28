import { createContext, useContext } from 'react';
import { useArea as defaultUseArea } from './useArea';
import { useStructuralElements as defaultUseStructuralElements } from './useStructuralElements';
import { useVessel as defaultUseVessel } from '../vessels/useVessel';
import type { Area } from '../areas/AreaService';
import type { Vessel } from '../vessels/VesselService';
import type { StructuralElement } from './StructuralElementService';
import type { UseQueryResult } from '@tanstack/react-query';

type UseAreaFn = (space: string, externalId: string) => UseQueryResult<Area, Error>;
type UseStructuralElementsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<StructuralElement[], Error>;
type UseVesselFn = (externalId: string) => {
  data: Vessel | undefined;
  isLoading: boolean;
  error: Error | null;
};

export type ViewerViewModelContextType = {
  useArea: UseAreaFn;
  useVessel: UseVesselFn;
  useStructuralElements: UseStructuralElementsFn;
};

const defaultDeps: ViewerViewModelContextType = {
  useArea: defaultUseArea,
  useVessel: defaultUseVessel,
  useStructuralElements: defaultUseStructuralElements,
};

export const ViewerViewModelContext =
  createContext<ViewerViewModelContextType>(defaultDeps);

export interface ViewerViewModel {
  area: Area | null;
  vesselName: string;
  elements: StructuralElement[];
  isLoading: boolean;
  /** Fatal error — area could not be loaded. */
  error: Error | null;
  /** Non-fatal: semantic overlay failed to load but the 3D viewer can still render. */
  elementsError: Error | null;
}

export function useViewerViewModel(space: string, externalId: string): ViewerViewModel {
  const { useArea, useVessel, useStructuralElements } = useContext(ViewerViewModelContext);

  const areaResult = useArea(space, externalId);
  const vesselResult = useVessel(areaResult.data?.vesselExternalId ?? '');
  const elementsResult = useStructuralElements(space, externalId);

  return {
    area: areaResult.data ?? null,
    vesselName: vesselResult.data?.name ?? '',
    elements: elementsResult.data ?? [],
    isLoading: areaResult.isLoading || elementsResult.isLoading,
    error: areaResult.error ?? null,
    elementsError: elementsResult.error ?? null,
  };
}
