import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CogniteClient } from '@cognite/sdk';
import { CdfVesselService } from './VesselService';
import type { VesselService } from './VesselService';
import { VESSEL_VIEW, VESSEL_CONTAINER, AUTOASSESS_SPACE, getContainerProperty } from '../../shared/cdf/dataModel';
import { createMockVessel } from '../../__mocks__/vessels';

// Arrange: a minimal node response as returned by instances.list
function makeMockNodeResponse() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'vessel-test',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [VESSEL_VIEW.space]: {
        [`${VESSEL_VIEW.externalId}/${VESSEL_VIEW.version}`]: {
          name: 'Test Vessel',
          vesselType: 'Bulk Carrier',
        },
      },
    },
  };
}

function makeMockUpsertNodeResponse(externalId: string) {
  return {
    instanceType: 'node' as const,
    space: AUTOASSESS_SPACE,
    externalId,
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
  };
}

describe(CdfVesselService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockClient: Pick<CogniteClient, 'instances'>;
  let service: VesselService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    mockInstancesUpsert = vi.fn();
    mockClient = {
      instances: {
        list: mockInstancesList,
        upsert: mockInstancesUpsert,
      } as unknown as CogniteClient['instances'],
    };
    service = new CdfVesselService(mockClient as CogniteClient);
  });

  it('should request nodes from VesselView with correct parameters', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [] });

    // Act
    await service.listVessels();

    // Assert
    expect(mockInstancesList).toHaveBeenCalledWith({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...VESSEL_VIEW } }],
      filter: {
        not: { exists: { property: getContainerProperty(VESSEL_CONTAINER, 'deletedAt') } },
      },
      limit: 1000,
    });
  });

  it('should map response node items to Vessel[]', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [makeMockNodeResponse()] });

    // Act
    const vessels = await service.listVessels();

    // Assert
    expect(vessels).toEqual([createMockVessel()]);
  });

  it('should return empty array when no nodes exist', async () => {
    // Arrange
    mockInstancesList.mockResolvedValue({ items: [] });

    // Act
    const vessels = await service.listVessels();

    // Assert
    expect(vessels).toEqual([]);
  });

  it('should propagate errors thrown by the SDK', async () => {
    // Arrange
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    // Act & Assert
    await expect(service.listVessels()).rejects.toThrow('Network error');
  });

  describe('deleteVessel', () => {
    it('should upsert the node with a deletedAt timestamp', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      // Act
      await service.deleteVessel(AUTOASSESS_SPACE, 'vessel-test');

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            externalId: 'vessel-test',
            sources: [
              expect.objectContaining({
                properties: expect.objectContaining({ deletedAt: expect.any(String) }),
              }),
            ],
          }),
        ],
      });
    });

    it('should propagate SDK errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(service.deleteVessel(AUTOASSESS_SPACE, 'vessel-test')).rejects.toThrow('Network error');
    });
  });

  describe('updateVessel', () => {
    it('should upsert the node with the new name', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      // Act
      await service.updateVessel(AUTOASSESS_SPACE, 'vessel-test', { name: 'Renamed Vessel' });

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            externalId: 'vessel-test',
            sources: [
              expect.objectContaining({
                properties: { name: 'Renamed Vessel' },
              }),
            ],
          }),
        ],
      });
    });

    it('should propagate SDK errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(
        service.updateVessel(AUTOASSESS_SPACE, 'vessel-test', { name: 'X' }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('createVessel', () => {
    it('should upsert a node with the correct properties', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({
        items: [makeMockUpsertNodeResponse('vessel-uuid')],
      });

      // Act
      await service.createVessel({ name: 'New Vessel', vesselType: 'Tanker' });

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            sources: [
              expect.objectContaining({
                properties: { name: 'New Vessel', vesselType: 'Tanker' },
              }),
            ],
          }),
        ],
      });
    });

    it('should return the created Vessel', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({
        items: [makeMockUpsertNodeResponse('vessel-uuid')],
      });

      // Act
      const result = await service.createVessel({ name: 'New Vessel', vesselType: 'Tanker' });

      // Assert
      expect(result).toEqual(
        expect.objectContaining({ name: 'New Vessel', vesselType: 'Tanker', space: AUTOASSESS_SPACE }),
      );
    });

    it('should throw when the upsert returns no node', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      // Act & Assert
      await expect(service.createVessel({ name: 'X', vesselType: 'Y' })).rejects.toThrow(
        'Vessel creation returned no node',
      );
    });

    it('should propagate SDK errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(service.createVessel({ name: 'X', vesselType: 'Y' })).rejects.toThrow(
        'Network error',
      );
    });
  });
});
