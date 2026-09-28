import type { CogniteClient } from '@cognite/sdk';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  DEFECT_DETECTION_VIEW,
  DEFECT_DETECTION_CONTAINER,
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';

import { CdfDefectDetectionService } from './DefectDetectionService';
import type { DefectDetectionService } from './DefectDetectionService';


function makeMockResultNode(externalId = 'result-01581') {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId,
    version: 1,
    lastUpdatedTime: 1700000000000,
    createdTime: 1699000000000,
    properties: {
      [INSPECTION_RESULT_VIEW.space]: {
        [`${INSPECTION_RESULT_VIEW.externalId}/${INSPECTION_RESULT_VIEW.version}`]: {
          area: { space: 'autoassess', externalId: 'area-01581' },
          campaignDate: '2024-09-15',
          status: 'Complete',
          cdfFileIds: [],
        },
      },
    },
  };
}

function makeMockDefectNode(overrides: Record<string, unknown> = {}) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'defect-001',
    version: 1,
    lastUpdatedTime: 1700000000000,
    createdTime: 1699000000000,
    properties: {
      [DEFECT_DETECTION_VIEW.space]: {
        [`${DEFECT_DETECTION_VIEW.externalId}/${DEFECT_DETECTION_VIEW.version}`]: {
          campaign: { space: 'autoassess', externalId: 'result-01581' },
          probability: 0.87,
          defectClass: 'corrosion',
          boundingBox3d: [1, 2, 3, 0.1, 0.1, 0.1, 0, 0, 0],
          status: 'New',
          ...overrides,
        },
      },
    },
  };
}

