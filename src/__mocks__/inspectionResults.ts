import type { InspectionResult } from '../features/viewer/InspectionResultService';

export function createMockInspectionResult(overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    space: 'autoassess',
    externalId: 'result-legacy-area-01581',
    areaExternalId: 'area-01581',
    date: '2024-09-15',
    status: 'Complete',
    cdfFileIds: [],
    pcdFileIds: [],
    pcdFileLabels: [],
    ...overrides,
  };
}
