import type { CogniteClient } from '@cognite/sdk';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  CAMPAIGN_METRIC_VIEW,
  CAMPAIGN_METRIC_CONTAINER,
  getContainerProperty,
} from '../../shared/cdf/dataModel';

import { CdfCampaignMetricService } from './CampaignMetricService';
import type { CampaignMetricService } from './CampaignMetricService';

function makeMockMetricNode(overrides: Record<string, unknown> = {}) {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'result-test-metric-coverage',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [CAMPAIGN_METRIC_VIEW.space]: {
        [`${CAMPAIGN_METRIC_VIEW.externalId}/${CAMPAIGN_METRIC_VIEW.version}`]: {
          campaign: { space: 'autoassess', externalId: 'result-test' },
          name: 'Coverage',
          value: 91.3,
          unit: 'percentage',
          ...overrides,
        },
      },
    },
  };
}

describe(CdfCampaignMetricService.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let service: CampaignMetricService;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockClient = {
      instances: {
        list: mockInstancesList,
      } as unknown as CogniteClient['instances'],
    };
    service = new CdfCampaignMetricService(mockClient as CogniteClient);
  });

  describe('listForCampaign', () => {
    it('should query CampaignMetric nodes with an equals filter on campaign', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      await service.listForCampaign('autoassess', 'result-test');

      expect(mockInstancesList).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: [{ source: { type: 'view', ...CAMPAIGN_METRIC_VIEW } }],
          filter: {
            equals: {
              property: getContainerProperty(CAMPAIGN_METRIC_CONTAINER, 'campaign'),
              value: { space: 'autoassess', externalId: 'result-test' },
            },
          },
        }),
      );
    });

    it('should return empty array when campaign has no metrics', async () => {
      mockInstancesList.mockResolvedValue({ items: [] });

      const results = await service.listForCampaign('autoassess', 'result-test');

      expect(results).toEqual([]);
    });

    it('should map response nodes to CampaignMetric[]', async () => {
      mockInstancesList.mockResolvedValue({ items: [makeMockMetricNode()] });

      const results = await service.listForCampaign('autoassess', 'result-test');

      expect(results).toEqual([
        {
          space: 'autoassess',
          externalId: 'result-test-metric-coverage',
          campaignExternalId: 'result-test',
          name: 'Coverage',
          value: 91.3,
          unit: 'percentage',
        },
      ]);
    });

    it('should default value to 0 when absent', async () => {
      mockInstancesList.mockResolvedValue({
        items: [makeMockMetricNode({ value: undefined })],
      });

      const [result] = await service.listForCampaign('autoassess', 'result-test');

      expect(result.value).toBe(0);
    });

    it('should default unit to decimal when unit is unknown', async () => {
      mockInstancesList.mockResolvedValue({
        items: [makeMockMetricNode({ unit: 'bogus' })],
      });

      const [result] = await service.listForCampaign('autoassess', 'result-test');

      expect(result.unit).toBe('decimal');
    });

    it('should propagate errors thrown by the SDK', async () => {
      mockInstancesList.mockRejectedValue(new Error('Network error'));

      await expect(service.listForCampaign('autoassess', 'result-test')).rejects.toThrow(
        'Network error',
      );
    });
  });
});
