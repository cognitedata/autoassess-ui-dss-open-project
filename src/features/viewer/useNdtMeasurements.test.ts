import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  NDT_MEASUREMENT_VIEW,
  INSPECTION_RESULT_VIEW,
} from '../../shared/cdf/dataModel';

import { useNdtMeasurements, UseNdtMeasurementsContext } from './useNdtMeasurements';

type ContextType = { useCogniteSdk: () => CogniteClient };

function makeMockResultNode() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'result-01581',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [INSPECTION_RESULT_VIEW.space]: {
        [`${INSPECTION_RESULT_VIEW.externalId}/${INSPECTION_RESULT_VIEW.version}`]: {
          area: { space: 'autoassess', externalId: 'area-01581' },
          campaignDate: '2024-09-15',
          status: 'Complete',
          cdfFileIds: [],
        },
      },
    },
  };
}

function makeMockNdtNode() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'ndt-001',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [NDT_MEASUREMENT_VIEW.space]: {
        [`${NDT_MEASUREMENT_VIEW.externalId}/${NDT_MEASUREMENT_VIEW.version}`]: {
          campaign: { space: 'autoassess', externalId: 'result-01581' },
          position3d: [7.90, 1.12, 1.31],
          thicknessMm: 12.5,
          timestamp: '2024-09-15T09:23:00Z',
        },
      },
    },
  };
}

describe(useNdtMeasurements.name, () => {
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
        createElement(UseNdtMeasurementsContext.Provider, { value: mockContext }, children),
      );
  });

  it('should return loading state initially', () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useNdtMeasurements('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return measurements on success', async () => {
    mockInstancesList
      .mockResolvedValueOnce({ items: [makeMockResultNode()] })
      .mockResolvedValueOnce({ items: [makeMockNdtNode()] });

    const { result } = renderHook(
      () => useNdtMeasurements('autoassess', 'area-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].externalId).toBe('ndt-001');
    expect(result.current.data![0].thicknessMm).toBe(12.5);
  });

  it('should return empty array when area has no campaigns', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useNdtMeasurements('autoassess', 'area-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('should return error state on failure', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useNdtMeasurements('autoassess', 'area-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should not fetch when areaExternalId is empty', () => {
    const { result } = renderHook(
      () => useNdtMeasurements('autoassess', ''),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockInstancesList).not.toHaveBeenCalled();
  });
});
