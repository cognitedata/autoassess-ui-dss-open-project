import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignCadModel, CampaignCadModels, CampaignCadModelService } from './CampaignCadModelService';
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
    service = {
      listForCampaigns: vi.fn(() => Promise.resolve(result([cadModel('result-1')]))),
      modelStatusForFiles: vi.fn(() => {
        assert.fail('Not used by this hook');
      }),
    };
    deps = { useCogniteSdk: () => ({}) as CogniteClient, createService: () => service };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <UseCampaignCadModelsContext.Provider value={deps}>{children}</UseCampaignCadModelsContext.Provider>
      </QueryClientProvider>
    );
  });

  it('should not query when there are no campaigns with meshes', () => {
    const { result: hook } = renderHook(() => useCampaignCadModels([]), { wrapper });

    expect(hook.current.isPending).toBe(true);
    expect(service.listForCampaigns).not.toHaveBeenCalled();
  });

  it("should return the models of the campaigns' mesh files", async () => {
    const campaigns = [{ externalId: 'result-1', cdfFileIds: [11] }];

    const { result: hook } = renderHook(() => useCampaignCadModels(campaigns), { wrapper });

    await waitFor(() => expect(hook.current.isSuccess).toBe(true));
    expect(hook.current.data).toEqual(result([cadModel('result-1')]));
    expect(service.listForCampaigns).toHaveBeenCalledWith(campaigns);
  });

  it('should expose errors from the service', async () => {
    vi.mocked(service.listForCampaigns).mockRejectedValue(new Error('403'));

    const { result: hook } = renderHook(() => useCampaignCadModels([{ externalId: 'result-1', cdfFileIds: [11] }]), {
      wrapper,
    });

    await waitFor(() => expect(hook.current.isError).toBe(true));
    expect(hook.current.error?.message).toBe('403');
  });
});

describe(pollIntervalFor.name, () => {
  it('should poll often while any model is still queued or processing', () => {
    expect(pollIntervalFor(result([cadModel('a', 'Done'), cadModel('b', 'Processing')]))).toBe(15_000);
    expect(pollIntervalFor(result([cadModel('a', 'Queued')]))).toBe(15_000);
  });

  it('should keep polling while meshes wait for dss worker to build their model', () => {
    expect(pollIntervalFor(result([], [{ campaignExternalId: 'a', fileId: 1 }]))).toBe(30_000);
  });

  it('should stop polling once every model is done or failed and nothing is waiting', () => {
    expect(pollIntervalFor(result([cadModel('a', 'Done'), cadModel('b', 'Failed')]))).toBe(false);
    expect(pollIntervalFor(undefined)).toBe(false);
  });
});

function result(models: CampaignCadModel[], meshesWithoutModel: CampaignCadModels['meshesWithoutModel'] = []): CampaignCadModels {
  return { models, meshesWithoutModel };
}

function cadModel(campaignExternalId: string, status = 'Done'): CampaignCadModel {
  return {
    key: `${campaignExternalId}/m`,
    campaignExternalId,
    sourceFileId: 1,
    modelId: 1,
    revisionId: 2,
    status,
    collisionProxyFileId: 3,
    hasTexture: false,
    palette: {},
    legend: {},
  };
}
