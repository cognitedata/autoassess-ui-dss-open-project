import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CogniteClient } from '@cognite/sdk';
import { CdfInspectionResultService } from './InspectionResultService';
import type { InspectionResultService } from './InspectionResultService';
import {
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';

function makeMockResultNodeResponse(overrides: Record<string, unknown> = {}) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'result-legacy-area-01581',
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
          ...overrides,
        },
      },
    },
  };
}

describe(CdfInspectionResultService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let service: InspectionResultService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockClient = {
      instances: { list: mockInstancesList } as unknown as CogniteClient['instances'],
    };
    service = new CdfInspectionResultService(mockClient as CogniteClient);
  });

  it('should request inspection result nodes filtered by area', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    await service.listForArea('autoassess', 'area-01581');

    expect(mockInstancesList).toHaveBeenCalledWith({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...INSPECTION_RESULT_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(INSPECTION_RESULT_CONTAINER, 'area'),
          value: { space: 'autoassess', externalId: 'area-01581' },
        },
      },
      limit: 1000,
    });
  });

  it('should map response nodes to InspectionResult[]', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeMockResultNodeResponse()] });

    const results = await service.listForArea('autoassess', 'area-01581');

    expect(results).toEqual([
      {
        space: 'autoassess',
        externalId: 'result-legacy-area-01581',
        areaExternalId: 'area-01581',
        date: '2024-09-15',
        status: 'Complete',
        cdfFileIds: [],
        pcdFileIds: [],
        pcdFileLabels: [],
      },
    ]);
  });

  it('should map campaignDate to date field', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockResultNodeResponse({ campaignDate: '2024-03-01' })],
    });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.date).toBe('2024-03-01');
  });

  it('should map status field correctly', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockResultNodeResponse({ status: 'InProgress' })],
    });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.status).toBe('InProgress');
  });

  it('should default unknown status to Complete', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockResultNodeResponse({ status: 'Draft' })],
    });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.status).toBe('Complete');
  });

  it('should map cdfFileIds to number[]', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockResultNodeResponse({ cdfFileIds: [7654321, 1234567] })],
    });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.cdfFileIds).toEqual([7654321, 1234567]);
  });

  it('should return empty cdfFileIds when property is absent', async () => {
    const responseWithoutFileIds = makeMockResultNodeResponse();
    delete (
      responseWithoutFileIds.properties[INSPECTION_RESULT_VIEW.space][
        `${INSPECTION_RESULT_VIEW.externalId}/${INSPECTION_RESULT_VIEW.version}`
      ] as Record<string, unknown>
    )['cdfFileIds'];
    mockInstancesList.mockResolvedValue({ items: [responseWithoutFileIds] });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.cdfFileIds).toEqual([]);
  });

  it('should return results sorted by date descending', async () => {
    mockInstancesList.mockResolvedValue({
      items: [
        makeMockResultNodeResponse({ campaignDate: '2024-03-01' }),
        { ...makeMockResultNodeResponse({ campaignDate: '2024-09-15' }), externalId: 'result-2' },
      ],
    });

    const results = await service.listForArea('autoassess', 'area-01581');

    expect(results[0].date).toBe('2024-09-15');
    expect(results[1].date).toBe('2024-03-01');
  });

  it('should map pcdFileIds to number[]', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockResultNodeResponse({ pcdFileIds: [101, 102] })],
    });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.pcdFileIds).toEqual([101, 102]);
  });

  it('should return empty pcdFileIds when property is absent', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeMockResultNodeResponse()] });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.pcdFileIds).toEqual([]);
  });

  it('should map pcdFileLabels to string[]', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockResultNodeResponse({ pcdFileLabels: ['Pointcloud', 'Labeled cloud'] })],
    });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.pcdFileLabels).toEqual(['Pointcloud', 'Labeled cloud']);
  });

  it('should return empty pcdFileLabels when property is absent', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeMockResultNodeResponse()] });

    const [result] = await service.listForArea('autoassess', 'area-01581');

    expect(result.pcdFileLabels).toEqual([]);
  });

  it('should return an empty array when no results exist', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const results = await service.listForArea('autoassess', 'area-01581');

    expect(results).toEqual([]);
  });

  it('should propagate errors thrown by the SDK', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    await expect(service.listForArea('autoassess', 'area-01581')).rejects.toThrow('Network error');
  });
});
