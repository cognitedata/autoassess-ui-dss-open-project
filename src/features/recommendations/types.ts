import type { NdtMeasurement } from '../viewer/NdtMeasurementService';
import type { DefectDetection } from '../viewer/DefectDetectionService';

export type NdtRepeatRecommendation = {
  kind: 'ndt_repeat';
  /** Stable ID: "ndt_repeat:<measurement.externalId>" */
  id: string;
  source: NdtMeasurement;
  campaignDate: string;
  thresholdMm: number;
};

export type ConfirmedDefectRecommendation = {
  kind: 'confirmed_defect';
  /** Stable ID: "confirmed_defect:<defect.externalId>" */
  id: string;
  source: DefectDetection;
  campaignDate: string;
};

export type Recommendation = NdtRepeatRecommendation | ConfirmedDefectRecommendation;
