import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CdfInspectionResultService } from './InspectionResultService';
import type { InspectionResult } from './InspectionResultService';

export function useInspectionResults(
  areaSpace: string,
  areaExternalId: string,
): UseQueryResult<InspectionResult[], Error> {
  const sdk = useCogniteSdk();
  return useQuery({
    queryKey: ['inspectionResults', areaSpace, areaExternalId],
    queryFn: () =>
      new CdfInspectionResultService(sdk).listForArea(areaSpace, areaExternalId),
    enabled: Boolean(areaSpace && areaExternalId),
  });
}
