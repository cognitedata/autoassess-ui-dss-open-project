import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import {
  useVesselSettingsViewModel,
  VesselSettingsViewModelContext,
} from './useVesselSettingsViewModel';
import type { VesselSettingsViewModelContextType } from './useVesselSettingsViewModel';
import { createMockVessel } from '../../__mocks__/vessels';

describe(useVesselSettingsViewModel.name, () => {
  let mockContext: VesselSettingsViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockContext = {
      useVessel: vi.fn(() => ({ data: createMockVessel(), isLoading: false, error: null })),
      useUpdateVessel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      useDeleteVessel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    };
    wrapper = ({ children }) =>
      createElement(VesselSettingsViewModelContext.Provider, { value: mockContext }, children);
  });

  it('should return isLoading=true while fetching', () => {
    // Arrange
    vi.mocked(mockContext.useVessel).mockReturnValue({ data: undefined, isLoading: true, error: null });

    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.isLoading).toBe(true);
    expect(result.current.vessel).toBeUndefined();
  });

  it('should return the vessel on success', () => {
    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.vessel).toEqual(createMockVessel());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return error when fetch fails', () => {
    // Arrange
    const error = new Error('Failed to load vessel');
    vi.mocked(mockContext.useVessel).mockReturnValue({ data: undefined, isLoading: false, error });

    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.error).toBe(error);
  });

  it('should call updateVessel mutation with correct args', () => {
    // Arrange
    const mockMutate = vi.fn();
    vi.mocked(mockContext.useUpdateVessel).mockReturnValue({ mutate: mockMutate, isPending: false });

    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });
    result.current.updateVessel('New Name');

    // Assert
    const vessel = createMockVessel();
    expect(mockMutate).toHaveBeenCalledWith({
      space: vessel.space,
      externalId: vessel.externalId,
      name: 'New Name',
    });
  });

  it('should not call updateVessel when vessel is undefined', () => {
    // Arrange
    const mockMutate = vi.fn();
    vi.mocked(mockContext.useVessel).mockReturnValue({ data: undefined, isLoading: false, error: null });
    vi.mocked(mockContext.useUpdateVessel).mockReturnValue({ mutate: mockMutate, isPending: false });

    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });
    result.current.updateVessel('New Name');

    // Assert
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('should call deleteVessel mutation with correct args', () => {
    // Arrange
    const mockMutate = vi.fn();
    vi.mocked(mockContext.useDeleteVessel).mockReturnValue({ mutate: mockMutate, isPending: false });

    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });
    result.current.deleteVessel();

    // Assert
    const vessel = createMockVessel();
    expect(mockMutate).toHaveBeenCalledWith({ space: vessel.space, externalId: vessel.externalId });
  });

  it('should reflect isUpdating=true when update mutation is pending', () => {
    // Arrange
    vi.mocked(mockContext.useUpdateVessel).mockReturnValue({ mutate: vi.fn(), isPending: true });

    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.isUpdating).toBe(true);
  });

  it('should reflect isDeleting=true when delete mutation is pending', () => {
    // Arrange
    vi.mocked(mockContext.useDeleteVessel).mockReturnValue({ mutate: vi.fn(), isPending: true });

    // Act
    const { result } = renderHook(() => useVesselSettingsViewModel('vessel-test'), { wrapper });

    // Assert
    expect(result.current.isDeleting).toBe(true);
  });
});
