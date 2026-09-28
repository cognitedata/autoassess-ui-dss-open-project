import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { CogniteClient } from '@cognite/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { CdfInspectionResultService } from '../InspectionResultService';
import type { InspectionResultService } from '../InspectionResultService';
import { CdfCampaignCadModelService } from '../reveal/CampaignCadModelService';
import type { CampaignCadModelService, FileModelStatus } from '../reveal/CampaignCadModelService';

import { CdfAreaFileService } from './AreaFileService';
import type { AreaFile, AreaFileService } from './AreaFileService';
import type { CampaignWrite } from './campaignEdit';

export type CampaignEditingDeps = {
  useCogniteSdk: () => CogniteClient;
  createAreaFileService: (sdk: CogniteClient) => AreaFileService;
  createCadModelService: (sdk: CogniteClient) => CampaignCadModelService;
  createResultService: (sdk: CogniteClient) => InspectionResultService;
};

const defaultDeps: CampaignEditingDeps = {
  useCogniteSdk,
  createAreaFileService: (sdk) => new CdfAreaFileService(sdk),
  createCadModelService: (sdk) => new CdfCampaignCadModelService(sdk),
  createResultService: (sdk) => new CdfInspectionResultService(sdk),
};

export const CampaignEditingContext = createContext<CampaignEditingDeps>(defaultDeps);

/** The area's uploaded meshes and point clouds (fetched only while *enabled*). */
export function useAreaFiles(areaExternalId: string, enabled: boolean): UseQueryResult<AreaFile[], Error> {
  const { useCogniteSdk: useSdk, createAreaFileService } = useContext(CampaignEditingContext);
  const sdk = useSdk();
  return useQuery({
    queryKey: ['area-files', areaExternalId],
    queryFn: () => createAreaFileService(sdk).listForArea(areaExternalId),
    enabled: enabled && Boolean(areaExternalId),
  });
}

/** Model state per mesh file, given the campaign each one is in now. */
export function useFileModelStatuses(
  files: { fileId: number; campaignExternalId: string | null }[],
  enabled: boolean,
): UseQueryResult<Map<number, FileModelStatus>, Error> {
  const { useCogniteSdk: useSdk, createCadModelService } = useContext(CampaignEditingContext);
  const sdk = useSdk();
  return useQuery({
    queryKey: ['file-model-statuses', ...files.map((f) => `${f.fileId}:${f.campaignExternalId ?? ''}`)],
    queryFn: () => createCadModelService(sdk).modelStatusForFiles(files),
    enabled: enabled && files.length > 0,
  });
}

/** Upsert campaign writes, then refresh the campaigns and their 3D models. */
export function useSaveCampaigns(
  areaSpace: string,
  areaExternalId: string,
): UseMutationResult<void, Error, CampaignWrite[]> {
  const { useCogniteSdk: useSdk, createResultService } = useContext(CampaignEditingContext);
  const sdk = useSdk();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (writes: CampaignWrite[]) => createResultService(sdk).saveCampaigns(writes),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inspectionResults', areaSpace, areaExternalId] }),
        queryClient.invalidateQueries({ queryKey: ['campaign-cad-models'] }),
        queryClient.invalidateQueries({ queryKey: ['file-model-statuses'] }),
      ]);
    },
  });
}
