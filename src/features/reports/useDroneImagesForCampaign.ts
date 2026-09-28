import { useCogniteSdk } from '@cognite/app-sdk/react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfDroneImageService } from '../viewer/DroneImageService';
import type { DroneImage } from '../viewer/DroneImageService';

type UseDroneImagesForCampaignDeps = {
  useCogniteSdk: () => ReturnType<typeof useCogniteSdk>;
};

const defaultDeps: UseDroneImagesForCampaignDeps = { useCogniteSdk };

export const UseDroneImagesForCampaignContext =
  createContext<UseDroneImagesForCampaignDeps>(defaultDeps);

export function useDroneImagesForCampaign(
  campaignSpace: string,
  campaignExternalId: string,
): UseQueryResult<DroneImage[], Error> {
  const { useCogniteSdk: useCogniteSdkDep } = useContext(UseDroneImagesForCampaignContext);
  const sdk = useCogniteSdkDep();

  return useQuery({
    queryKey: ['droneImages', 'campaign', campaignSpace, campaignExternalId],
    queryFn: () => new CdfDroneImageService(sdk).listForCampaign(campaignExternalId),
    enabled: Boolean(campaignSpace && campaignExternalId),
    staleTime: 5 * 60 * 1000,
  });
}
