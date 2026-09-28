import type { InspectionTask } from '../features/viewer/InspectionTaskService';

export function createMockInspectionTask(overrides: Partial<InspectionTask> = {}): InspectionTask {
  return {
    space: 'autoassess',
    externalId: 'task-abc-123',
    planExternalId: 'plan-area-01581-001',
    taskKind: 'element',
    inspectionType: 'visual',
    targetElementExternalId: 'element-3-15',
    ...overrides,
  };
}

export function createMockElementTask(overrides: Partial<InspectionTask> = {}): InspectionTask {
  return createMockInspectionTask({
    taskKind: 'element',
    targetElementExternalId: 'element-3-15',
    ...overrides,
  });
}

export function createMockRegionTask(overrides: Partial<InspectionTask> = {}): InspectionTask {
  return createMockInspectionTask({
    externalId: 'task-region-001',
    taskKind: 'region',
    inspectionType: 'ndt_thickness',
    targetElementExternalId: undefined,
    position3d: [1.1, 2.2, 3.3],
    normalVector: [0.0, 1.0, 0.0],
    radiusM: 0.3,
    ...overrides,
  });
}
