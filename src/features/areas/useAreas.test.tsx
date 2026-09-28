import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as appSdk from '@cognite/app-sdk/react';
import { useAreas } from './useAreas';
import { AREA_VIEW } from '../../shared/cdf/dataModel';
import { createMockArea } from '../../__mocks__/areas';

vi.mock(import('@cognite/app-sdk/react'));

type CogniteSdkResult = ReturnType<typeof appSdk.useCogniteSdk>;

function makeMockAreaNodeResponse() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'area-01581',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [AREA_VIEW.space]: {
        [`${AREA_VIEW.externalId}/${AREA_VIEW.version}`]: {
          name: 'Ballast Water Tank 01581',
          areaType: 'BWT',
          vessel: { space: 'autoassess', externalId: 'vessel-test' },
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

describe(useAreas.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    vi.mocked(appSdk.useCogniteSdk).mockReturnValue({
      instances: { list: mockInstancesList },
    } as unknown as CogniteSdkResult);
  });

  it('is disabled (pending) when vesselExternalId is empty', () => {
    const { result } = renderHook(() => useAreas(''), { wrapper: makeWrapper() });
    expect(result.current.isPending).toBe(true);
    expect(mockInstancesList).not.toHaveBeenCalled();
  });

  it('returns the list of areas for a vessel on success', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [makeMockAreaNodeResponse()] });

    // Act
    const { result } = renderHook(() => useAreas('vessel-test'), { wrapper: makeWrapper() });

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([createMockArea()]);
  });

  it('propagates SDK errors', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAreas('vessel-test'), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
