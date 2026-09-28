import type { InspectionPlan } from '../features/viewer/InspectionPlanService';

export function createMockInspectionPlan(overrides: Partial<InspectionPlan> = {}): InspectionPlan {
  return {
    space: 'autoassess',
    externalId: 'plan-area-01581-001',
    areaExternalId: 'area-01581',
    mapExternalId: 'result-legacy-area-01581',
    status: 'Draft',
    createdTime: 1700000000000,
    name: null,
    description: null,
    ...overrides,
  };
}
