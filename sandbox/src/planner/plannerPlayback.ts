import type { Vec3 } from '../domain/types';
import type { InspectionViewpoint, PlannerIteration, PlannerMode, PlannerProgress, PlannerResult } from './types';

/** The simulated planner's state at a playback time (for the UI). Pure. */
export interface PlannerSample {
  t: number;
  mode: PlannerMode;
  /** The latest planning iteration at or before t (its graph and best path), null before the first. */
  iteration: PlannerIteration | null;
  exploredPct: number;
  coveragePct: number;
  timeRemainingS: number;
  /** 1-based compartment the BWT flow was working on at t (1 when not sequencing). */
  compartment: number;
  /** Compartments in the BWT sequence (1 when not sequencing). */
  compartments: number;
  /** Inspection viewpoints planned by t. */
  viewpoints: InspectionViewpoint[];
  /** Plan tasks the inspection camera had covered by t. */
  coveredTaskIds: Set<string>;
  /** Orders of the viewpoints the drone had reached by t (needs the arrivals). */
  reachedViewpoints: Set<number>;
}

/** A drone this close (m) to a planned inspection viewpoint is taken to hover at it. */
const AT_VIEWPOINT_M = 0.05;

/** `arrivals`: per viewpoint (same order as planner.viewpoints), see viewpointArrivals. */
export function samplePlanner(planner: PlannerResult, t: number, arrivals: readonly number[] = []): PlannerSample {
  const iteration = findLast(planner.timeline, (it) => it.t <= t) ?? null;
  const progress = interpolateProgress(planner.progress, t);
  return {
    t,
    mode: iteration?.mode ?? progress?.mode ?? 'idle',
    iteration,
    exploredPct: progress?.exploredPct ?? 0,
    coveragePct: progress?.coveragePct ?? 0,
    timeRemainingS: progress?.timeRemainingS ?? 0,
    compartment: progress?.compartment ?? 1,
    compartments: progress?.compartments ?? 1,
    viewpoints: planner.viewpoints.filter((v) => v.plannedAt <= t),
    coveredTaskIds: new Set(
      Object.entries(planner.coveredTasks)
        .filter(([, at]) => at <= t)
        .map(([id]) => id),
    ),
    reachedViewpoints: new Set(
      planner.viewpoints.filter((_, i) => (arrivals[i] ?? -1) >= 0 && arrivals[i] <= t).map((v) => v.order),
    ),
  };
}

/**
 * When the drone first got to each inspection viewpoint after it was planned (the end of a
 * flown segment there), -1 if it never did. Index-aligned with planner.viewpoints.
 */
export function viewpointArrivals(
  planner: PlannerResult,
  segments: ReadonlyArray<{ t1: number; to: Vec3 }>,
): number[] {
  return planner.viewpoints.map((v) => {
    const arrival = segments.find((s) => s.t1 >= v.plannedAt && distance(s.to, v.position) < AT_VIEWPOINT_M);
    return arrival ? arrival.t1 : -1;
  });
}

/** Camera pitch (radians, + up) at `position`: an inspection viewpoint's pitch, else level. */
export function cameraPitchAt(planner: PlannerResult, position: Vec3, t: number): number {
  const at = planner.viewpoints.find((v) => v.plannedAt <= t && distance(v.position, position) < AT_VIEWPOINT_M);
  return at?.pitch ?? 0;
}

/**
 * Progress records are taken after each flown path; between two records the values are
 * interpolated (the map grows while the drone flies). The mode is the earlier record's.
 */
function interpolateProgress(records: readonly PlannerProgress[], t: number): PlannerProgress | null {
  if (!records.length) return null;
  const nextIndex = records.findIndex((r) => r.t > t);
  if (nextIndex === 0) return records[0];
  if (nextIndex < 0) return records[records.length - 1];
  const a = records[nextIndex - 1];
  const b = records[nextIndex];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const lerp = (x: number, y: number) => Math.round((x + (y - x) * f) * 10) / 10;
  return {
    t,
    mode: a.mode,
    exploredPct: lerp(a.exploredPct, b.exploredPct),
    coveragePct: lerp(a.coveragePct, b.coveragePct),
    timeRemainingS: lerp(a.timeRemainingS, b.timeRemainingS),
    compartment: a.compartment,
    compartments: a.compartments,
  };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i])) return items[i];
  return undefined;
}
