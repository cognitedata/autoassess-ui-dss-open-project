import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CdfAreaService } from './AreaService';
import type { Area } from './AreaService';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';

export function useAreas(vesselExternalId: string): UseQueryResult<Area[], Error> {
  const sdk = useCogniteSdk();
  return useQuery({
    queryKey: ['areas', vesselExternalId],
    queryFn: () =>
      new CdfAreaService(sdk).listAreasForVessel(AUTOASSESS_SPACE, vesselExternalId),
    enabled: Boolean(vesselExternalId),
  });
}
