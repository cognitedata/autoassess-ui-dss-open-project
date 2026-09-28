import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CdfInspectionPlanService } from './InspectionPlanService';
import type { InspectionPlan } from './InspectionPlanService';

export function useInspectionPlans(
  areaSpace: string,
  areaExternalId: string,
): UseQueryResult<InspectionPlan[], Error> {
  const sdk = useCogniteSdk();
  return useQuery({
    queryKey: ['inspectionPlans', areaSpace, areaExternalId],
    queryFn: () =>
      new CdfInspectionPlanService(sdk).listForArea(areaSpace, areaExternalId),
    enabled: Boolean(areaSpace && areaExternalId),
  });
}
