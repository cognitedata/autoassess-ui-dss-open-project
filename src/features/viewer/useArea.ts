import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CdfAreaService } from '../areas/AreaService';
import type { Area } from '../areas/AreaService';

export function useArea(space: string, externalId: string): UseQueryResult<Area, Error> {
  const sdk = useCogniteSdk();
  return useQuery({
    queryKey: ['area', space, externalId],
    queryFn: () => new CdfAreaService(sdk).getArea(space, externalId),
    enabled: Boolean(space && externalId),
  });
}
