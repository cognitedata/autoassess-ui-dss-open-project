import type { NdtMeasurement } from '../viewer/NdtMeasurementService';

export interface CampaignBoxStats {
  campaignId: string;
  /** ISO date string displayed as x-axis tick label. */
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Number of measurements in the sample. */
  n: number;
}

export function computeBoxStats(
  campaignId: string,
  label: string,
  measurements: NdtMeasurement[],
): CampaignBoxStats | null {
  if (measurements.length === 0) return null;

  const sorted = measurements.map((m) => m.thicknessMm).sort((a, b) => a - b);
  const n = sorted.length;

  const lowerHalf = sorted.slice(0, Math.floor(n / 2));
  const upperHalf = sorted.slice(Math.ceil(n / 2));

  return {
    campaignId,
    label,
    min: sorted[0],
    max: sorted[n - 1],
    median: computeMedian(sorted),
    q1: lowerHalf.length > 0 ? computeMedian(lowerHalf) : sorted[0],
    q3: upperHalf.length > 0 ? computeMedian(upperHalf) : sorted[n - 1],
    n,
  };
}

function computeMedian(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
