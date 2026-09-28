import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import {
  useAreaSettingsViewModel,
  AreaSettingsViewModelContext,
} from './useAreaSettingsViewModel';
import type { AreaSettingsViewModelContextType } from './useAreaSettingsViewModel';
import { createMockArea } from '../../__mocks__/areas';

describe(useAreaSettingsViewModel.name, () => {
  let mockContext: AreaSettingsViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockContext = {
      useAreas: vi.fn(() => ({ data: [createMockArea()], isLoading: false, error: null })),
      useUpdateArea: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      useDeleteArea: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    };
    wrapper = ({ children }) =>
      createElement(AreaSettingsViewModelContext.Provider, { value: mockContext }, children);
  });

  it('should return isLoading=true while fetching', () => {
    // Arrange
    vi.mocked(mockContext.useAreas).mockReturnValue({ data: undefined, isLoading: true, error: null });

    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );

    // Assert
    expect(result.current.isLoading).toBe(true);
    expect(result.current.area).toBeUndefined();
  });

  it('should return the matching area on success', () => {
    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );

    // Assert
    expect(result.current.area).toEqual(createMockArea());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return error when fetch fails', () => {
    // Arrange
    const error = new Error('Failed to load areas');
    vi.mocked(mockContext.useAreas).mockReturnValue({ data: undefined, isLoading: false, error });

    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );

    // Assert
    expect(result.current.error).toBe(error);
  });

  it('should call updateArea mutation with correct args', () => {
    // Arrange
    const mockMutate = vi.fn();
    vi.mocked(mockContext.useUpdateArea).mockReturnValue({ mutate: mockMutate, isPending: false });

    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );
    result.current.updateArea('New Name');

    // Assert
    const area = createMockArea();
    expect(mockMutate).toHaveBeenCalledWith({
      space: area.space,
      externalId: area.externalId,
      name: 'New Name',
    });
  });

  it('should not call updateArea when area is undefined', () => {
    // Arrange
    const mockMutate = vi.fn();
    vi.mocked(mockContext.useAreas).mockReturnValue({ data: [], isLoading: false, error: null });
    vi.mocked(mockContext.useUpdateArea).mockReturnValue({ mutate: mockMutate, isPending: false });

    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );
    result.current.updateArea('New Name');

    // Assert
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('should call deleteArea mutation with correct args', () => {
    // Arrange
    const mockMutate = vi.fn();
    vi.mocked(mockContext.useDeleteArea).mockReturnValue({ mutate: mockMutate, isPending: false });

    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );
    result.current.deleteArea();

    // Assert
    const area = createMockArea();
    expect(mockMutate).toHaveBeenCalledWith({ space: area.space, externalId: area.externalId });
  });

  it('should reflect isUpdating=true when update mutation is pending', () => {
    // Arrange
    vi.mocked(mockContext.useUpdateArea).mockReturnValue({ mutate: vi.fn(), isPending: true });

    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );

    // Assert
    expect(result.current.isUpdating).toBe(true);
  });

  it('should reflect isDeleting=true when delete mutation is pending', () => {
    // Arrange
    vi.mocked(mockContext.useDeleteArea).mockReturnValue({ mutate: vi.fn(), isPending: true });

    // Act
    const { result } = renderHook(
      () => useAreaSettingsViewModel('vessel-test', 'area-01581'),
      { wrapper },
    );

    // Assert
    expect(result.current.isDeleting).toBe(true);
  });
});
