import type { Vec3 } from '../domain/types';
import type { MissionEvent, MissionResult, MissionTaskResult, Phase } from './simulator';

export interface MissionSample {
  t: number;
  position: Vec3;
  /** Heading (radians, counter-clockwise from +x). */
  yaw: number;
  phase: Phase | 'done';
  activeTaskId: string | null;
  visitedTaskIds: Set<string>;
  events: MissionEvent[];
  done: boolean;
}

/** The drone state at simulated time `t` (clamped to the mission). Pure; used by the UI replay. */
export function sampleMission(mission: MissionResult, t: number): MissionSample {
  const duration = mission.summary.durationS;
  const time = Math.min(Math.max(t, 0), duration);
  const segment =
    mission.segments.find((s) => time >= s.t0 && time < s.t1) ??
    mission.segments[mission.segments.length - 1];
  const done = time >= duration;

  let position: Vec3 = mission.home;
  if (segment) {
    const span = segment.t1 - segment.t0;
    const f = span > 0 ? Math.min(Math.max((time - segment.t0) / span, 0), 1) : 1;
    position = lerp(segment.from, segment.to, done ? 1 : f);
  }

  const visitedTaskIds = new Set(
    mission.tasks
      .filter((task) => task.visitedAt !== undefined && task.visitedAt <= time)
      .map((task) => task.id),
  );
  return {
    t: time,
    position,
    yaw: segment?.yaw ?? 0,
    phase: done ? 'done' : (segment?.phase ?? 'done'),
    activeTaskId: done ? null : (segment?.taskId ?? null),
    visitedTaskIds,
    events: mission.events.filter((e) => e.t <= time),
    done,
  };
}

export interface TelemetrySample {
  t: number;
  position: Vec3;
  phase: Phase | 'done';
}

/** Regularly spaced telemetry (every `dt` seconds, plus the final point) for the Python report. */
export function sampleTelemetry(mission: MissionResult, dt = 1): TelemetrySample[] {
  if (!(dt > 0)) throw new Error('dt must be > 0');
  const out: TelemetrySample[] = [];
  const duration = mission.summary.durationS;
  for (let t = 0; t < duration; t += dt) {
    const s = sampleMission(mission, t);
    out.push({ t: round3(t), position: s.position.map(round3) as Vec3, phase: s.phase });
  }
  const end = sampleMission(mission, duration);
  out.push({ t: round3(duration), position: end.position.map(round3) as Vec3, phase: 'done' });
  return out;
}

function lerp(a: Vec3, b: Vec3, f: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Metres flown by simulated time `t`. */
export function distanceAt(mission: MissionResult, t: number): number {
  let d = 0;
  for (const s of mission.segments) {
    if (s.t0 >= t) break;
    const len = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2]);
    const span = s.t1 - s.t0;
    d += span > 0 ? len * Math.min((t - s.t0) / span, 1) : len;
  }
  return d;
}

/** What a task is doing at the sampled moment, for the task list. */
export type TaskState = 'pending' | 'en-route' | 'inspecting' | 'inspected' | 'skipped' | 'covered';

/**
 * `coveredAt`: when a simulated gbplanner's inspection camera covered the task (it may never be
 * inspected with `sim_drone.inspect`); shown unless the drone inspects or works on the task.
 */
export function taskStateAt(task: MissionTaskResult, sample: MissionSample, coveredAt?: number): TaskState {
  if (task.visitedAt !== undefined && task.visitedAt <= sample.t) return 'inspected';
  const skipped = task.skippedAt !== undefined && task.skippedAt <= sample.t;
  if (sample.activeTaskId === task.id && !skipped) {
    if (sample.phase === 'inspect') return 'inspecting';
    if (sample.phase === 'transit') return 'en-route';
  }
  // Covered by the planner camera beats "skipped: not inspected" at landing.
  if (coveredAt !== undefined && coveredAt <= sample.t) return 'covered';
  if (skipped) return 'skipped';
  return 'pending';
}
