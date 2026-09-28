import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as appSdk from '@cognite/app-sdk/react';
import { useInspectionResults } from './useInspectionResults';
import { INSPECTION_RESULT_VIEW } from '../../shared/cdf/dataModel';
import { createMockInspectionResult } from '../../__mocks__/inspectionResults';

vi.mock(import('@cognite/app-sdk/react'));

type CogniteSdkResult = ReturnType<typeof appSdk.useCogniteSdk>;

function makeMockResultNodeResponse() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'result-legacy-area-01581',
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

function makeWrapper(): ComponentType<{ children: ReactNode }> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe(useInspectionResults.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    vi.mocked(appSdk.useCogniteSdk).mockReturnValue({
      instances: { list: mockInstancesList },
    } as unknown as CogniteSdkResult);
  });

  it('is disabled (pending) when areaExternalId is empty', () => {
    const { result } = renderHook(() => useInspectionResults('autoassess', ''), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(mockInstancesList).not.toHaveBeenCalled();
  });

  it('returns inspection results for an area on success', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [makeMockResultNodeResponse()] });

    // Act
    const { result } = renderHook(() => useInspectionResults('autoassess', 'area-01581'), {
      wrapper: makeWrapper(),
    });

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([createMockInspectionResult()]);
  });

  it('propagates SDK errors', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useInspectionResults('autoassess', 'area-01581'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
