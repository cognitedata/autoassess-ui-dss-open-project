import type { NdtMeasurement } from '../features/viewer/NdtMeasurementService';

let counter = 0;

export function createMockNdtMeasurement(
  overrides: Partial<NdtMeasurement> = {},
): NdtMeasurement {
  counter += 1;
  return {
    space: 'autoassess',
    externalId: `ndt-${counter.toString().padStart(3, '0')}`,
    campaignExternalId: 'result-legacy-area-01581',
    position3d: [7.90, 1.12, 1.31],
    thicknessMm: 12.5,
    timestamp: '2024-09-15T09:23:00Z',
    ...overrides,
  };
}
