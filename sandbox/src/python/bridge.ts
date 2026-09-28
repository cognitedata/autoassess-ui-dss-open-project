import type { PlanJson } from '../domain/planJson';
import { parsePlanJson } from '../domain/planJson';
import type { Bounds, InspectionPlan, PlanStatus, SandboxSnapshot, Vec3 } from '../domain/types';
import { sampleTelemetry } from '../sim/playback';
import type { FlightOptions, MissionResult, Pose } from '../sim/simulator';
import { FlightRecorder, MissionError, preflightCheck } from '../sim/simulator';

/**
 * Functions exposed to Python as the `_sandbox_bridge` module. Everything crosses the boundary
 * as JSON strings (no PyProxy lifetimes to manage); errors come back as
 * {"error": "...", "errorKind": "..."} so Python can raise the matching exception.
 *
 * The `sim_*` functions drive the run's simulated drone one step at a time (Python's
 * `SimDrone`). Every step that changes the flight posts the flight so far to the UI, so a script
 * that crashes mid-flight still leaves its partial mission on screen.
 */
export interface SandboxBridge {
  snapshot_json(): string;
  preflight(planJson: string): string;
  sim_new(optionsJson: string): string;
  sim_load_plan(planJson: string): string;
  sim_takeoff(argsJson: string): string;
  sim_goto(poseJson: string): string;
  sim_inspect(argsJson: string): string;
  sim_return_home(): string;
  sim_land(): string;
  sim_state(): string;
  sim_report(): string;
  /** Simulated `plans.update_status`: patches the in-browser snapshot only. */
  update_plan_status(argsJson: string): string;
}

export interface BridgeDeps {
  getSnapshot: () => SandboxSnapshot;
  onMission: (mission: MissionResult) => void;
  /** A plan whose status was changed by a (simulated) update_status. Nothing is written to CDF. */
  onPlanPatch: (plan: InspectionPlan) => void;
}

export interface SandboxBridgeHandle {
  module: SandboxBridge;
  /** Fresh drone and no landed flights: called before every run. */
  resetRun(): void;
}

export type BridgeErrorKind = MissionError['kind'] | 'read-only';

/** Telemetry interval (simulated seconds) returned to Python. */
export const TELEMETRY_DT_S = 1;

class ReadOnlyError extends Error {}

