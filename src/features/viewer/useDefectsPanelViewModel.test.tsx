import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockDefectDetection, createMockManualDefectDetection } from '../../__mocks__/defectDetections';

import type { DefectDetection, DefectStatus, DefectUpdates } from './DefectDetectionService';
import {
  useDefectsPanelViewModel,
  DefectsPanelViewModelContext,
} from './useDefectsPanelViewModel';
import type { DefectsPanelViewModelContextType } from './useDefectsPanelViewModel';

// ---- Query/mutation result helpers ----

function makeSuccess<T>(data: T): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    error: null,
    status: 'success',
    isSuccess: true,
    isError: false,
    isPending: false,
    isFetching: false,
  } as UseQueryResult<T, Error>;
}

function makePending<T>(): UseQueryResult<T, Error> {
  return {
    data: undefined,
    isLoading: true,
    error: null,
    status: 'pending',
    isSuccess: false,
    isError: false,
    isPending: true,
    isFetching: true,
  } as UseQueryResult<T, Error>;
}

function makeError<T>(message: string): UseQueryResult<T, Error> {
  return {
    data: undefined,
    isLoading: false,
    error: new Error(message),
    status: 'error',
    isSuccess: false,
    isError: true,
    isPending: false,
    isFetching: false,
  } as UseQueryResult<T, Error>;
}

function makeMutation<TData, TVariables>(
  overrides: Partial<UseMutationResult<TData, Error, TVariables>> = {},
): UseMutationResult<TData, Error, TVariables> {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    data: undefined,
    error: null,
    reset: vi.fn(),
    status: 'idle',
    variables: undefined,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    submittedAt: 0,
    ...overrides,
  } as unknown as UseMutationResult<TData, Error, TVariables>;
}

// ---- Test setup ----

