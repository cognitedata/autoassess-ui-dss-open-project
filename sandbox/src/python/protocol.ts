import type { InspectionPlan, SandboxSnapshot } from '../domain/types';
import type { MissionResult } from '../sim/simulator';
import type { RunOutcome } from './session';

/** Messages main thread -> worker. */
export type ToWorker =
  | { type: 'init'; indexURL: string; snapshot: SandboxSnapshot }
  | { type: 'snapshot'; snapshot: SandboxSnapshot }
  | { type: 'run'; runId: number; code: string };

/** Messages worker -> main thread. */
export type FromWorker =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'stdout'; runId: number; text: string }
  | { type: 'stderr'; runId: number; text: string }
  | { type: 'mission'; runId: number; mission: MissionResult }
  /** Simulated plans.update_status: the main thread patches its snapshot (nothing goes to CDF). */
  | { type: 'snapshot-patch'; runId: number; plan: InspectionPlan }
  | { type: 'done'; runId: number; outcome: RunOutcome };
