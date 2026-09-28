import type { NdtMeasurement } from '../viewer/NdtMeasurementService';
import type { DefectDetection } from '../viewer/DefectDetectionService';
import type { InspectionResult } from '../viewer/InspectionResultService';
import type { NdtRepeatRecommendation, ConfirmedDefectRecommendation } from './types';

export const NDT_REPEAT_THRESHOLD_MM = 10;

export function ndtRepeatRecommendations(
  measurements: NdtMeasurement[],
  campaignDate: string,
  thresholdMm = NDT_REPEAT_THRESHOLD_MM,
): NdtRepeatRecommendation[] {
  return measurements
    .filter((m) => m.thicknessMm < thresholdMm)
    .map((m) => ({
      kind: 'ndt_repeat' as const,
      id: `ndt_repeat:${m.externalId}`,
      source: m,
      campaignDate,
      thresholdMm,
    }));
}

export function confirmedDefectRecommendations(
  defects: DefectDetection[],
  campaigns: InspectionResult[],
): ConfirmedDefectRecommendation[] {
  const dateByExternalId = new Map(campaigns.map((c) => [c.externalId, c.date]));

  return defects
    .filter((d) => d.status === 'Confirmed')
    .map((d) => ({
      kind: 'confirmed_defect' as const,
      id: `confirmed_defect:${d.externalId}`,
      source: d,
      campaignDate: d.campaignExternalId ? (dateByExternalId.get(d.campaignExternalId) ?? '') : '',
    }));
}
