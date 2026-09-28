import { useCogniteSdk } from '@cognite/app-sdk/react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfCampaignMetricService } from '../viewer/CampaignMetricService';
import type { CampaignMetric } from '../viewer/CampaignMetricService';

type UseCampaignMetricsDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseCampaignMetricsDeps = { useCogniteSdk };

export const UseCampaignMetricsContext = createContext<UseCampaignMetricsDeps>(defaultDeps);

export function useCampaignMetrics(
  campaignSpace: string,
  campaignExternalId: string,
): UseQueryResult<CampaignMetric[], Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseCampaignMetricsContext);
  const sdk = useCogniteSdkDep();

  return useQuery({
    queryKey: ['campaignMetrics', campaignSpace, campaignExternalId],
    queryFn: () =>
      new CdfCampaignMetricService(sdk).listForCampaign(campaignSpace, campaignExternalId),
    enabled: Boolean(campaignSpace && campaignExternalId),
    staleTime: 5 * 60 * 1000,
  });
}
