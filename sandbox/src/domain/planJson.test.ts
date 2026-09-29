import { describe, expect, it } from 'vitest';

import { parsePlanJson, PlanJsonError } from './planJson';

describe(parsePlanJson.name, () => {
  it('should parse the plan.json shape written by the SDK download', () => {
    const plan = parsePlanJson(validPlan());

    expect(plan.planExternalId).toBe('plan-1');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].targetElement?.center).toEqual([4.17, 0.24, 0.84]);
    expect(plan.tasks[1]).toMatchObject({ kind: 'region', radiusM: 0.3, normalVector: [0, -1, 0] });
  });

  it('should default optional plan fields', () => {
    const plan = parsePlanJson({ planExternalId: 'p', areaExternalId: 'a', tasks: [] });

    expect(plan).toMatchObject({ name: null, areaName: '', mapExternalId: null, tasks: [] });
  });

  it('should reject a non-object plan', () => {
    expect(() => parsePlanJson('plan.json')).toThrow(PlanJsonError);
  });

  it('should reject a missing tasks list', () => {
    expect(() => parsePlanJson({ planExternalId: 'p', areaExternalId: 'a' })).toThrow(
      'plan.tasks must be a list',
    );
  });

  it('should report the path of an invalid task kind', () => {
    const plan = validPlan();
    plan.tasks[1].kind = 'hover';
    expect(() => parsePlanJson(plan)).toThrow('plan.tasks[1].kind');
  });

  it('should reject a malformed vector', () => {
    const plan = validPlan();
    plan.tasks[1].position3d = [1, 2];
    expect(() => parsePlanJson(plan)).toThrow('plan.tasks[1].position3d must be a list of 3 numbers');
  });

  it('should reject an unknown inspection type', () => {
    const plan = validPlan();
    plan.tasks[0].inspectionType = 'thermal';
    expect(() => parsePlanJson(plan)).toThrow('inspectionType');
  });
});

function validPlan(): {
  planExternalId: string;
  areaExternalId: string;
  tasks: Array<Record<string, unknown>>;
} {
  return {
    planExternalId: 'plan-1',
    areaExternalId: 'area-1',
    tasks: [
      {
        id: 't1',
        kind: 'element',
        inspectionType: 'visual',
        targetElement: { externalId: 'e1', type: 'longitudinal', center: [4.17, 0.24, 0.84] },
      },
      {
        id: 't2',
        kind: 'region',
        inspectionType: 'ndt_thickness',
        position3d: [2.2, 1.09, 0.92],
        normalVector: [0, -1, 0],
        radiusM: 0.3,
      },
    ],
  };
}
