import type { CogniteClient } from '@cognite/sdk';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  DRONE_IMAGE_VIEW,
  DRONE_IMAGE_CONTAINER,
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';

import { CdfDroneImageService } from './DroneImageService';
import type { DroneImageService } from './DroneImageService';

function makeMockResultNode(externalId = 'result-ship-ch-sim') {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId,
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {},
  };
}

function makeMockDroneImageNode(overrides: Record<string, unknown> = {}) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'drone-image-result-ship-ch-sim-frame-1',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [DRONE_IMAGE_VIEW.space]: {
        [`${DRONE_IMAGE_VIEW.externalId}/${DRONE_IMAGE_VIEW.version}`]: {
          campaignExternalId: 'result-ship-ch-sim',
          frameId: 1,
          timestamp: 1762179077.257,
          positionX: 0.038,
          positionY: -0.098,
          positionZ: 4.398,
          orientQx: 0.001,
          orientQy: 0.0003,
          orientQz: -0.683,
          orientQw: 0.730,
          cdfFileId: 1001,
          bboxMinX: -2.0,
          bboxMinY: -13.0,
          bboxMinZ: 6.0,
          bboxMaxX: 10.0,
          bboxMaxY: 0.0,
          bboxMaxZ: 9.0,
          ...overrides,
        },
      },
    },
  };
}

describe(CdfDroneImageService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockGetDownloadUrls: ReturnType<typeof vi.fn>;
  let service: DroneImageService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    mockGetDownloadUrls = vi.fn();
    const mockClient = {
      instances: { list: mockInstancesList } as unknown as CogniteClient['instances'],
      files: { getDownloadUrls: mockGetDownloadUrls } as unknown as CogniteClient['files'],
    };
    service = new CdfDroneImageService(mockClient as CogniteClient);
  });

  describe('listForArea', () => {
    it('should first query InspectionResult nodes filtered by area', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      await service.listForArea('autoassess', 'area-ship-ch-sim');

      expect(mockInstancesList).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...INSPECTION_RESULT_VIEW } }],
          filter: {
            equals: {
              property: getContainerProperty(INSPECTION_RESULT_CONTAINER, 'area'),
              value: { space: 'autoassess', externalId: 'area-ship-ch-sim' },
            },
          },
        }),
      );
    });

    it('should return empty array when no campaigns exist for the area', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      const results = await service.listForArea('autoassess', 'area-ship-ch-sim');

      expect(results).toEqual([]);
      expect(mockInstancesList).toHaveBeenCalledTimes(1);
    });

    it('should query DroneImage nodes for each resolved campaign', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode('result-ship-ch-sim')] })
        .mockResolvedValueOnce({ items: [] });

      await service.listForArea('autoassess', 'area-ship-ch-sim');

      expect(mockInstancesList).toHaveBeenCalledTimes(2);
      expect(mockInstancesList).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...DRONE_IMAGE_VIEW } }],
          filter: {
            equals: {
              property: getContainerProperty(DRONE_IMAGE_CONTAINER, 'campaignExternalId'),
              value: 'result-ship-ch-sim',
            },
          },
        }),
      );
    });
  });

  describe('listForCampaign', () => {
    it('should query DroneImage nodes with equals filter on campaignExternalId', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      await service.listForCampaign('result-ship-ch-sim');

      expect(mockInstancesList).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...DRONE_IMAGE_VIEW } }],
          filter: {
            equals: {
              property: getContainerProperty(DRONE_IMAGE_CONTAINER, 'campaignExternalId'),
              value: 'result-ship-ch-sim',
            },
          },
        }),
      );
    });

    it('should return empty array when no images exist for the campaign', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      const results = await service.listForCampaign('result-ship-ch-sim');

      expect(results).toEqual([]);
    });

    it('should map response nodes to DroneImage[]', async () => {
      mockInstancesList.mockResolvedValue({ items: [makeMockDroneImageNode()] });

      const results = await service.listForCampaign('result-ship-ch-sim');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        space: 'autoassess',
        externalId: 'drone-image-result-ship-ch-sim-frame-1',
        campaignExternalId: 'result-ship-ch-sim',
        frameId: 1,
        timestamp: 1762179077.257,
        position: [0.038, -0.098, 4.398],
        orientationQuat: [0.001, 0.0003, -0.683, 0.730],
        cdfFileId: 1001,
        bboxMin: [-2.0, -13.0, 6.0],
        bboxMax: [10.0, 0.0, 9.0],
      });
    });

    it('should default numeric fields to 0 when absent', async () => {
      const sparse = makeMockDroneImageNode({
        positionX: undefined,
        positionY: undefined,
        positionZ: undefined,
        frameId: undefined,
        timestamp: undefined,
        cdfFileId: undefined,
      });
      mockInstancesList.mockResolvedValue({ items: [sparse] });

      const [result] = await service.listForCampaign('result-ship-ch-sim');

      expect(result.position).toEqual([0, 0, 0]);
      expect(result.frameId).toBe(0);
      expect(result.timestamp).toBe(0);
      expect(result.cdfFileId).toBe(0);
    });

    it('should default orientQw to 1 when absent', async () => {
      const sparse = makeMockDroneImageNode({ orientQw: undefined });
      mockInstancesList.mockResolvedValue({ items: [sparse] });

      const [result] = await service.listForCampaign('result-ship-ch-sim');

      expect(result.orientationQuat[3]).toBe(1);
    });

    it('should propagate errors thrown by the SDK', async () => {
      mockInstancesList.mockRejectedValue(new Error('Network error'));

      await expect(service.listForCampaign('result-ship-ch-sim')).rejects.toThrow('Network error');
    });
  });

  describe('getDownloadUrl', () => {
    it('should call files.getDownloadUrls with the file ID and return the URL', async () => {
      mockGetDownloadUrls.mockResolvedValue([{ downloadUrl: 'https://cdn.example.test/image.png' }]);

      const url = await service.getDownloadUrl(1001);

      expect(mockGetDownloadUrls).toHaveBeenCalledWith([{ id: 1001 }]);
      expect(url).toBe('https://cdn.example.test/image.png');
    });

    it('should throw when no download URL is returned', async () => {
      mockGetDownloadUrls.mockResolvedValue([]);

      await expect(service.getDownloadUrl(1001)).rejects.toThrow('No download URL');
    });
  });
});
