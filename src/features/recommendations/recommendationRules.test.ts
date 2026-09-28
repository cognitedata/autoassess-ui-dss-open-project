import { describe, it, expect, beforeEach } from 'vitest';
import {
  ndtRepeatRecommendations,
  confirmedDefectRecommendations,
  NDT_REPEAT_THRESHOLD_MM,
} from './recommendationRules';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';
import { createMockDefectDetection } from '../../__mocks__/defectDetections';
import type { InspectionResult } from '../viewer/InspectionResultService';

const CAMPAIGN_DATE = '2024-09-15';

describe(ndtRepeatRecommendations.name, () => {
  beforeEach(() => {
    // Reset mock counters by re-importing — counters are module-level, tests use distinct IDs via overrides
  });

  it('returns empty array when no measurements are below threshold', () => {
    const measurements = [
      createMockNdtMeasurement({ externalId: 'ndt-a', thicknessMm: NDT_REPEAT_THRESHOLD_MM }),
      createMockNdtMeasurement({ externalId: 'ndt-b', thicknessMm: 15 }),
    ];
    expect(ndtRepeatRecommendations(measurements, CAMPAIGN_DATE)).toHaveLength(0);
  });

  it('returns a recommendation for each measurement below threshold', () => {
    const measurements = [
      createMockNdtMeasurement({ externalId: 'ndt-low', thicknessMm: 8 }),
      createMockNdtMeasurement({ externalId: 'ndt-ok', thicknessMm: 12 }),
      createMockNdtMeasurement({ externalId: 'ndt-low2', thicknessMm: 5 }),
    ];
    const result = ndtRepeatRecommendations(measurements, CAMPAIGN_DATE);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('ndt_repeat');
    expect(result[0].id).toBe('ndt_repeat:ndt-low');
    expect(result[0].source.externalId).toBe('ndt-low');
    expect(result[0].campaignDate).toBe(CAMPAIGN_DATE);
    expect(result[0].thresholdMm).toBe(NDT_REPEAT_THRESHOLD_MM);
  });

  it('excludes measurements exactly at threshold (strict less-than)', () => {
    const measurements = [
      createMockNdtMeasurement({ externalId: 'ndt-exact', thicknessMm: NDT_REPEAT_THRESHOLD_MM }),
    ];
    expect(ndtRepeatRecommendations(measurements, CAMPAIGN_DATE)).toHaveLength(0);
  });

  it('uses the provided custom threshold', () => {
    const measurements = [
      createMockNdtMeasurement({ externalId: 'ndt-x', thicknessMm: 12 }),
    ];
    expect(ndtRepeatRecommendations(measurements, CAMPAIGN_DATE, 15)).toHaveLength(1);
    expect(ndtRepeatRecommendations(measurements, CAMPAIGN_DATE, 10)).toHaveLength(0);
  });

  it('returns empty array when given no measurements', () => {
    expect(ndtRepeatRecommendations([], CAMPAIGN_DATE)).toHaveLength(0);
  });
});

describe(confirmedDefectRecommendations.name, () => {
  const campaigns: InspectionResult[] = [
    {
      space: 'autoassess',
      externalId: 'campaign-1',
      areaExternalId: 'area-1',
      date: '2024-09-15',
      status: 'Complete',
      cdfFileIds: [],
      pcdFileIds: [],
      pcdFileLabels: [],
    },
  ];

  it('returns empty array when no defects are confirmed', () => {
    const defects = [
      createMockDefectDetection({ externalId: 'def-a', status: 'New' }),
      createMockDefectDetection({ externalId: 'def-b', status: 'Dismissed' }),
      createMockDefectDetection({ externalId: 'def-c', status: 'UnderReview' }),
    ];
    expect(confirmedDefectRecommendations(defects, campaigns)).toHaveLength(0);
  });

  it('returns a recommendation for each confirmed defect', () => {
    const defects = [
      createMockDefectDetection({
        externalId: 'def-confirmed',
        status: 'Confirmed',
        campaignExternalId: 'campaign-1',
      }),
      createMockDefectDetection({ externalId: 'def-new', status: 'New' }),
    ];
    const result = confirmedDefectRecommendations(defects, campaigns);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('confirmed_defect');
    expect(result[0].id).toBe('confirmed_defect:def-confirmed');
    expect(result[0].source.externalId).toBe('def-confirmed');
    expect(result[0].campaignDate).toBe('2024-09-15');
  });

  it('resolves campaignDate from campaigns list', () => {
    const multiCampaigns: InspectionResult[] = [
      { ...campaigns[0], externalId: 'c-old', date: '2023-01-01' },
      { ...campaigns[0], externalId: 'c-new', date: '2024-06-01' },
    ];
    const defects = [
      createMockDefectDetection({
        externalId: 'def-1',
        status: 'Confirmed',
        campaignExternalId: 'c-new',
      }),
    ];
    const result = confirmedDefectRecommendations(defects, multiCampaigns);
    expect(result[0].campaignDate).toBe('2024-06-01');
  });

  it('sets campaignDate to empty string when campaign is not found', () => {
    const defects = [
      createMockDefectDetection({
        externalId: 'def-orphan',
        status: 'Confirmed',
        campaignExternalId: 'campaign-unknown',
      }),
    ];
    const result = confirmedDefectRecommendations(defects, campaigns);
    expect(result[0].campaignDate).toBe('');
  });

  it('returns empty array when given no defects', () => {
    expect(confirmedDefectRecommendations([], campaigns)).toHaveLength(0);
  });
});
