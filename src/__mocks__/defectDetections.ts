import type { DefectDetection } from '../features/viewer/DefectDetectionService';

let counter = 0;

export function createMockDefectDetection(
  overrides: Partial<DefectDetection> = {},
): DefectDetection {
  counter += 1;
  return {
    space: 'autoassess',
    externalId: `defect-${counter.toString().padStart(3, '0')}`,
    campaignExternalId: 'result-01581',
    probability: 0.75,
    defectClass: 'corrosion',
    boundingBox3d: [1, 2, 3, 0.1, 0.1, 0.1, 0, 0, 0],
    status: 'New',
    ...overrides,
  };
}

export function createMockManualDefectDetection(
  overrides: Partial<DefectDetection> = {},
): DefectDetection {
  counter += 1;
  return {
    space: 'autoassess',
    externalId: `manual-${counter.toString().padStart(3, '0')}`,
    probability: 0.75,
    defectClass: 'corrosion',
    boundingBox3d: [1, 2, 3, 0, 0, 0, 0, 0, 0],
    normal3d: [0, 1, 0],
    source: 'manual',
    status: 'New',
    ...overrides,
  };
}
