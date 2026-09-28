import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NDT_MEASUREMENT_VIEW } from '../../shared/cdf/dataModel';

import {
  useNdtMeasurementsForCampaign,
  UseNdtMeasurementsForCampaignContext,
} from './useNdtMeasurementsForCampaign';

type ContextType = { useCogniteSdk: () => CogniteClient };

function makeMockNdtNode(externalId = 'ndt-001', thicknessMm = 12.5) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId,
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [NDT_MEASUREMENT_VIEW.space]: {
        [`${NDT_MEASUREMENT_VIEW.externalId}/${NDT_MEASUREMENT_VIEW.version}`]: {
          campaign: { space: 'autoassess', externalId: 'result-01581' },
          position3d: [1, 2, 3],
          thicknessMm,
          timestamp: '2024-09-15T09:23:00Z',
        },
      },
    },
  };
}

describe(useNdtMeasurementsForCampaign.name, () => {
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
        createElement(
          UseNdtMeasurementsForCampaignContext.Provider,
          { value: mockContext },
          children,
        ),
      );
  });

  it('should return loading state initially', () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useNdtMeasurementsForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return measurements on success', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeMockNdtNode()] });

    const { result } = renderHook(
      () => useNdtMeasurementsForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].thicknessMm).toBe(12.5);
  });

  it('should return empty array when campaign has no measurements', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useNdtMeasurementsForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('should return error state on failure', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useNdtMeasurementsForCampaign('autoassess', 'result-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should not fetch when campaignExternalId is empty', () => {
    const { result } = renderHook(
      () => useNdtMeasurementsForCampaign('autoassess', ''),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockInstancesList).not.toHaveBeenCalled();
  });
});
