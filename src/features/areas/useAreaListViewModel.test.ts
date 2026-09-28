import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { useAreaListViewModel, AreaListViewModelContext } from './useAreaListViewModel';
import type { AreaListViewModelContextType } from './useAreaListViewModel';
import { createMockArea } from '../../__mocks__/areas';
import { createMockVessel } from '../../__mocks__/vessels';

describe(useAreaListViewModel.name, () => {
  let mockContext: AreaListViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockContext = {
      useAreas: vi.fn(() => ({
        data: [createMockArea()],
        isLoading: false,
        error: null,
      })),
      useVessel: vi.fn(() => ({
        data: createMockVessel(),
        isLoading: false,
        error: null,
      })),
    };
    wrapper = ({ children }) =>
      createElement(AreaListViewModelContext.Provider, { value: mockContext }, children);
  });

  it('should return isLoading=true while fetching', () => {
    // Arrange
    vi.mocked(mockContext.useAreas).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    // Act
    const { result } = renderHook(() => useAreaListViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.isLoading).toBe(true);
    expect(result.current.areas).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should return areas on success', () => {
    // Act
    const { result } = renderHook(() => useAreaListViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.areas).toEqual([createMockArea()]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return error when fetch fails', () => {
    // Arrange
    const error = new Error('Failed to load areas');
    vi.mocked(mockContext.useAreas).mockReturnValue({
      data: undefined,
      isLoading: false,
      error,
    });

    // Act
    const { result } = renderHook(() => useAreaListViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.error).toBe(error);
    expect(result.current.areas).toEqual([]);
  });

  it('should forward vesselExternalId to the useAreas hook', () => {
    // Act
    renderHook(() => useAreaListViewModel('vessel-abc'), { wrapper });

    // Assert
    expect(mockContext.useAreas).toHaveBeenCalledWith('vessel-abc');
  });

  it('should return the vessel name from useVessel', () => {
    // Arrange
    vi.mocked(mockContext.useVessel).mockReturnValue({
      data: createMockVessel({ name: 'MV Atlantic' }),
      isLoading: false,
      error: null,
    });

    // Act
    const { result } = renderHook(() => useAreaListViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.vesselName).toBe('MV Atlantic');
  });

  it('should return empty vesselName when vessel is not found', () => {
    // Arrange
    vi.mocked(mockContext.useVessel).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    // Act
    const { result } = renderHook(() => useAreaListViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.vesselName).toBe('');
  });

  it('should forward vesselExternalId to useVessel', () => {
    // Act
    renderHook(() => useAreaListViewModel('vessel-abc'), { wrapper });

    // Assert
    expect(mockContext.useVessel).toHaveBeenCalledWith('vessel-abc');
  });
});
