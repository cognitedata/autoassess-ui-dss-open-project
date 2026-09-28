import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { CogniteClient } from '@cognite/sdk';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfCampaignCadModelService } from './CampaignCadModelService';
import type { CampaignCadModels, CampaignCadModelService, CampaignMeshes } from './CampaignCadModelService';

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
const POLL_WHILE_WAITING_FOR_WORKER_MS = 30_000;

/**
 * Poll while CDF is still processing a model, or while meshes wait for `dss worker` to build
 * theirs, so the viewer picks the model up when it is Done without a reload.
 */
export function pollIntervalFor(data: CampaignCadModels | undefined): number | false {
  if (data?.models.some((m) => m.status !== 'Done' && m.status !== 'Failed')) return POLL_WHILE_PROCESSING_MS;
  if (data && data.meshesWithoutModel.length > 0) return POLL_WHILE_WAITING_FOR_WORKER_MS;
  return false;
}

export function useCampaignCadModels(campaigns: CampaignMeshes[]): UseQueryResult<CampaignCadModels, Error> {
  const { useCogniteSdk: useSdk, createService } = useContext(UseCampaignCadModelsContext);
  const sdk = useSdk();
  return useQuery({
    queryKey: ['campaign-cad-models', ...campaigns.map((c) => `${c.externalId}:${c.cdfFileIds.join(',')}`)],
    queryFn: () => createService(sdk).listForCampaigns(campaigns),
    enabled: campaigns.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => pollIntervalFor(query.state.data),
  });
}
