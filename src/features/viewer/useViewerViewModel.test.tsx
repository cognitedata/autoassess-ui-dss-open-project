import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ViewerViewModelContext } from './useViewerViewModel';
import type { ViewerViewModelContextType } from './useViewerViewModel';
import { useViewerViewModel } from './useViewerViewModel';
import { createMockArea } from '../../__mocks__/areas';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';
import { createMockVessel } from '../../__mocks__/vessels';

describe(useViewerViewModel.name, () => {
  let mockDeps: ViewerViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    mockDeps = {
      useArea: vi.fn(() => ({
        data: createMockArea(),
        isLoading: false,
        error: null,
        status: 'success' as const,
        isSuccess: true,
        isError: false,
        isPending: false,
        isFetching: false,
      } as ReturnType<ViewerViewModelContextType['useArea']>)),
      useVessel: vi.fn(() => ({
        data: createMockVessel(),
        isLoading: false,
        error: null,
      })),
      useStructuralElements: vi.fn(() => ({
        data: [createMockStructuralElement()],
        isLoading: false,
        error: null,
        status: 'success' as const,
        isSuccess: true,
        isError: false,
        isPending: false,
        isFetching: false,
      } as ReturnType<ViewerViewModelContextType['useStructuralElements']>)),
    };

    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <ViewerViewModelContext.Provider value={mockDeps}>
          {children}
        </ViewerViewModelContext.Provider>
      </QueryClientProvider>
    );
  });

  it('should return isLoading=true while area is loading', () => {
    vi.mocked(mockDeps.useArea).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      status: 'pending',
      isSuccess: false,
      isError: false,
      isPending: true,
      isFetching: true,
    } as ReturnType<ViewerViewModelContextType['useArea']>);

    const { result } = renderHook(() => useViewerViewModel('autoassess', 'area-01581'), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.area).toBeNull();
  });

  it('should return area and elements on success', () => {
    const { result } = renderHook(() => useViewerViewModel('autoassess', 'area-01581'), { wrapper });

    expect(result.current.area).toEqual(createMockArea());
    expect(result.current.elements).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return vesselName from useVessel', () => {
    vi.mocked(mockDeps.useVessel).mockReturnValue({
      data: createMockVessel({ name: 'MV Atlantic' }),
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useViewerViewModel('autoassess', 'area-01581'), { wrapper });

    expect(result.current.vesselName).toBe('MV Atlantic');
  });

  it('should return empty vesselName when vessel is not found', () => {
    vi.mocked(mockDeps.useVessel).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useViewerViewModel('autoassess', 'area-01581'), { wrapper });

    expect(result.current.vesselName).toBe('');
  });

  it('should call useVessel with the area vesselExternalId', () => {
    renderHook(() => useViewerViewModel('autoassess', 'area-01581'), { wrapper });
    expect(mockDeps.useVessel).toHaveBeenCalledWith('vessel-test');
  });

  it('should return error when area fetch fails', () => {
    const err = new Error('Area load failed');
    vi.mocked(mockDeps.useArea).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: err,
      status: 'error',
      isSuccess: false,
      isError: true,
      isPending: false,
      isFetching: false,
    } as ReturnType<ViewerViewModelContextType['useArea']>);

    const { result } = renderHook(() => useViewerViewModel('autoassess', 'area-01581'), { wrapper });

    expect(result.current.error).toBe(err);
  });

  it('should return elementsError (non-fatal) when elements fetch fails', () => {
    const err = new Error('Elements load failed');
    vi.mocked(mockDeps.useStructuralElements).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: err,
      status: 'error',
      isSuccess: false,
      isError: true,
      isPending: false,
      isFetching: false,
    } as ReturnType<ViewerViewModelContextType['useStructuralElements']>);

    const { result } = renderHook(() => useViewerViewModel('autoassess', 'area-01581'), { wrapper });

    expect(result.current.elementsError).toBe(err);
    expect(result.current.error).toBeNull();
  });
});
