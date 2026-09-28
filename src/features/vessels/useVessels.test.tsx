import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as appSdk from '@cognite/app-sdk/react';
import { useVessels } from './useVessels';
import { VESSEL_VIEW } from '../../shared/cdf/dataModel';
import { createMockVessel } from '../../__mocks__/vessels';

vi.mock(import('@cognite/app-sdk/react'));

type CogniteSdkResult = ReturnType<typeof appSdk.useCogniteSdk>;

function makeMockNodeResponse() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'vessel-test',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [VESSEL_VIEW.space]: {
        [`${VESSEL_VIEW.externalId}/${VESSEL_VIEW.version}`]: {
          name: 'Test Vessel',
          vesselType: 'Bulk Carrier',
        },
      },
    },
  };
}

function makeWrapper(): ComponentType<{ children: ReactNode }> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe(useVessels.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    vi.mocked(appSdk.useCogniteSdk).mockReturnValue({
      instances: { list: mockInstancesList },
    } as unknown as CogniteSdkResult);
  });

  it('returns the list of vessels on success', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [makeMockNodeResponse()] });

    // Act
    const { result } = renderHook(() => useVessels(), { wrapper: makeWrapper() });

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([createMockVessel()]);
  });

  it('propagates SDK errors', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useVessels(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
