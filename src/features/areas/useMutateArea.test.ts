import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateArea, useDeleteArea, useUpdateArea, useSetGroundPlane, useSetDefaultCameraPose, UseMutateAreaContext } from './useMutateArea';
import type { CogniteClient } from '@cognite/sdk';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';

function makeMockUpsertResponse(externalId: string) {
  return {
    items: [
      {
        instanceType: 'node' as const,
        space: AUTOASSESS_SPACE,
        externalId,
        version: 1,
        lastUpdatedTime: 0,
        createdTime: 0,
      },
    ],
  };
}

describe('useMutateArea', () => {
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockContext: { useCogniteSdk: () => CogniteClient };
  let queryClient: QueryClient;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesUpsert = vi.fn();
    const mockSdk = {
      instances: { upsert: mockInstancesUpsert },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseMutateAreaContext.Provider, { value: mockContext }, children),
      );
  });

  describe('useDeleteArea', () => {
    it('should call upsert with deletedAt and succeed', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const { result } = renderHook(
        () => useDeleteArea('vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ space: AUTOASSESS_SPACE, externalId: 'area-01581' });
      });

      // Assert
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ externalId: 'area-01581' })],
        }),
      );
    });

    it('should invalidate the areas query for the vessel on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(
        () => useDeleteArea('vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ space: AUTOASSESS_SPACE, externalId: 'area-01581' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['areas', 'vessel-test'] });
    });

    it('should surface errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(
        () => useDeleteArea('vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ space: AUTOASSESS_SPACE, externalId: 'area-01581' });
      });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useUpdateArea', () => {
    const mockArea = { space: AUTOASSESS_SPACE, externalId: 'area-01581', name: 'Renamed Tank' };

    it('should call upsert with the new name', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const { result } = renderHook(() => useUpdateArea('vessel-test'), { wrapper });

      // Act
      await act(async () => { result.current.mutate(mockArea); });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({
            externalId: 'area-01581',
            sources: [expect.objectContaining({ properties: { name: 'Renamed Tank' } })],
          })],
        }),
      );
    });

    it('should invalidate the areas query for the vessel on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateArea('vessel-test'), { wrapper });

      // Act
      await act(async () => { result.current.mutate(mockArea); });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['areas', 'vessel-test'] });
    });

    it('should surface errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(() => useUpdateArea('vessel-test'), { wrapper });

      // Act
      await act(async () => { result.current.mutate(mockArea); });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useSetGroundPlane', () => {
    it('should call upsert with the ground plane normal', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const { result } = renderHook(
        () => useSetGroundPlane(AUTOASSESS_SPACE, 'area-01581', 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate([0, 0, 1]);
      });

      // Assert
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              externalId: 'area-01581',
              sources: [expect.objectContaining({ properties: { groundPlane: [0, 0, 1] } })],
            }),
          ],
        }),
      );
    });

    it('should invalidate both the single-area and the vessel areas queries on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(
        () => useSetGroundPlane(AUTOASSESS_SPACE, 'area-01581', 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate([0, 0, 1]);
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['area', AUTOASSESS_SPACE, 'area-01581'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['areas', 'vessel-test'] });
    });

    it('should surface errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(
        () => useSetGroundPlane(AUTOASSESS_SPACE, 'area-01581', 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate([0, 0, 1]);
      });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useSetDefaultCameraPose', () => {
    it('should call upsert with initialCameraPosition and initialCameraTarget', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const { result } = renderHook(
        () => useSetDefaultCameraPose(AUTOASSESS_SPACE, 'area-01581', 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ position: [1, 2, 3], target: [4, 5, 6] });
      });

      // Assert
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              externalId: 'area-01581',
              sources: [
                expect.objectContaining({
                  properties: {
                    initialCameraPosition: [1, 2, 3],
                    initialCameraTarget: [4, 5, 6],
                  },
                }),
              ],
            }),
          ],
        }),
      );
    });

    it('should invalidate both the single-area and the vessel areas queries on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(
        () => useSetDefaultCameraPose(AUTOASSESS_SPACE, 'area-01581', 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ position: [1, 2, 3], target: [4, 5, 6] });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['area', AUTOASSESS_SPACE, 'area-01581'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['areas', 'vessel-test'] });
    });

    it('should surface errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(
        () => useSetDefaultCameraPose(AUTOASSESS_SPACE, 'area-01581', 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ position: [0, 0, 0], target: [1, 0, 0] });
      });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useCreateArea', () => {
    it('should call upsert and return the new area on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue(makeMockUpsertResponse('area-uuid'));
      const { result } = renderHook(
        () => useCreateArea(AUTOASSESS_SPACE, 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ name: 'New Tank', areaType: 'BWT' });
      });

      // Assert
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(
        expect.objectContaining({ name: 'New Tank', areaType: 'BWT', vesselExternalId: 'vessel-test' }),
      );
    });

    it('should invalidate the areas query for the vessel on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue(makeMockUpsertResponse('area-uuid'));
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(
        () => useCreateArea(AUTOASSESS_SPACE, 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ name: 'New Tank', areaType: 'BWT' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['areas', 'vessel-test'] });
    });

    it('should surface errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(
        () => useCreateArea(AUTOASSESS_SPACE, 'vessel-test'),
        { wrapper },
      );

      // Act
      await act(async () => {
        result.current.mutate({ name: 'X', areaType: 'Y' });
      });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });
});
