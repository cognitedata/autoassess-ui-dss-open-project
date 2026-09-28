import { describe, it, expect } from 'vitest';
import { computeBoxStats } from './ndtStats';
import type { NdtMeasurement } from '../viewer/NdtMeasurementService';

function makeMeasurements(thicknessValues: number[]): NdtMeasurement[] {
  return thicknessValues.map((thicknessMm, i) => ({
    space: 'autoassess',
    externalId: `ndt-${i}`,
    campaignExternalId: 'campaign-1',
    position3d: [0, 0, 0] as [number, number, number],
    thicknessMm,
    timestamp: '2024-09-15T00:00:00Z',
  }));
}

describe(computeBoxStats.name, () => {
  it('should return null for empty measurements', () => {
    expect(computeBoxStats('c1', '2024-09-15', [])).toBeNull();
  });

  it('should return all equal stats for a single measurement', () => {
    const result = computeBoxStats('c1', '2024-09-15', makeMeasurements([8.5]));
    expect(result).toEqual({
      campaignId: 'c1',
      label: '2024-09-15',
      min: 8.5,
      q1: 8.5,
      median: 8.5,
      q3: 8.5,
      max: 8.5,
      n: 1,
    });
  });

  it('should compute correct stats for even n=[2,5,7,10]', () => {
    const result = computeBoxStats('c1', '2024-09-15', makeMeasurements([2, 5, 7, 10]));
    expect(result?.min).toBe(2);
    expect(result?.q1).toBe(3.5);
    expect(result?.median).toBe(6);
    expect(result?.q3).toBe(8.5);
    expect(result?.max).toBe(10);
    expect(result?.n).toBe(4);
  });

  it('should compute correct stats for odd n=[1,3,5,7,9]', () => {
    const result = computeBoxStats('c1', '2024-09-15', makeMeasurements([1, 3, 5, 7, 9]));
    expect(result?.min).toBe(1);
    expect(result?.q1).toBe(2);
    expect(result?.median).toBe(5);
    expect(result?.q3).toBe(8);
    expect(result?.max).toBe(9);
    expect(result?.n).toBe(5);
  });

  it('should pass through campaignId and label unchanged', () => {
    const result = computeBoxStats('my-campaign', '2024-03-01', makeMeasurements([10]));
    expect(result?.campaignId).toBe('my-campaign');
    expect(result?.label).toBe('2024-03-01');
  });

  it('should sort measurements before computing stats', () => {
    // Unsorted input — result should be identical to sorted
    const result = computeBoxStats('c1', '2024-09-15', makeMeasurements([10, 2, 7, 5]));
    expect(result?.min).toBe(2);
    expect(result?.max).toBe(10);
    expect(result?.median).toBe(6);
  });
});
