import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as appSdk from '@cognite/app-sdk/react';
import { useInspectionPlans } from './useInspectionPlans';
import { INSPECTION_PLAN_VIEW } from '../../shared/cdf/dataModel';
import { createMockInspectionPlan } from '../../__mocks__/inspectionPlans';

vi.mock(import('@cognite/app-sdk/react'));

type CogniteSdkResult = ReturnType<typeof appSdk.useCogniteSdk>;

function makeMockPlanNodeResponse() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'plan-area-01581-001',
    version: 1,
    lastUpdatedTime: 1700000000000,
    createdTime: 1700000000000,
    properties: {
      [INSPECTION_PLAN_VIEW.space]: {
        [`${INSPECTION_PLAN_VIEW.externalId}/${INSPECTION_PLAN_VIEW.version}`]: {
          area: { space: 'autoassess', externalId: 'area-01581' },
          map: { space: 'autoassess', externalId: 'result-legacy-area-01581' },
          status: 'Draft',
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

describe(useInspectionPlans.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    vi.mocked(appSdk.useCogniteSdk).mockReturnValue({
      instances: { list: mockInstancesList },
    } as unknown as CogniteSdkResult);
  });

  it('is disabled (pending) when areaExternalId is empty', () => {
    const { result } = renderHook(() => useInspectionPlans('autoassess', ''), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(mockInstancesList).not.toHaveBeenCalled();
  });

  it('returns inspection plans for an area on success', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

    // Act
    const { result } = renderHook(() => useInspectionPlans('autoassess', 'area-01581'), {
      wrapper: makeWrapper(),
    });

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([createMockInspectionPlan()]);
  });

  it('propagates SDK errors', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useInspectionPlans('autoassess', 'area-01581'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
