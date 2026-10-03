import { describe, expect, it } from 'vitest';

import { patchPlan } from './snapshotPatch';
import type { InspectionPlan, SandboxSnapshot } from './types';

describe(patchPlan.name, () => {
  it('should replace the plan with the same space and external id', () => {
    const snapshot = snapshotWith([plan('p1', 'Ready'), plan('p2', 'Ready')]);

    const patched = patchPlan(snapshot, plan('p2', 'Complete'));

    expect(patched.plans.map((p) => p.status)).toEqual(['Ready', 'Complete']);
  });

  it('should not mutate the original snapshot', () => {
    const snapshot = snapshotWith([plan('p1', 'Ready')]);

    patchPlan(snapshot, plan('p1', 'Complete'));

    expect(snapshot.plans[0].status).toBe('Ready');
  });

  it('should leave the snapshot unchanged for an unknown plan', () => {
    const snapshot = snapshotWith([plan('p1', 'Ready')]);

    expect(patchPlan(snapshot, plan('zzz', 'Complete'))).toBe(snapshot);
  });
});

function plan(externalId: string, status: InspectionPlan['status']): InspectionPlan {
  return { space: 's', externalId, areaExternalId: 'a', status, createdTime: 0, lastUpdatedTime: 0, name: null, description: null, mapExternalId: null };
}

function snapshotWith(plans: InspectionPlan[]): SandboxSnapshot {
  return { mode: 'demo', sourceLabel: 't', loadedAt: '', vessels: [], areas: [], plans, tasks: [], elements: [] };
}
