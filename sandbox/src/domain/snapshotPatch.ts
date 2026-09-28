import type { InspectionPlan, SandboxSnapshot } from './types';

/**
 * The snapshot with one plan replaced (matched by space + external id). Used for the sandbox's
 * simulated `plans.update_status`; the change lives only in the browser until the next reload.
 */
export function patchPlan(snapshot: SandboxSnapshot, plan: InspectionPlan): SandboxSnapshot {
  const index = snapshot.plans.findIndex((p) => p.space === plan.space && p.externalId === plan.externalId);
  if (index < 0) return snapshot;
  const plans = [...snapshot.plans];
  plans[index] = plan;
  return { ...snapshot, plans };
}
