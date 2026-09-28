import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CdfStructuralElementService } from './StructuralElementService';
import type { StructuralElement } from './StructuralElementService';

export function useStructuralElements(
  areaSpace: string,
  areaExternalId: string,
): UseQueryResult<StructuralElement[], Error> {
  const sdk = useCogniteSdk();
  return useQuery({
    queryKey: ['structuralElements', areaSpace, areaExternalId],
    queryFn: () =>
      new CdfStructuralElementService(sdk).listForArea(areaSpace, areaExternalId),
    enabled: Boolean(areaSpace && areaExternalId),
  });
}
