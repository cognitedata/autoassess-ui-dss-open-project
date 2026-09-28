import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CdfVesselService } from './VesselService';
import type { Vessel } from './VesselService';

export function useVessels(): UseQueryResult<Vessel[], Error> {
  const sdk = useCogniteSdk();
  return useQuery({
    queryKey: ['vessels'],
    queryFn: () => new CdfVesselService(sdk).listVessels(),
  });
}
