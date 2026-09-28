import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateVessel, useDeleteVessel, useUpdateVessel, UseMutateVesselContext } from './useMutateVessel';
import type { Area } from '../areas/AreaService';
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

describe('useMutateVessel', () => {
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
        createElement(UseMutateVesselContext.Provider, { value: mockContext }, children),
      );
  });

  describe('useDeleteVessel', () => {
    const mockVessel = { space: AUTOASSESS_SPACE, externalId: 'vessel-test' };
    const mockAreas: Area[] = [
      { space: AUTOASSESS_SPACE, externalId: 'area-1', name: 'Tank 1', areaType: 'BWT', vesselExternalId: 'vessel-test' },
      { space: AUTOASSESS_SPACE, externalId: 'area-2', name: 'Tank 2', areaType: 'BWT', vesselExternalId: 'vessel-test' },
    ];

    it('should cascade-delete all areas then the vessel', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const mockListAreas = vi.fn<() => Promise<Area[]>>().mockResolvedValue(mockAreas);
      const { result } = renderHook(
        () => useDeleteVessel({ listAreasForVessel: mockListAreas }),
        { wrapper },
      );

      // Act
      await act(async () => { result.current.mutate(mockVessel); });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert: list was called with vessel coords
      expect(mockListAreas).toHaveBeenCalledWith(AUTOASSESS_SPACE, 'vessel-test');
      // Assert: upsert called 3 times (2 areas + 1 vessel)
      expect(mockInstancesUpsert).toHaveBeenCalledTimes(3);
    });

    it('should invalidate vessels and areas queries on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const mockListAreas = vi.fn<() => Promise<Area[]>>().mockResolvedValue([]);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(
        () => useDeleteVessel({ listAreasForVessel: mockListAreas }),
        { wrapper },
      );

      // Act
      await act(async () => { result.current.mutate(mockVessel); });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vessels'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['areas', 'vessel-test'] });
    });

    it('should surface errors from the area list step', async () => {
      // Arrange
      const mockListAreas = vi.fn<() => Promise<Area[]>>().mockRejectedValue(new Error('List failed'));
      const { result } = renderHook(
        () => useDeleteVessel({ listAreasForVessel: mockListAreas }),
        { wrapper },
      );

      // Act
      await act(async () => { result.current.mutate(mockVessel); });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('List failed');
    });
  });

  describe('useUpdateVessel', () => {
    const mockVessel = { space: AUTOASSESS_SPACE, externalId: 'vessel-test', name: 'Renamed Vessel' };

    it('should call upsert with the new name', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const { result } = renderHook(() => useUpdateVessel(), { wrapper });

      // Act
      await act(async () => { result.current.mutate(mockVessel); });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({
            externalId: 'vessel-test',
            sources: [expect.objectContaining({ properties: { name: 'Renamed Vessel' } })],
          })],
        }),
      );
    });

    it('should invalidate the vessels query on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateVessel(), { wrapper });

      // Act
      await act(async () => { result.current.mutate(mockVessel); });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vessels'] });
    });

    it('should surface errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(() => useUpdateVessel(), { wrapper });

      // Act
      await act(async () => { result.current.mutate(mockVessel); });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useCreateVessel', () => {
    it('should call upsert and return the new vessel on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue(makeMockUpsertResponse('vessel-uuid'));
      const { result } = renderHook(() => useCreateVessel(), { wrapper });

      // Act
      await act(async () => {
        result.current.mutate({ name: 'New Vessel', vesselType: 'Tanker' });
      });

      // Assert
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(
        expect.objectContaining({ name: 'New Vessel', vesselType: 'Tanker' }),
      );
    });

    it('should invalidate the vessels query on success', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue(makeMockUpsertResponse('vessel-uuid'));
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCreateVessel(), { wrapper });

      // Act
      await act(async () => {
        result.current.mutate({ name: 'New Vessel', vesselType: 'Tanker' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Assert
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vessels'] });
    });

    it('should surface errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));
      const { result } = renderHook(() => useCreateVessel(), { wrapper });

      // Act
      await act(async () => {
        result.current.mutate({ name: 'X', vesselType: 'Y' });
      });

      // Assert
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });
});
