import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as appSdk from '@cognite/app-sdk/react';
import { useStructuralElements } from './useStructuralElements';
import { STRUCTURAL_ELEMENT_VIEW } from '../../shared/cdf/dataModel';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';

vi.mock(import('@cognite/app-sdk/react'));

type CogniteSdkResult = ReturnType<typeof appSdk.useCogniteSdk>;

function makeMockElementNodeResponse() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'element-2-11',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [STRUCTURAL_ELEMENT_VIEW.space]: {
        [`${STRUCTURAL_ELEMENT_VIEW.externalId}/${STRUCTURAL_ELEMENT_VIEW.version}`]: {
          elementType: 'longitudinal',
          label: 2011,
          centerX: 4.17074,
          centerY: 0.237193,
          centerZ: 0.844808,
          area: { space: 'autoassess', externalId: 'area-01581' },
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

describe(useStructuralElements.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    vi.mocked(appSdk.useCogniteSdk).mockReturnValue({
      instances: { list: mockInstancesList },
    } as unknown as CogniteSdkResult);
  });

  it('is disabled (pending) when areaExternalId is empty', () => {
    const { result } = renderHook(() => useStructuralElements('autoassess', ''), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(mockInstancesList).not.toHaveBeenCalled();
  });

  it('returns structural elements for an area on success', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [makeMockElementNodeResponse()] });

    // Act
    const { result } = renderHook(() => useStructuralElements('autoassess', 'area-01581'), {
      wrapper: makeWrapper(),
    });

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([createMockStructuralElement()]);
  });

  it('propagates SDK errors', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useStructuralElements('autoassess', 'area-01581'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
