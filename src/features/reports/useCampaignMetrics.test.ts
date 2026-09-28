import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CAMPAIGN_METRIC_VIEW } from '../../shared/cdf/dataModel';

import { useCampaignMetrics, UseCampaignMetricsContext } from './useCampaignMetrics';

type ContextType = { useCogniteSdk: () => CogniteClient };

function makeMockMetricNode(externalId = 'result-test-metric-coverage', value = 91.3) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId,
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [CAMPAIGN_METRIC_VIEW.space]: {
        [`${CAMPAIGN_METRIC_VIEW.externalId}/${CAMPAIGN_METRIC_VIEW.version}`]: {
          campaign: { space: 'autoassess', externalId: 'result-test' },
          name: 'Coverage',
          value,
          unit: 'percentage',
        },
      },
    },
  };
}

describe(useCampaignMetrics.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockSdk = {
      instances: { list: mockInstancesList },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseCampaignMetricsContext.Provider, { value: mockContext }, children),
      );
  });

  it('should return loading state initially', () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useCampaignMetrics('autoassess', 'result-test'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return metrics on success', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeMockMetricNode()] });

    const { result } = renderHook(
      () => useCampaignMetrics('autoassess', 'result-test'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].value).toBe(91.3);
  });

  it('should return empty array when campaign has no metrics', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useCampaignMetrics('autoassess', 'result-test'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('should return error state on failure', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useCampaignMetrics('autoassess', 'result-test'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should not fetch when campaignExternalId is empty', () => {
    const { result } = renderHook(
      () => useCampaignMetrics('autoassess', ''),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockInstancesList).not.toHaveBeenCalled();
  });
});