describe(CdfDefectDetectionService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockInstancesDelete: ReturnType<typeof vi.fn>;
  let service: DefectDetectionService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    mockInstancesUpsert = vi.fn();
    mockInstancesDelete = vi.fn();
    const mockClient = {
      instances: {
        list: mockInstancesList,
        upsert: mockInstancesUpsert,
        delete: mockInstancesDelete,
      } as unknown as CogniteClient['instances'],
    };
    service = new CdfDefectDetectionService(mockClient as CogniteClient);
  });

  describe('listForArea', () => {
    it('should first query InspectionResult nodes filtered by area', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] });

      await service.listForArea('autoassess', 'area-01581');

      expect(mockInstancesList).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...INSPECTION_RESULT_VIEW } }],
          filter: {
            equals: {
              property: getContainerProperty(INSPECTION_RESULT_CONTAINER, 'area'),
              value: { space: 'autoassess', externalId: 'area-01581' },
            },
          },
        }),
      );
    });

    it('should always make a second query even when no campaigns exist (for manual defects)', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] });

      await service.listForArea('autoassess', 'area-01581');

      expect(mockInstancesList).toHaveBeenCalledTimes(2);
    });

    it('should query DefectDetection nodes by area-only filter when no campaigns', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] });

      await service.listForArea('autoassess', 'area-01581');

      expect(mockInstancesList).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...DEFECT_DETECTION_VIEW } }],
          filter: {
            equals: {
              property: getContainerProperty(DEFECT_DETECTION_CONTAINER, 'area'),
              value: { space: 'autoassess', externalId: 'area-01581' },
            },
          },
        }),
      );
    });

    it('should query DefectDetection nodes with OR filter when campaigns exist', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode('result-01581')] })
        .mockResolvedValueOnce({ items: [] });

      await service.listForArea('autoassess', 'area-01581');

      expect(mockInstancesList).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...DEFECT_DETECTION_VIEW } }],
          filter: {
            or: [
              {
                in: {
                  property: getContainerProperty(DEFECT_DETECTION_CONTAINER, 'campaign'),
                  values: [{ space: 'autoassess', externalId: 'result-01581' }],
                },
              },
              {
                equals: {
                  property: getContainerProperty(DEFECT_DETECTION_CONTAINER, 'area'),
                  value: { space: 'autoassess', externalId: 'area-01581' },
                },
              },
            ],
          },
        }),
      );
    });

    it('should map response nodes to DefectDetection[]', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [makeMockDefectNode()] });

      const results = await service.listForArea('autoassess', 'area-01581');

      expect(results).toEqual([
        {
          space: 'autoassess',
          externalId: 'defect-001',
          campaignExternalId: 'result-01581',
          probability: 0.87,
          defectClass: 'corrosion',
          boundingBox3d: [1, 2, 3, 0.1, 0.1, 0.1, 0, 0, 0],
          status: 'New',
          createdTime: new Date(1699000000000),
          lastUpdatedTime: new Date(1700000000000),
        },
      ]);
    });

    it('should read normal3d when present', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({
          items: [makeMockDefectNode({ normal3d: [0, 1, 0] })],
        });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.normal3d).toEqual([0, 1, 0]);
    });

    it('should leave normal3d undefined when absent', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [makeMockDefectNode()] });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.normal3d).toBeUndefined();
    });

    it('should read source when present', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [makeMockDefectNode({ campaign: undefined, source: 'manual' })],
        });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.source).toBe('manual');
    });

    it('should leave source undefined when absent', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [makeMockDefectNode()] });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.source).toBeUndefined();
    });

    it('should leave campaignExternalId undefined when campaign is absent', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [makeMockDefectNode({ campaign: undefined })],
        });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.campaignExternalId).toBeUndefined();
    });

    it('should default unknown status to New', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [makeMockDefectNode({ status: 'INVALID' })] });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.status).toBe('New');
    });

    it('should default probability to 0 when absent', async () => {
      const nodeWithoutProb = makeMockDefectNode();
      delete (
        nodeWithoutProb.properties[DEFECT_DETECTION_VIEW.space][
          `${DEFECT_DETECTION_VIEW.externalId}/${DEFECT_DETECTION_VIEW.version}`
        ] as Record<string, unknown>
      )['probability'];
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [nodeWithoutProb] });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.probability).toBe(0);
    });

    it('should return empty boundingBox3d when property is absent', async () => {
      const nodeWithoutBbox = makeMockDefectNode();
      delete (
        nodeWithoutBbox.properties[DEFECT_DETECTION_VIEW.space][
          `${DEFECT_DETECTION_VIEW.externalId}/${DEFECT_DETECTION_VIEW.version}`
        ] as Record<string, unknown>
      )['boundingBox3d'];
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [nodeWithoutBbox] });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.boundingBox3d).toEqual([]);
    });

    it('should propagate errors thrown by the SDK on results query', async () => {
      mockInstancesList.mockRejectedValue(new Error('Network error'));

      await expect(service.listForArea('autoassess', 'area-01581')).rejects.toThrow(
        'Network error',
      );
    });

    it('should propagate errors thrown by the SDK on defects query', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockRejectedValueOnce(new Error('Defects network error'));

      await expect(service.listForArea('autoassess', 'area-01581')).rejects.toThrow(
        'Defects network error',
      );
    });
  });

  describe('updateStatus', () => {
    it('should upsert node with new status', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.updateStatus('autoassess', 'defect-001', 'Confirmed');

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          {
            instanceType: 'node',
            space: 'autoassess',
            externalId: 'defect-001',
            sources: [
              {
                source: { type: 'view', ...DEFECT_DETECTION_VIEW },
                properties: { status: 'Confirmed' },
              },
            ],
          },
        ],
      });
    });

    it('should propagate errors from upsert', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Upsert failed'));

      await expect(
        service.updateStatus('autoassess', 'defect-001', 'Confirmed'),
      ).rejects.toThrow('Upsert failed');
    });
  });

  describe('update', () => {
    it('should upsert only the provided update fields', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.update('autoassess', 'defect-001', { defectClass: 'crack', probability: 0.5 });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          {
            instanceType: 'node',
            space: 'autoassess',
            externalId: 'defect-001',
            sources: [
              {
                source: { type: 'view', ...DEFECT_DETECTION_VIEW },
                properties: { defectClass: 'crack', probability: 0.5 },
              },
            ],
          },
        ],
      });
    });

    it('should propagate errors from upsert', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Update failed'));

      await expect(
        service.update('autoassess', 'defect-001', { status: 'Confirmed' }),
      ).rejects.toThrow('Update failed');
    });
  });

  describe('createManual', () => {
    it('should upsert a new manual defect node with source=manual', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.createManual('autoassess', 'area-01581', {
        position: [1, 2, 3],
        normal: [0, 1, 0],
        defectClass: 'crack',
        probability: 0.8,
      });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: 'autoassess',
            externalId: expect.stringContaining('manual-'),
            sources: [
              {
                source: { type: 'view', ...DEFECT_DETECTION_VIEW },
                properties: expect.objectContaining({
                  area: { space: 'autoassess', externalId: 'area-01581' },
                  defectClass: 'crack',
                  probability: 0.8,
                  normal3d: [0, 1, 0],
                  source: 'manual',
                  status: 'New',
                }),
              },
            ],
          }),
        ],
      });
    });

    it('should store position as the first 3 values of boundingBox3d', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.createManual('autoassess', 'area-01581', {
        position: [4, 5, 6],
        defectClass: 'corrosion',
        probability: 0.6,
      });

      const upsertArg = mockInstancesUpsert.mock.calls[0][0] as {
        items: { sources: { properties: { boundingBox3d: number[] } }[] }[];
      };
      const { boundingBox3d } = upsertArg.items[0].sources[0].properties;
      expect(boundingBox3d.slice(0, 3)).toEqual([4, 5, 6]);
    });

    it('should return the newly created DefectDetection object', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      const result = await service.createManual('autoassess', 'area-01581', {
        position: [1, 2, 3],
        normal: [0, 1, 0],
        defectClass: 'crack',
        probability: 0.8,
      });

      expect(result).toMatchObject({
        space: 'autoassess',
        externalId: expect.stringContaining('manual-'),
        probability: 0.8,
        defectClass: 'crack',
        normal3d: [0, 1, 0],
        source: 'manual',
        status: 'New',
      });
    });

    it('should omit normal3d from the result when not provided', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      const result = await service.createManual('autoassess', 'area-01581', {
        position: [1, 2, 3],
        defectClass: 'crack',
        probability: 0.8,
      });

      expect(result.normal3d).toBeUndefined();
    });

    it('should propagate errors from upsert', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Create failed'));

      await expect(
        service.createManual('autoassess', 'area-01581', {
          position: [0, 0, 0],
          defectClass: 'crack',
          probability: 0.5,
        }),
      ).rejects.toThrow('Create failed');
    });
  });

  describe('delete', () => {
    it('should call instances.delete with the correct node identifier', async () => {
      mockInstancesDelete.mockResolvedValue({ items: [] });

      await service.delete('autoassess', 'defect-001');

      expect(mockInstancesDelete).toHaveBeenCalledWith([
        { instanceType: 'node', space: 'autoassess', externalId: 'defect-001' },
      ]);
    });

    it('should propagate errors from delete', async () => {
      mockInstancesDelete.mockRejectedValue(new Error('Delete failed'));

      await expect(service.delete('autoassess', 'defect-001')).rejects.toThrow('Delete failed');
    });
  });
});