describe(useDefectsPanelViewModel.name, () => {
  let mockDeps: DefectsPanelViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    mockDeps = {
      useDefectDetections: vi.fn(() => makeSuccess([])),
      useUpdateDefectStatus: vi.fn(() =>
        makeMutation<void, { space: string; externalId: string; status: DefectStatus }>(),
      ),
      useUpdateDefect: vi.fn(() =>
        makeMutation<void, { space: string; externalId: string; updates: DefectUpdates }>(),
      ),
      useCreateDefect: vi.fn(() =>
        makeMutation<DefectDetection, { position: [number, number, number]; normal?: [number, number, number]; defectClass: string; probability: number }>(),
      ),
      useDeleteDefect: vi.fn(() =>
        makeMutation<void, { space: string; externalId: string }>(),
      ),
    };

    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          DefectsPanelViewModelContext.Provider,
          { value: mockDeps },
          children,
        ),
      );
  });

  it('should return isLoading=true when defects are loading', () => {
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(makePending());

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.defects).toEqual([]);
  });

  it('should return defects sorted by probability descending by default', () => {
    const low = createMockDefectDetection({ probability: 0.3 });
    const high = createMockDefectDetection({ probability: 0.9 });
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(makeSuccess([low, high]));

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.defects[0].probability).toBe(0.9);
    expect(result.current.defects[1].probability).toBe(0.3);
  });

  it('should return error when query fails', () => {
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(
      makeError<DefectDetection[]>('Network error'),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should sort by status when sortKey is status', () => {
    const confirmed = createMockDefectDetection({ status: 'Confirmed' });
    const newDefect = createMockDefectDetection({ status: 'New' });
    const underReview = createMockDefectDetection({ status: 'UnderReview' });
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(
      makeSuccess([confirmed, underReview, newDefect]),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.setSortKey('status');
    });

    expect(result.current.defects[0].status).toBe('New');
    expect(result.current.defects[1].status).toBe('UnderReview');
    expect(result.current.defects[2].status).toBe('Confirmed');
  });

  it('should have no selected defect when selectedDefectId is null', () => {
    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581', null),
      { wrapper },
    );

    expect(result.current.selectedDefectId).toBeNull();
    expect(result.current.selectedDefect).toBeNull();
  });

  it('should reflect selectedDefectId when provided as parameter', () => {
    const defect = createMockDefectDetection({ externalId: 'defect-001' });
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(makeSuccess([defect]));

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581', 'defect-001'),
      { wrapper },
    );

    expect(result.current.selectedDefectId).toBe('defect-001');
    expect(result.current.selectedDefect).toEqual(defect);
  });

  it('should expose null selectedDefect when selectedDefectId does not match any defect', () => {
    const defect = createMockDefectDetection({ externalId: 'defect-001' });
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(makeSuccess([defect]));

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581', 'defect-999'),
      { wrapper },
    );

    expect(result.current.selectedDefect).toBeNull();
  });

  it('should clear selectedDefect when selectedDefectId changes to null', () => {
    const defect = createMockDefectDetection({ externalId: 'defect-001' });
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(makeSuccess([defect]));

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useDefectsPanelViewModel('autoassess', 'area-01581', id),
      { wrapper, initialProps: { id: 'defect-001' as string | null } },
    );

    expect(result.current.selectedDefect).toEqual(defect);

    rerender({ id: null });

    expect(result.current.selectedDefectId).toBeNull();
    expect(result.current.selectedDefect).toBeNull();
  });

  it('should call updateStatus mutation with correct arguments', () => {
    const mutateMock = vi.fn();
    vi.mocked(mockDeps.useUpdateDefectStatus).mockReturnValue(
      makeMutation({ mutate: mutateMock }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.updateStatus('autoassess', 'defect-001', 'Confirmed');
    });

    expect(mutateMock).toHaveBeenCalledWith({
      space: 'autoassess',
      externalId: 'defect-001',
      status: 'Confirmed',
    });
  });

  it('should reflect isUpdatingStatus from mutation', () => {
    vi.mocked(mockDeps.useUpdateDefectStatus).mockReturnValue(
      makeMutation({ isPending: true }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isUpdatingStatus).toBe(true);
  });

  it('should call updateDefect mutation with correct arguments', () => {
    const mutateMock = vi.fn();
    vi.mocked(mockDeps.useUpdateDefect).mockReturnValue(
      makeMutation({ mutate: mutateMock }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.updateDefect('autoassess', 'defect-001', { defectClass: 'crack', probability: 0.5 });
    });

    expect(mutateMock).toHaveBeenCalledWith({
      space: 'autoassess',
      externalId: 'defect-001',
      updates: { defectClass: 'crack', probability: 0.5 },
    });
  });

  it('should reflect isUpdatingDefect from mutation', () => {
    vi.mocked(mockDeps.useUpdateDefect).mockReturnValue(
      makeMutation({ isPending: true }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isUpdatingDefect).toBe(true);
  });

  it('should call createDefect mutation with correct arguments', () => {
    const mutateMock = vi.fn();
    vi.mocked(mockDeps.useCreateDefect).mockReturnValue(
      makeMutation({ mutate: mutateMock }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.createDefect({
        position: [1, 2, 3],
        normal: [0, 1, 0],
        defectClass: 'corrosion',
        probability: 0.8,
      });
    });

    expect(mutateMock).toHaveBeenCalledWith({
      position: [1, 2, 3],
      normal: [0, 1, 0],
      defectClass: 'corrosion',
      probability: 0.8,
    });
  });

  it('should reflect isCreatingDefect from mutation', () => {
    vi.mocked(mockDeps.useCreateDefect).mockReturnValue(
      makeMutation({ isPending: true }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isCreatingDefect).toBe(true);
  });

  it('should call deleteDefect mutation with correct arguments', () => {
    const mutateMock = vi.fn();
    vi.mocked(mockDeps.useDeleteDefect).mockReturnValue(
      makeMutation({ mutate: mutateMock }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    act(() => {
      result.current.deleteDefect('autoassess', 'defect-001');
    });

    expect(mutateMock).toHaveBeenCalledWith({ space: 'autoassess', externalId: 'defect-001' });
  });

  it('should reflect isDeletingDefect from mutation', () => {
    vi.mocked(mockDeps.useDeleteDefect).mockReturnValue(
      makeMutation({ isPending: true }),
    );

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isDeletingDefect).toBe(true);
  });

  it('should include manual defects in the list', () => {
    const manual = createMockManualDefectDetection();
    vi.mocked(mockDeps.useDefectDetections).mockReturnValue(makeSuccess([manual]));

    const { result } = renderHook(
      () => useDefectsPanelViewModel('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.defects).toHaveLength(1);
    expect(result.current.defects[0].source).toBe('manual');
  });
});
