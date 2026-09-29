import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CogniteClient } from '@cognite/sdk';
import { CdfInspectionPlanService } from './InspectionPlanService';
import type { InspectionPlanService } from './InspectionPlanService';
import {
  AUTOASSESS_SPACE,
  INSPECTION_PLAN_VIEW,
  INSPECTION_PLAN_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';

function makeMockPlanNodeResponse(overrides: Record<string, unknown> = {}, nodeOverrides: Record<string, unknown> = {}) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'plan-area-01581-001',
    version: 1,
    lastUpdatedTime: 1700000000000,
    createdTime: 1700000000000,
    properties: {
      [INSPECTION_PLAN_VIEW.space]: {
        [`${INSPECTION_PLAN_VIEW.externalId}/${INSPECTION_PLAN_VIEW.version}`]: {
          area: { space: 'autoassess', externalId: 'area-01581' },
          map: { space: 'autoassess', externalId: 'campaign-01581-001' },
          status: 'Draft',
          ...overrides,
        },
      },
    },
    ...nodeOverrides,
  };
}

describe(CdfInspectionPlanService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let service: InspectionPlanService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    mockInstancesUpsert = vi.fn();
    const mockClient = {
      instances: {
        list: mockInstancesList,
        upsert: mockInstancesUpsert,
      } as unknown as CogniteClient['instances'],
    };
    service = new CdfInspectionPlanService(mockClient as CogniteClient);
  });

  it('should request inspection plan nodes filtered by area and excluding soft-deleted plans', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    await service.listForArea('autoassess', 'area-01581');

    expect(mockInstancesList).toHaveBeenCalledWith({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...INSPECTION_PLAN_VIEW } }],
      filter: {
        and: [
          {
            equals: {
              property: getContainerProperty(INSPECTION_PLAN_CONTAINER, 'area'),
              value: { space: 'autoassess', externalId: 'area-01581' },
            },
          },
          {
            not: {
              exists: { property: getContainerProperty(INSPECTION_PLAN_CONTAINER, 'deletedAt') },
            },
          },
        ],
      },
      limit: 1000,
    });
  });

  it('should map response nodes to InspectionPlan[]', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

    const plans = await service.listForArea('autoassess', 'area-01581');

    expect(plans).toEqual([
      {
        space: 'autoassess',
        externalId: 'plan-area-01581-001',
        areaExternalId: 'area-01581',
        mapExternalId: 'campaign-01581-001',
        status: 'Draft',
        createdTime: 1700000000000,
        lastUpdatedTime: 1700000000000,
        name: null,
        description: null,
      },
    ]);
  });

  it('should default mapExternalId to null when the map relation is absent', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({ map: undefined })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.mapExternalId).toBeNull();
  });

  it('should map name and description when present', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({ name: 'Q3 hull survey', description: 'Focus on aft hull' })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.name).toBe('Q3 hull survey');
    expect(plan.description).toBe('Focus on aft hull');
  });

  it('should default name and description to null when absent from properties', async () => {
    mockInstancesList.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.name).toBeNull();
    expect(plan.description).toBeNull();
  });

  it('should map status field correctly', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({ status: 'Ready' })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.status).toBe('Ready');
  });

  it('should map Active status correctly', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({ status: 'Active' })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.status).toBe('Active');
  });

  it('should map Complete status correctly', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({ status: 'Complete' })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.status).toBe('Complete');
  });

  it('should default unknown status to Draft', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({ status: 'unknown' })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.status).toBe('Draft');
  });

  it('should map lastUpdatedTime from DMS node metadata', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({}, { lastUpdatedTime: 1760000000000 })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.lastUpdatedTime).toBe(1760000000000);
  });

  it('should map createdTime from DMS node metadata', async () => {
    mockInstancesList.mockResolvedValue({
      items: [makeMockPlanNodeResponse({}, { createdTime: 1750000000000 })],
    });

    const [plan] = await service.listForArea('autoassess', 'area-01581');

    expect(plan.createdTime).toBe(1750000000000);
  });

  it('should return plans sorted by createdTime descending (newest first)', async () => {
    mockInstancesList.mockResolvedValue({
      items: [
        makeMockPlanNodeResponse({}, { externalId: 'plan-old', createdTime: 1600000000000 }),
        makeMockPlanNodeResponse({}, { externalId: 'plan-new', createdTime: 1750000000000 }),
      ],
    });

    const plans = await service.listForArea('autoassess', 'area-01581');

    expect(plans[0].externalId).toBe('plan-new');
    expect(plans[1].externalId).toBe('plan-old');
  });

  it('should return an empty array when no plans exist', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const plans = await service.listForArea('autoassess', 'area-01581');

    expect(plans).toEqual([]);
  });

  it('should propagate errors thrown by the SDK', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    await expect(service.listForArea('autoassess', 'area-01581')).rejects.toThrow('Network error');
  });

  describe('create', () => {
    it('should upsert a new Draft plan node with area and map relations and no name/description properties by default', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

      await service.create('autoassess', 'area-01581', { mapExternalId: 'campaign-01581-001' });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            instanceType: 'node',
            space: AUTOASSESS_SPACE,
            externalId: expect.stringMatching(/^plan-/),
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: {
                  area: { space: 'autoassess', externalId: 'area-01581' },
                  map: { space: 'autoassess', externalId: 'campaign-01581-001' },
                  status: 'Draft',
                },
              },
            ],
          }),
        ],
      });
    });

    it('should trim and send provided name/description on create', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

      await service.create('autoassess', 'area-01581', {
        mapExternalId: 'campaign-01581-001',
        name: '  Q3 hull survey  ',
        description: '  Focus on aft hull  ',
      });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [
              expect.objectContaining({
                properties: expect.objectContaining({
                  name: 'Q3 hull survey',
                  description: 'Focus on aft hull',
                }),
              }),
            ],
          }),
        ],
      });
    });

    it('should omit name/description properties when blank', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

      await service.create('autoassess', 'area-01581', {
        mapExternalId: 'campaign-01581-001',
        name: '   ',
        description: '',
      });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: {
                  area: { space: 'autoassess', externalId: 'area-01581' },
                  map: { space: 'autoassess', externalId: 'campaign-01581-001' },
                  status: 'Draft',
                },
              },
            ],
          }),
        ],
      });
    });

    it('should map the returned node to an InspectionPlan', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

      const plan = await service.create('autoassess', 'area-01581', {
        mapExternalId: 'campaign-01581-001',
      });

      expect(plan).toEqual({
        space: 'autoassess',
        externalId: 'plan-area-01581-001',
        areaExternalId: 'area-01581',
        mapExternalId: 'campaign-01581-001',
        status: 'Draft',
        createdTime: 1700000000000,
        lastUpdatedTime: 1700000000000,
        name: null,
        description: null,
      });
    });

    it('should include the provided name/description in the returned InspectionPlan', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [makeMockPlanNodeResponse()] });

      const plan = await service.create('autoassess', 'area-01581', {
        mapExternalId: 'campaign-01581-001',
        name: 'Q3 hull survey',
        description: 'Focus on aft hull',
      });

      expect(plan.name).toBe('Q3 hull survey');
      expect(plan.description).toBe('Focus on aft hull');
    });

    it('should throw if upsert returns no node', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await expect(
        service.create('autoassess', 'area-01581', { mapExternalId: 'campaign-01581-001' }),
      ).rejects.toThrow('Plan creation returned no node');
    });

    it('should propagate SDK errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      await expect(
        service.create('autoassess', 'area-01581', { mapExternalId: 'campaign-01581-001' }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('updateStatus', () => {
    it('should upsert the node with the given status', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.updateStatus('autoassess', 'plan-area-01581-001', 'Ready');

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          {
            instanceType: 'node',
            space: 'autoassess',
            externalId: 'plan-area-01581-001',
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: { status: 'Ready' },
              },
            ],
          },
        ],
      });
    });

    it('should accept the Active status', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.updateStatus('autoassess', 'plan-area-01581-001', 'Active');

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: { status: 'Active' },
              },
            ],
          }),
        ],
      });
    });

    it('should propagate SDK errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      await expect(
        service.updateStatus('autoassess', 'plan-area-01581-001', 'Draft'),
      ).rejects.toThrow('Network error');
    });
  });

  describe('update', () => {
    it('should upsert only the provided name property', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.update('autoassess', 'plan-area-01581-001', { name: 'Q3 hull survey' });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          {
            instanceType: 'node',
            space: 'autoassess',
            externalId: 'plan-area-01581-001',
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: { name: 'Q3 hull survey' },
              },
            ],
          },
        ],
      });
    });

    it('should upsert only the provided description property', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.update('autoassess', 'plan-area-01581-001', { description: 'Focus on aft hull' });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: { description: 'Focus on aft hull' },
              },
            ],
          }),
        ],
      });
    });

    it('should upsert both name and description when both are provided', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.update('autoassess', 'plan-area-01581-001', {
        name: '  Q3 hull survey  ',
        description: '  Focus on aft hull  ',
      });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [
              expect.objectContaining({
                properties: { name: 'Q3 hull survey', description: 'Focus on aft hull' },
              }),
            ],
          }),
        ],
      });
    });

    it('should upsert the map relation when mapExternalId is provided', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.update('autoassess', 'plan-area-01581-001', {
        mapExternalId: 'result-2024-09-15',
      });

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: {
                  map: { space: 'autoassess', externalId: 'result-2024-09-15' },
                },
              },
            ],
          }),
        ],
      });
    });

    it('should send an empty properties object when neither field is provided', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.update('autoassess', 'plan-area-01581-001', {});

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            sources: [expect.objectContaining({ properties: {} })],
          }),
        ],
      });
    });

    it('should propagate SDK errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      await expect(
        service.update('autoassess', 'plan-area-01581-001', { name: 'X' }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('delete', () => {
    it('should upsert a deletedAt timestamp', async () => {
      mockInstancesUpsert.mockResolvedValue({ items: [] });

      await service.delete('autoassess', 'plan-area-01581-001');

      expect(mockInstancesUpsert).toHaveBeenCalledWith({
        items: [
          {
            instanceType: 'node',
            space: 'autoassess',
            externalId: 'plan-area-01581-001',
            sources: [
              {
                source: { type: 'view', ...INSPECTION_PLAN_VIEW },
                properties: { deletedAt: expect.any(String) },
              },
            ],
          },
        ],
      });
    });

    it('should propagate SDK errors', async () => {
      mockInstancesUpsert.mockRejectedValue(new Error('Network error'));

      await expect(service.delete('autoassess', 'plan-area-01581-001')).rejects.toThrow(
        'Network error',
      );
    });
  });
});
