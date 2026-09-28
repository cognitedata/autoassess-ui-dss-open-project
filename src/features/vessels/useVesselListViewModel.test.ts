import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { useVesselListViewModel, VesselListViewModelContext } from './useVesselListViewModel';
import type { VesselListViewModelContextType } from './useVesselListViewModel';
import { createMockVessel } from '../../__mocks__/vessels';

describe(useVesselListViewModel.name, () => {
  let mockContext: VesselListViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockContext = {
      useVessels: vi.fn(() => ({
        data: [createMockVessel()],
        isLoading: false,
        error: null,
      })),
    };
    wrapper = ({ children }) =>
      createElement(VesselListViewModelContext.Provider, { value: mockContext }, children);
  });

  it('should return isLoading=true while fetching', () => {
    // Arrange
    vi.mocked(mockContext.useVessels).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    // Act
    const { result } = renderHook(() => useVesselListViewModel(), { wrapper });

    // Assert
    expect(result.current.isLoading).toBe(true);
    expect(result.current.vessels).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should return vessels on success', () => {
    // Act
    const { result } = renderHook(() => useVesselListViewModel(), { wrapper });

    // Assert
    expect(result.current.vessels).toEqual([createMockVessel()]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return error when fetch fails', () => {
    // Arrange
    const error = new Error('Failed to load vessels');
    vi.mocked(mockContext.useVessels).mockReturnValue({
      data: undefined,
      isLoading: false,
      error,
    });

    // Act
    const { result } = renderHook(() => useVesselListViewModel(), { wrapper });

    // Assert
    expect(result.current.error).toBe(error);
    expect(result.current.vessels).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
