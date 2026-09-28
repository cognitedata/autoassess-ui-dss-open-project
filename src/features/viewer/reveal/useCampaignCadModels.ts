import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { CogniteClient } from '@cognite/sdk';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfCampaignCadModelService } from './CampaignCadModelService';
import type { CampaignCadModel, CampaignCadModelService } from './CampaignCadModelService';

export type UseCampaignCadModelsDeps = {
  useCogniteSdk: () => CogniteClient;
  createService: (sdk: CogniteClient) => CampaignCadModelService;
};

const defaultDeps: UseCampaignCadModelsDeps = {
  useCogniteSdk,
  createService: (sdk) => new CdfCampaignCadModelService(sdk),
};

export const UseCampaignCadModelsContext = createContext<UseCampaignCadModelsDeps>(defaultDeps);

const POLL_WHILE_PROCESSING_MS = 15_000;

/** Poll while CDF is still processing a model, so the viewer picks it up when it is Done. */
export function pollIntervalFor(models: CampaignCadModel[] | undefined): number | false {
  const pending = models?.some((m) => m.status !== 'Done' && m.status !== 'Failed');
  return pending ? POLL_WHILE_PROCESSING_MS : false;
}

export function useCampaignCadModels(
  campaignExternalIds: string[],
): UseQueryResult<CampaignCadModel[], Error> {
  const { useCogniteSdk: useSdk, createService } = useContext(UseCampaignCadModelsContext);
  const sdk = useSdk();
  return useQuery({
    queryKey: ['campaign-cad-models', ...campaignExternalIds],
    queryFn: () => createService(sdk).listForCampaigns(campaignExternalIds),
    enabled: campaignExternalIds.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => pollIntervalFor(query.state.data),
  });
}
