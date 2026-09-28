import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CogniteClient } from '@cognite/sdk';
import { CdfAreaService } from './AreaService';
import type { AreaService } from './AreaService';
import { AREA_VIEW, AREA_CONTAINER, AUTOASSESS_SPACE, getContainerProperty } from '../../shared/cdf/dataModel';
import { createMockArea } from '../../__mocks__/areas';

function makeMockAreaNodeResponse(
  overrides: Record<string, unknown> = {},
) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'area-01581',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [AREA_VIEW.space]: {
        [`${AREA_VIEW.externalId}/${AREA_VIEW.version}`]: {
          name: 'Ballast Water Tank 01581',
          areaType: 'BWT',
          vessel: { space: 'autoassess', externalId: 'vessel-test' },
          ...overrides,
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

describe(CdfAreaService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockInstancesRetrieve: ReturnType<typeof vi.fn>;
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockClient: Pick<CogniteClient, 'instances'>;
  let service: AreaService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    mockInstancesRetrieve = vi.fn();
    mockInstancesUpsert = vi.fn();
    mockClient = {
      instances: {
        list: mockInstancesList,
        retrieve: mockInstancesRetrieve,
        upsert: mockInstancesUpsert,
      } as unknown as CogniteClient['instances'],
    };
    service = new CdfAreaService(mockClient as CogniteClient);
  });

  describe('listAreasForVessel', () => {
    it('should request area nodes filtered by vessel', async () => {
      // Arrange
      mockInstancesList.mockResolvedValue({ items: [] });

      // Act
      await service.listAreasForVessel('autoassess', 'vessel-test');

      // Assert
      expect(mockInstancesList).toHaveBeenCalledWith({
        instanceType: 'node',
        sources: [{ source: { type: 'view', ...AREA_VIEW } }],
        filter: {
          and: [
            {
              equals: {
                property: getContainerProperty(AREA_CONTAINER, 'vessel'),
                value: { space: 'autoassess', externalId: 'vessel-test' },
              },
            },
            {
              not: { exists: { property: getContainerProperty(AREA_CONTAINER, 'deletedAt') } },
            },
          ],
        },
        limit: 1000,
      });
    });

    it('should map response node items to Area[]', async () => {
      // Arrange
      mockInstancesList.mockResolvedValue({
        items: [makeMockAreaNodeResponse()],
      });

      // Act
      const areas = await service.listAreasForVessel('autoassess', 'vessel-test');

      // Assert
      expect(areas).toEqual([createMockArea()]);
    });

    it('should return empty array when no areas exist for the vessel', async () => {
      // Arrange
      mockInstancesList.mockResolvedValue({ items: [] });

      // Act
      const areas = await service.listAreasForVessel('autoassess', 'vessel-test');

      // Assert
      expect(areas).toEqual([]);
    });

    it('should propagate errors thrown by the SDK', async () => {
      // Arrange
      mockInstancesList.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(
        service.listAreasForVessel('autoassess', 'vessel-test'),
      ).rejects.toThrow('Network error');
    });
  });

  describe('getArea', () => {
    it('should retrieve the area node by space and externalId', async () => {
      // Arrange
      mockInstancesRetrieve.mockResolvedValue({ items: [makeMockAreaNodeResponse()] });

      // Act
      await service.getArea('autoassess', 'area-01581');

      // Assert
      expect(mockInstancesRetrieve).toHaveBeenCalledWith({
        items: [{ instanceType: 'node', space: 'autoassess', externalId: 'area-01581' }],
        sources: [{ source: { type: 'view', ...AREA_VIEW } }],
      });
    });

    it('should return a mapped Area on success', async () => {
      // Arrange
      mockInstancesRetrieve.mockResolvedValue({
        items: [makeMockAreaNodeResponse()],
      });

      // Act
      const area = await service.getArea('autoassess', 'area-01581');

      // Assert
      expect(area).toEqual(createMockArea());
    });

    it('should include groundPlane in the mapped area when present in CDF response', async () => {
      // Arrange
      mockInstancesRetrieve.mockResolvedValue({
        items: [makeMockAreaNodeResponse({ groundPlane: [0, 0, 1] })],
      });

      // Act
      const area = await service.getArea('autoassess', 'area-01581');

      // Assert
      expect(area.groundPlane).toEqual([0, 0, 1]);
    });

    it('should omit groundPlane when absent in CDF response', async () => {
      // Arrange
      mockInstancesRetrieve.mockResolvedValue({
        items: [makeMockAreaNodeResponse()],
      });

      // Act
      const area = await service.getArea('autoassess', 'area-01581');

      // Assert
      expect(area.groundPlane).toBeUndefined();
    });

    it('should throw when area node is not found', async () => {
      // Arrange
      mockInstancesRetrieve.mockResolvedValue({ items: [] });

      // Act & Assert
      await expect(service.getArea('autoassess', 'missing')).rejects.toThrow('Area not found');
    });
  });

  describe('deleteArea', () => {
    it('should upsert the node with a deletedAt timestamp', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      // Act
      await service.deleteArea(AUTOASSESS_SPACE, 'area-01581');

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            externalId: 'area-01581',
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
      await expect(service.deleteArea(AUTOASSESS_SPACE, 'area-01581')).rejects.toThrow('Network error');
    });
  });

  describe('updateArea', () => {
    it('should upsert the node with the new name', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      // Act
      await service.updateArea(AUTOASSESS_SPACE, 'area-01581', { name: 'Renamed Tank' });

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            externalId: 'area-01581',
            sources: [
              expect.objectContaining({
                properties: { name: 'Renamed Tank' },
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
        service.updateArea(AUTOASSESS_SPACE, 'area-01581', { name: 'X' }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('setGroundPlane', () => {
    it('should upsert the node with the ground plane normal', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      // Act
      await service.setGroundPlane(AUTOASSESS_SPACE, 'area-01581', [0, 1, 0]);

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            externalId: 'area-01581',
            sources: [
              expect.objectContaining({
                properties: { groundPlane: [0, 1, 0] },
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
        service.setGroundPlane(AUTOASSESS_SPACE, 'area-01581', [0, 0, 1]),
      ).rejects.toThrow('Network error');
    });
  });

  describe('setDefaultCameraPose', () => {
    it('should upsert the node with position and target', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      // Act
      await service.setDefaultCameraPose(
        AUTOASSESS_SPACE,
        'area-01581',
        [1, 2, 3],
        [4, 5, 6],
      );

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
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
      });
    });

    it('should propagate SDK errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(
        service.setDefaultCameraPose(AUTOASSESS_SPACE, 'area-01581', [0, 0, 0], [1, 0, 0]),
      ).rejects.toThrow('Network error');
    });
  });

  describe('mapNodeToArea (via getArea)', () => {
    it('should include initialCameraPosition and initialCameraTarget when present', async () => {
      // Arrange
      mockInstancesRetrieve.mockResolvedValue({
        items: [
          makeMockAreaNodeResponse({
            initialCameraPosition: [1, 2, 3],
            initialCameraTarget: [4, 5, 6],
          }),
        ],
      });

      // Act
      const area = await service.getArea('autoassess', 'area-01581');

      // Assert
      expect(area.initialCameraPosition).toEqual([1, 2, 3]);
      expect(area.initialCameraTarget).toEqual([4, 5, 6]);
    });

    it('should omit initialCameraPosition and initialCameraTarget when absent', async () => {
      // Arrange
      mockInstancesRetrieve.mockResolvedValue({
        items: [makeMockAreaNodeResponse()],
      });

      // Act
      const area = await service.getArea('autoassess', 'area-01581');

      // Assert
      expect(area.initialCameraPosition).toBeUndefined();
      expect(area.initialCameraTarget).toBeUndefined();
    });
  });

  describe('createArea', () => {
    it('should upsert a node with correct properties including vessel reference', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({
        items: [makeMockUpsertNodeResponse('area-uuid')],
      });

      // Act
      await service.createArea({
        name: 'New Tank',
        areaType: 'BWT',
        vesselSpace: AUTOASSESS_SPACE,
        vesselExternalId: 'vessel-test',
      });

      // Assert
      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            sources: [
              expect.objectContaining({
                properties: {
                  name: 'New Tank',
                  areaType: 'BWT',
                  vessel: { space: AUTOASSESS_SPACE, externalId: 'vessel-test' },
                },
              }),
            ],
          }),
        ],
      });
    });

    it('should return the created Area', async () => {
      // Arrange
      mockInstancesUpsert.mockResolvedValue({
        items: [makeMockUpsertNodeResponse('area-uuid')],
      });

      // Act
      const result = await service.createArea({
        name: 'New Tank',
        areaType: 'BWT',
        vesselSpace: AUTOASSESS_SPACE,
        vesselExternalId: 'vessel-test',
      });

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          name: 'New Tank',
          areaType: 'BWT',
          vesselExternalId: 'vessel-test',
          space: AUTOASSESS_SPACE,
        }),
      );
    });

    it('should propagate SDK errors', async () => {
      // Arrange
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(
        service.createArea({ name: 'X', areaType: 'Y', vesselSpace: 'autoassess', vesselExternalId: 'v' }),
      ).rejects.toThrow('Network error');
    });
  });
});
