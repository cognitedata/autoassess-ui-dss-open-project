import type { CogniteClient } from '@cognite/sdk';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  NDT_MEASUREMENT_VIEW,
  NDT_MEASUREMENT_CONTAINER,
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';

import { CdfNdtMeasurementService } from './NdtMeasurementService';
import type { NdtMeasurementService } from './NdtMeasurementService';

function makeMockResultNode(externalId = 'result-01581') {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId,
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
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

function makeMockNdtNode(overrides: Record<string, unknown> = {}) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'ndt-001',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [NDT_MEASUREMENT_VIEW.space]: {
        [`${NDT_MEASUREMENT_VIEW.externalId}/${NDT_MEASUREMENT_VIEW.version}`]: {
          campaign: { space: 'autoassess', externalId: 'result-01581' },
          position3d: [7.90, 1.12, 1.31],
          thicknessMm: 12.5,
          timestamp: '2024-09-15T09:23:00Z',
          ...overrides,
        },
      },
    },
  };
}

describe(CdfNdtMeasurementService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let service: NdtMeasurementService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockClient = {
      instances: {
        list: mockInstancesList,
      } as unknown as CogniteClient['instances'],
    };
    service = new CdfNdtMeasurementService(mockClient as CogniteClient);
  });

  describe('listForArea', () => {
    it('should first query InspectionResult nodes filtered by area', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

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

    it('should return empty array when no campaigns exist for the area', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      const results = await service.listForArea('autoassess', 'area-01581');

      expect(results).toEqual([]);
      expect(mockInstancesList).toHaveBeenCalledTimes(1);
    });

    it('should query NdtMeasurement nodes filtered by resolved campaign IDs', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode('result-01581')] })
        .mockResolvedValueOnce({ items: [] });

      await service.listForArea('autoassess', 'area-01581');

      expect(mockInstancesList).toHaveBeenCalledTimes(2);
      expect(mockInstancesList).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...NDT_MEASUREMENT_VIEW } }],
          filter: {
            in: {
              property: getContainerProperty(NDT_MEASUREMENT_CONTAINER, 'campaign'),
              values: [{ space: 'autoassess', externalId: 'result-01581' }],
            },
          },
        }),
      );
    });

    it('should map response nodes to NdtMeasurement[]', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [makeMockNdtNode()] });

      const results = await service.listForArea('autoassess', 'area-01581');

      expect(results).toEqual([
        {
          space: 'autoassess',
          externalId: 'ndt-001',
          campaignExternalId: 'result-01581',
          position3d: [7.90, 1.12, 1.31],
          thicknessMm: 12.5,
          timestamp: '2024-09-15T09:23:00Z',
        },
      ]);
    });

    it('should default thicknessMm to 0 when absent', async () => {
      const nodeWithoutThickness = makeMockNdtNode();
      delete (
        nodeWithoutThickness.properties[NDT_MEASUREMENT_VIEW.space][
          `${NDT_MEASUREMENT_VIEW.externalId}/${NDT_MEASUREMENT_VIEW.version}`
        ] as Record<string, unknown>
      )['thicknessMm'];
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [nodeWithoutThickness] });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.thicknessMm).toBe(0);
    });

    it('should default position3d to [0,0,0] when absent', async () => {
      const nodeWithoutPos = makeMockNdtNode();
      delete (
        nodeWithoutPos.properties[NDT_MEASUREMENT_VIEW.space][
          `${NDT_MEASUREMENT_VIEW.externalId}/${NDT_MEASUREMENT_VIEW.version}`
        ] as Record<string, unknown>
      )['position3d'];
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockResolvedValueOnce({ items: [nodeWithoutPos] });

      const [result] = await service.listForArea('autoassess', 'area-01581');

      expect(result.position3d).toEqual([0, 0, 0]);
    });

    it('should propagate errors thrown by the SDK on results query', async () => {
      mockInstancesList.mockRejectedValue(new Error('Network error'));

      await expect(service.listForArea('autoassess', 'area-01581')).rejects.toThrow(
        'Network error',
      );
    });

    it('should propagate errors thrown by the SDK on measurements query', async () => {
      mockInstancesList
        .mockResolvedValueOnce({ items: [makeMockResultNode()] })
        .mockRejectedValueOnce(new Error('Measurements network error'));

      await expect(service.listForArea('autoassess', 'area-01581')).rejects.toThrow(
        'Measurements network error',
      );
    });
  });

  describe('listForCampaign', () => {
    it('should query NdtMeasurement nodes with an equals filter on campaign', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      await service.listForCampaign('autoassess', 'result-01581');

      expect(mockInstancesList).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...NDT_MEASUREMENT_VIEW } }],
          filter: {
            equals: {
              property: getContainerProperty(NDT_MEASUREMENT_CONTAINER, 'campaign'),
              value: { space: 'autoassess', externalId: 'result-01581' },
            },
          },
        }),
      );
    });

    it('should return empty array when no measurements exist for the campaign', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      const results = await service.listForCampaign('autoassess', 'result-01581');

      expect(results).toEqual([]);
    });

    it('should map response nodes to NdtMeasurement[]', async () => {
      mockInstancesList.mockResolvedValue({ items: [makeMockNdtNode()] });

      const results = await service.listForCampaign('autoassess', 'result-01581');

      expect(results).toEqual([
        {
          space: 'autoassess',
          externalId: 'ndt-001',
          campaignExternalId: 'result-01581',
          position3d: [7.90, 1.12, 1.31],
          thicknessMm: 12.5,
          timestamp: '2024-09-15T09:23:00Z',
        },
      ]);
    });

    it('should propagate errors thrown by the SDK', async () => {
      mockInstancesList.mockRejectedValue(new Error('Network error'));

      await expect(service.listForCampaign('autoassess', 'result-01581')).rejects.toThrow(
        'Network error',
      );
    });
  });
});
