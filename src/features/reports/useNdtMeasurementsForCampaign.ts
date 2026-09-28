import { useCogniteSdk } from '@cognite/app-sdk/react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfNdtMeasurementService } from '../viewer/NdtMeasurementService';
import type { NdtMeasurement } from '../viewer/NdtMeasurementService';

type UseNdtMeasurementsForCampaignDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseNdtMeasurementsForCampaignDeps = { useCogniteSdk };

export const UseNdtMeasurementsForCampaignContext =
  createContext<UseNdtMeasurementsForCampaignDeps>(defaultDeps);

export function useNdtMeasurementsForCampaign(
  campaignSpace: string,
  campaignExternalId: string,
): UseQueryResult<NdtMeasurement[], Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseNdtMeasurementsForCampaignContext);
  const sdk = useCogniteSdkDep();

  return useQuery({
    queryKey: ['ndtMeasurements', 'campaign', campaignSpace, campaignExternalId],
    queryFn: () =>
      new CdfNdtMeasurementService(sdk).listForCampaign(campaignSpace, campaignExternalId),
    enabled: Boolean(campaignSpace && campaignExternalId),
    staleTime: 5 * 60 * 1000,
  });
}