export function createSandboxBridge({ getSnapshot, onMission, onPlanPatch }: BridgeDeps): SandboxBridgeHandle {
  let recorder = new FlightRecorder();
  let hasPlan = false;
  let planStatusAtStart: PlanStatus | null = null;
  const landedPlans = new Set<string>();

  const boundsFor = (plan: PlanJson): Bounds | null =>
    getSnapshot().areas.find((a) => a.externalId === plan.areaExternalId)?.bounds ?? null;

  /**
   * Runs one flight step, posts the updated mission (even if the step failed) and returns the
   * step result, the drone state and the events the step produced (also on failure, e.g. a
   * battery refusal or a skipped task).
   */
  const step = (fn: () => unknown): string => {
    const before = hasPlan ? recorder.eventCount : 0;
    const newEvents = () => (hasPlan ? recorder.snapshot().events.slice(before) : []);
    let reply: string;
    try {
      const result = fn();
      reply = JSON.stringify({ result, state: recorder.state(), events: newEvents() });
    } catch (err) {
      reply = errorJson(err, { events: newEvents() });
    }
    if (hasPlan) onMission({ ...recorder.snapshot(), planStatusAtStart });
    return reply;
  };

  const module: SandboxBridge = {
    snapshot_json: () => JSON.stringify(getSnapshot()),
    preflight: (planJson) =>
      guarded(() => {
        const plan = parsePlanJson(JSON.parse(planJson));
        return preflightCheck(plan, boundsFor(plan));
      }),
    sim_new: (optionsJson) =>
      guarded(() => {
        recorder.configure(parseFlightOptions(JSON.parse(optionsJson)));
        hasPlan = false;
        return recorder.state();
      }),
    sim_load_plan: (planJson) => {
      let plan: PlanJson;
      try {
        plan = parsePlanJson(JSON.parse(planJson));
      } catch (err) {
        return errorJson(err);
      }
      return step(() => {
        const issues = recorder.loadPlan(plan, boundsFor(plan));
        hasPlan = true;
        planStatusAtStart = getSnapshot().plans.find((p) => p.externalId === plan.planExternalId)?.status ?? null;
        return issues;
      });
    },
    sim_takeoff: (argsJson) =>
      step(() => {
        const height = asRecord(JSON.parse(argsJson))['heightM'];
        return typeof height === 'number' ? recorder.takeoff(height) : recorder.takeoff();
      }),
    sim_goto: (poseJson) => step(() => recorder.goto(parsePose(JSON.parse(poseJson)))),
    sim_inspect: (argsJson) =>
      step(() => {
        const args = asRecord(JSON.parse(argsJson));
        const taskId = args['taskId'];
        const seconds = args['seconds'];
        if (typeof taskId !== 'string') throw new MissionError('task_id must be a string');
        recorder.inspect(taskId, typeof seconds === 'number' ? seconds : undefined);
        return null;
      }),
    sim_return_home: () => step(() => recorder.returnHome()),
    sim_land: () =>
      step(() => {
        const pose = recorder.land();
        landedPlans.add(recorder.snapshot().planExternalId);
        return pose;
      }),
    sim_state: () => guarded(() => recorder.state()),
    sim_report: () =>
      guarded(() => {
        const mission = recorder.snapshot();
        return { mission, telemetry: sampleTelemetry(mission, TELEMETRY_DT_S) };
      }),
    update_plan_status: (argsJson) =>
      guarded(() => {
        const args = asRecord(JSON.parse(argsJson));
        const externalId = String(args['externalId']);
        const status = String(args['status']);
        const plan = getSnapshot().plans.find((p) => p.externalId === externalId && p.space === args['space']);
        if (!plan) throw new MissionError(`Plan '${externalId}' not found`);
        if (status !== 'Complete') {
          throw new ReadOnlyError(
            `plans.update_status(..., "${status}") writes to CDF and is disabled in the sandbox. ` +
              'Only "Complete" after a landed SimDrone flight of the plan is simulated.',
          );
        }
        if (!landedPlans.has(externalId)) {
          throw new ReadOnlyError(
            `plans.update_status() writes to CDF and is disabled in the sandbox. It is simulated only ` +
              `after SimDrone has flown plan '${externalId}' and landed in this run.`,
          );
        }
        const patched: InspectionPlan = { ...plan, status: 'Complete' };
        onPlanPatch(patched);
        return patched;
      }),
  };

  return {
    module,
    resetRun: () => {
      recorder = new FlightRecorder();
      hasPlan = false;
      landedPlans.clear();
    },
  };
}

function guarded(fn: () => unknown): string {
  try {
    return JSON.stringify(fn());
  } catch (err) {
    return errorJson(err);
  }
}

function errorJson(err: unknown, extra: Record<string, unknown> = {}): string {
  const kind: BridgeErrorKind =
    err instanceof MissionError ? err.kind : err instanceof ReadOnlyError ? 'read-only' : 'invalid';
  return JSON.stringify({ error: err instanceof Error ? err.message : String(err), errorKind: kind, ...extra });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function parsePose(value: unknown): Pose {
  const v = asRecord(value);
  const read = (key: keyof Pose, fallback?: number): number => {
    const n = v[key] ?? fallback;
    if (typeof n !== 'number') throw new MissionError(`pose.${key} must be a number`);
    return n;
  };
  return { x: read('x'), y: read('y'), z: read('z'), roll: read('roll', 0), pitch: read('pitch', 0), yaw: read('yaw', 0) };
}

export function parseFlightOptions(value: unknown): Partial<FlightOptions> {
  const v = asRecord(value);
  const out: Partial<FlightOptions> = {};
  if (typeof v['speedMps'] === 'number') out.speedMps = v['speedMps'];
  if (typeof v['maxFlightTimeS'] === 'number') out.maxFlightTimeS = v['maxFlightTimeS'];
  const home = v['home'];
  if (Array.isArray(home)) {
    if (home.length !== 3 || !home.every((n) => typeof n === 'number')) {
      throw new MissionError('home must be (x, y, z)');
    }
    out.home = home as Vec3;
  }
  return out;
}
