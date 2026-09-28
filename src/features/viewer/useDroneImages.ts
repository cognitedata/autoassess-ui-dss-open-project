import { useCogniteSdk } from '@cognite/app-sdk/react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfDroneImageService } from './DroneImageService';
import type { DroneImage } from './DroneImageService';

// ---- Dependency injection ----

export type UseDroneImagesDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseDroneImagesDeps = { useCogniteSdk };

export const UseDroneImagesContext = createContext<UseDroneImagesDeps>(defaultDeps);

// ---- Query hook ----

export function useDroneImages(
  areaSpace: string,
  areaExternalId: string,
): UseQueryResult<DroneImage[], Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDroneImagesContext);
  const sdk = useCogniteSdkDep();

  return useQuery({
    queryKey: ['droneImages', areaSpace, areaExternalId],
    queryFn: () => new CdfDroneImageService(sdk).listForArea(areaSpace, areaExternalId),
    enabled: Boolean(areaSpace && areaExternalId),
    staleTime: 5 * 60 * 1000,
  });
}

// ---- Download URL hook ----

export function useDroneImageDownloadUrl(
  cdfFileId: number | null,
): UseQueryResult<string, Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDroneImagesContext);
  const sdk = useCogniteSdkDep();

  return useQuery({
    queryKey: ['droneImageUrl', cdfFileId],
    queryFn: () => new CdfDroneImageService(sdk).getDownloadUrl(cdfFileId!),
    enabled: cdfFileId !== null && cdfFileId !== 0,
    staleTime: 55 * 60 * 1000, // CDF download URLs expire after ~1 hour
  });
}
