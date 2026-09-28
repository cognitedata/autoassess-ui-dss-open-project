import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignCadModel, CampaignCadModelService } from './CampaignCadModelService';
import {
  pollIntervalFor,
  useCampaignCadModels,
  UseCampaignCadModelsContext,
} from './useCampaignCadModels';
import type { UseCampaignCadModelsDeps } from './useCampaignCadModels';

describe(useCampaignCadModels.name, () => {
  let service: CampaignCadModelService;
  let deps: UseCampaignCadModelsDeps;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    service = { listForCampaigns: vi.fn(() => Promise.resolve([cadModel('result-1')])) };
    deps = { useCogniteSdk: () => ({}) as CogniteClient, createService: () => service };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <UseCampaignCadModelsContext.Provider value={deps}>{children}</UseCampaignCadModelsContext.Provider>
      </QueryClientProvider>
    );
  });

  it('should not query when there are no campaigns', () => {
    const { result } = renderHook(() => useCampaignCadModels([]), { wrapper });

    expect(result.current.isPending).toBe(true);
    expect(service.listForCampaigns).not.toHaveBeenCalled();
  });

  it('should return the CAD models for the given campaigns', async () => {
    const { result } = renderHook(() => useCampaignCadModels(['result-1']), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([cadModel('result-1')]);
    expect(service.listForCampaigns).toHaveBeenCalledWith(['result-1']);
  });

  it('should expose errors from the service', async () => {
    vi.mocked(service.listForCampaigns).mockRejectedValue(new Error('403'));

    const { result } = renderHook(() => useCampaignCadModels(['result-1']), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('403');
  });
});

describe(pollIntervalFor.name, () => {
  it('should poll while any model is still queued or processing', () => {
    expect(pollIntervalFor([cadModel('a', 'Done'), cadModel('b', 'Processing')])).toBe(15_000);
    expect(pollIntervalFor([cadModel('a', 'Queued')])).toBe(15_000);
  });

  it('should stop polling once every model is done or failed', () => {
    expect(pollIntervalFor([cadModel('a', 'Done'), cadModel('b', 'Failed')])).toBe(false);
    expect(pollIntervalFor(undefined)).toBe(false);
  });
});

function cadModel(campaignExternalId: string, status = 'Done'): CampaignCadModel {
  return {
    campaignExternalId,
    modelId: 1,
    revisionId: 2,
    status,
    collisionProxyFileId: 3,
    hasTexture: false,
    palette: {},
  };
}
