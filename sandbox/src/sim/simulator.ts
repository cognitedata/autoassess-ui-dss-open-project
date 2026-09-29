import { containsPoint, defaultHome } from '../domain/bounds';
import type { PlanJson, PlanJsonTask } from '../domain/planJson';
import type { Bounds, InspectionType, PlanStatus, Vec3 } from '../domain/types';
import type { PlannerResult } from '../planner/types';

/**
 * Deterministic, purely kinematic drone simulator. No physics: the drone flies straight lines at
 * constant speed and hovers while it inspects. `FlightRecorder` is driven step by step (from
 * Python's `SimDrone` through the bridge): take off, go to a pose, inspect, return home, land.
 * Every step appends to a timeline the UI replays.
 */

export interface FlightOptions {
  /** Cruise speed in m/s. Confined-space drones are slow. */
  speedMps: number;
  /** Flight-time budget in seconds (battery), including the way back home. */
  maxFlightTimeS: number;
  /** Take-off/landing point. Null = the low -x end of the area bounds. */
  home: Vec3 | null;
}

export const DEFAULT_FLIGHT_OPTIONS: FlightOptions = {
  speedMps: 0.5,
  maxFlightTimeS: 900,
  home: null,
};

/** A drone pose: position in metres (area/map frame), attitude in radians. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  roll: number;
  pitch: number;
  /** Heading in the x-y plane, counter-clockwise from +x. */
  yaw: number;
}

export const INSPECTION_DURATION_S: Record<InspectionType, number> = {
  visual: 3,
  ndt_thickness: 8,
};

export const TAKEOFF_HEIGHT_M = 1;

export type IssueCode = 'no-pose' | 'out-of-bounds' | 'missing-normal' | 'not-in-order';

export interface PreflightIssue {
  taskId: string;
  severity: 'error' | 'warning';
  code: IssueCode;
  message: string;
}

export type Phase = 'takeoff' | 'transit' | 'inspect' | 'return' | 'land';

export interface MissionSegment {
  t0: number;
  t1: number;
  from: Vec3;
  to: Vec3;
  phase: Phase;
  /** Heading during the segment (the target pose's yaw for a leg). */
  yaw: number;
  /** The task this segment serves: legs flown towards it (en route) and its inspection. */
  taskId?: string;
}

export type MissionEventKind =
  | 'takeoff'
  | 'arrived'
  | 'inspected'
  | 'skipped'
  | 'battery-rth'
  | 'return'
  | 'landed';

export interface MissionEvent {
  t: number;
  kind: MissionEventKind;
  message: string;
  taskId?: string;
}

export type TaskStatus = 'pending' | 'visited' | 'skipped';

export interface MissionTaskResult {
  id: string;
  kind: PlanJsonTask['kind'];
  inspectionType: InspectionType;
  /** The surface point / element centre being inspected (null if the task has no pose). */
  target: Vec3 | null;
  /** Where the drone hovered while inspecting. */
  waypoint: Vec3 | null;
  status: TaskStatus;
  skipReason?: string;
  /** Simulated time the task was given up. */
  skippedAt?: number;
  /** Simulated time the inspection finished. */
  visitedAt?: number;
}

export interface MissionSummary {
  tasksTotal: number;
  visited: number;
  skipped: number;
  distanceM: number;
  durationS: number;
}

/** planned = plan loaded, still on the ground; in-flight = took off; landed = flight over. */
export type MissionStatus = 'planned' | 'in-flight' | 'landed';

export interface MissionResult {
  /** Increments for every plan loaded into the same recorder (one flight per plan load). */
  flightId: number;
  status: MissionStatus;
  planExternalId: string;
  planName: string | null;
  /** The plan's status in the sandbox data when the plan was loaded (set by the bridge). */
  planStatusAtStart?: PlanStatus | null;
  areaExternalId: string;
  areaName: string;
  bounds: Bounds | null;
  home: Vec3;
  options: FlightOptions;
  tasks: MissionTaskResult[];
  segments: MissionSegment[];
  events: MissionEvent[];
  summary: MissionSummary;
  /** The simulated gbplanner's map, graph and coverage, when a SimGbPlanner flew (set by the bridge). */
  planner?: PlannerResult;
}

export interface FlightState {
  pose: Pose;
  state: 'landed' | 'flying';
  flightTimeS: number;
  distanceM: number;
}

/**
 * invalid = bad input (Python ValueError), state = wrong drone state (RuntimeError),
 * battery = the step would leave too little battery to get home (BatteryLowError).
 */
export type MissionErrorKind = 'invalid' | 'state' | 'battery';

export class MissionError extends Error {
  override name = 'MissionError';

  constructor(
    message: string,
    readonly kind: MissionErrorKind = 'invalid',
  ) {
    super(message);
  }
}

/** Checks a plan before flight. Errors mean the task will be skipped; warnings are advisory. */
export function preflightCheck(plan: PlanJson, bounds: Bounds | null): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  for (const task of plan.tasks) {
    const target = taskTarget(task);
    if (!target) {
      issues.push({
        taskId: task.id,
        severity: 'error',
        code: 'no-pose',
        message:
          task.kind === 'element'
            ? 'element task has no targetElement centre'
            : 'region task has no position3d',
      });
      continue;
    }
    if (bounds && !containsPoint(bounds, target)) {
      issues.push({
        taskId: task.id,
        severity: 'error',
        code: 'out-of-bounds',
        message: `target ${formatVec(target)} is outside the area bounds`,
      });
    }
    if (task.kind === 'region' && !isUsableNormal(task.normalVector)) {
      issues.push({
        taskId: task.id,
        severity: 'warning',
        code: 'missing-normal',
        message: 'region task has no usable normalVector; approaching from above',
      });
    }
  }
  return issues;
}

export function taskTarget(task: PlanJsonTask): Vec3 | null {
  if (task.kind === 'element') return task.targetElement?.center ?? task.position3d ?? null;
  return task.position3d ?? null;
}

/**
 * Hover point for a task. Region tasks back off along the surface normal; element tasks have
 * no normal, so the drone stops `standoff` short of the element centre on its approach line.
 */
export function computeWaypoint(
  task: PlanJsonTask,
  target: Vec3,
  approachFrom: Vec3,
  standoffM: number,
): Vec3 {
  let dir: Vec3 | null = null;
  if (task.kind === 'region' && isUsableNormal(task.normalVector)) {
    dir = normalize(task.normalVector);
  } else if (task.kind === 'element') {
    const back = sub(approachFrom, target);
    dir = length(back) > 1e-9 ? normalize(back) : null;
  }
  dir ??= [0, 0, 1];
  return [target[0] + dir[0] * standoffM, target[1] + dir[1] * standoffM, target[2] + dir[2] * standoffM];
}

interface LoadedPlan {
  plan: PlanJson;
  bounds: Bounds | null;
  home: Vec3;
  blocking: Map<string, PreflightIssue>;
  tasks: Map<string, MissionTaskResult>;
}

/**
 * The simulated drone's flight log, built one command at a time. A real drone driver has the
 * same verbs (take off, go to a pose, inspect, return home, land); the recorder turns them into
 * timed segments and events for the UI and the Python report.
 */
export class FlightRecorder {
  private options: FlightOptions;
  private loaded: LoadedPlan | null = null;
  private flightId = 0;
  private status: MissionStatus = 'planned';
  private segments: MissionSegment[] = [];
  private events: MissionEvent[] = [];
  private time = 0;
  private flown = 0;
  private pose: Pose;
  private hoverHeightM = TAKEOFF_HEIGHT_M;
  private turnedBackForBattery = false;
  /** First segment flown since the last inspection (attributed to the next inspected task). */
  private legStart = 0;
  private eventLegStart = 0;
  private readonly landedPlans = new Set<string>();

  constructor(options: Partial<FlightOptions> = {}) {
    this.options = validateOptions({ ...DEFAULT_FLIGHT_OPTIONS, ...options });
    this.pose = poseAt(this.options.home ?? [0, 0, 0], 0);
  }

  /** New options for a fresh drone on the ground (the loaded plan is dropped). */
  configure(options: Partial<FlightOptions>): void {
    if (this.status === 'in-flight') throw new MissionError('The drone is flying; land() first', 'state');
    this.options = validateOptions({ ...DEFAULT_FLIGHT_OPTIONS, ...options });
    this.loaded = null;
    this.status = 'planned';
    this.segments = [];
    this.events = [];
    this.time = 0;
    this.flown = 0;
    this.pose = poseAt(this.options.home ?? [0, 0, 0], 0);
  }

  get eventCount(): number {
    return this.events.length;
  }

  /** Loads a plan for a new flight (drone on the ground at home). Returns the preflight issues. */
  loadPlan(plan: PlanJson, bounds: Bounds | null): PreflightIssue[] {
    if (this.loaded && this.status === 'in-flight') {
      throw new MissionError('The drone is flying; land() before loading another plan', 'state');
    }
    const issues = preflightCheck(plan, bounds);
    const blocking = new Map<string, PreflightIssue>();
    for (const issue of issues) {
      if (issue.severity === 'error' && !blocking.has(issue.taskId)) blocking.set(issue.taskId, issue);
    }
    const home = this.options.home ?? (bounds ? defaultHome(bounds) : ([0, 0, 0] as Vec3));
    this.loaded = {
      plan,
      bounds,
      home,
      blocking,
      tasks: new Map(
        plan.tasks.map((t) => [
          t.id,
          { id: t.id, kind: t.kind, inspectionType: t.inspectionType, target: taskTarget(t), waypoint: null, status: 'pending' },
        ]),
      ),
    };
    this.flightId += 1;
    this.status = 'planned';
    this.segments = [];
    this.events = [];
    this.time = 0;
    this.flown = 0;
    this.pose = poseAt(home, 0);
    this.turnedBackForBattery = false;
    this.legStart = 0;
    this.eventLegStart = 0;
    return issues;
  }

  takeoff(heightM: number = TAKEOFF_HEIGHT_M): Pose {
    const { home } = this.requirePlan('take off');
    if (this.status === 'in-flight') throw new MissionError('The drone is already flying', 'state');
    if (this.status === 'landed') {
      throw new MissionError('This flight has landed; call load_plan() again to fly another mission', 'state');
    }
    if (!(Number.isFinite(heightM) && heightM > 0)) throw new MissionError('takeoff height must be > 0 m');
    this.hoverHeightM = heightM;
    this.status = 'in-flight';
    this.event('takeoff', `Take-off from ${formatVec(home)}`);
    this.move([home[0], home[1], home[2] + heightM], this.pose.yaw, 'takeoff');
    return this.currentPose();
  }

  /** Flies a straight leg to `pose` and returns the reached pose. */
  goto(pose: Pose): Pose {
    this.requireFlying('goto');
    if (![pose.x, pose.y, pose.z, pose.roll, pose.pitch, pose.yaw].every(Number.isFinite)) {
      throw new MissionError('pose must have finite x, y, z, roll, pitch and yaw');
    }
    const to: Vec3 = [pose.x, pose.y, pose.z];
    const needed = this.time + (distance(this.position, to) + this.distanceHome(to)) / this.options.speedMps;
    if (needed > this.options.maxFlightTimeS) this.refuseForBattery(`the leg to ${formatVec(to)}`);
    this.move(to, pose.yaw, 'transit');
    this.pose = { ...pose };
    this.event('arrived', `Arrived at ${formatVec(to)}, yaw ${Math.round((pose.yaw * 180) / Math.PI)}°`);
    return this.currentPose();
  }

  /** Hovers at the current pose for the inspection and marks the task inspected. */
  inspect(taskId: string, seconds?: number): void {
    const loaded = this.requirePlan('inspect');
    this.requireFlying('inspect');
    const task = loaded.tasks.get(taskId);
    if (!task) throw new MissionError(`Unknown task id "${taskId}" (not in plan ${loaded.plan.planExternalId})`);
    const issue = loaded.blocking.get(taskId);
    if (issue) {
      this.skip(task, issue.message);
      throw new MissionError(`Task ${taskId} cannot be inspected: ${issue.message}`);
    }
    const duration = seconds ?? INSPECTION_DURATION_S[task.inspectionType];
    if (!(Number.isFinite(duration) && duration >= 0)) throw new MissionError('inspection seconds must be >= 0');
    if (this.time + duration + this.distanceHome(this.position) / this.options.speedMps > this.options.maxFlightTimeS) {
      this.refuseForBattery(`inspecting ${taskId}`);
    }
    for (let i = this.legStart; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (s.phase === 'transit' && !s.taskId) this.segments[i] = { ...s, taskId };
    }
    for (let i = this.eventLegStart; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.kind === 'arrived' && !e.taskId) this.events[i] = { ...e, taskId };
    }
    this.hold(duration, 'inspect', taskId);
    task.status = 'visited';
    task.visitedAt = round(this.time, 3);
    task.waypoint = this.position;
    delete task.skipReason;
    delete task.skippedAt;
    this.event('inspected', `Inspected ${taskId} (${task.inspectionType}, ${round(duration, 1)} s)`, taskId);
    this.legStart = this.segments.length;
    this.eventLegStart = this.events.length;
  }

  /** Flies back to the hover point above home (at take-off height). */
  returnHome(): Pose {
    const { home } = this.requirePlan('return home');
    this.requireFlying('return home');
    this.event('return', 'Returning home');
    this.move([home[0], home[1], home[2] + this.hoverHeightM], this.pose.yaw, 'return');
    return this.currentPose();
  }

  /** Descends to the ground (home height). Tasks not inspected by now count as skipped. */
  land(): Pose {
    const loaded = this.requirePlan('land');
    this.requireFlying('land');
    const p = this.position;
    this.move([p[0], p[1], loaded.home[2]], this.pose.yaw, 'land');
    for (const task of loaded.tasks.values()) {
      if (task.status !== 'pending') continue;
      const reason =
        loaded.blocking.get(task.id)?.message ??
        (this.turnedBackForBattery ? 'battery reserve reached' : 'not inspected');
      this.skip(task, reason);
    }
    this.status = 'landed';
    this.landedPlans.add(loaded.plan.planExternalId);
    this.event('landed', 'Landed');
    return this.currentPose();
  }

  /** True once a flight of this plan has landed in this recorder. */
  hasLanded(planExternalId: string): boolean {
    return this.landedPlans.has(planExternalId);
  }

  state(): FlightState {
    return {
      pose: this.currentPose(),
      state: this.status === 'in-flight' ? 'flying' : 'landed',
      flightTimeS: round(this.time, 3),
      distanceM: round(this.flown, 3),
    };
  }

  /** The flight so far (partial while flying). */
  snapshot(): MissionResult {
    const loaded = this.requirePlan('report');
    const tasks = loaded.plan.tasks
      .map((t) => loaded.tasks.get(t.id))
      .filter((t): t is MissionTaskResult => t !== undefined)
      .map((t) => ({ ...t }));
    const visited = tasks.filter((t) => t.status === 'visited').length;
    const skipped = tasks.filter((t) => t.status === 'skipped').length;
    return {
      flightId: this.flightId,
      status: this.status,
      planExternalId: loaded.plan.planExternalId,
      planName: loaded.plan.name,
      areaExternalId: loaded.plan.areaExternalId,
      areaName: loaded.plan.areaName,
      bounds: loaded.bounds,
      home: loaded.home,
      options: { ...this.options, home: loaded.home },
      tasks,
      segments: [...this.segments],
      events: [...this.events],
      summary: {
        tasksTotal: tasks.length,
        visited,
        skipped,
        distanceM: round(this.flown, 3),
        durationS: round(this.time, 3),
      },
    };
  }

  private get position(): Vec3 {
    return [this.pose.x, this.pose.y, this.pose.z];
  }

  private currentPose(): Pose {
    return { ...this.pose };
  }

  private requirePlan(action: string): LoadedPlan {
    if (!this.loaded) throw new MissionError(`Cannot ${action}: no plan loaded (call load_plan(plan) first)`, 'state');
    return this.loaded;
  }

  private requireFlying(action: string): void {
    this.requirePlan(action);
    if (this.status !== 'in-flight') {
      throw new MissionError(`Cannot ${action}: the drone is not flying (call takeoff() first)`, 'state');
    }
  }

  /** Metres from `from` back to the ground at home: to the hover point, then straight down. */
  private distanceHome(from: Vec3): number {
    const home = this.loaded?.home ?? ([0, 0, 0] as Vec3);
    return distance(from, [home[0], home[1], home[2] + this.hoverHeightM]) + this.hoverHeightM;
  }

  private refuseForBattery(what: string): never {
    this.turnedBackForBattery = true;
    this.event('battery-rth', `Battery reserve reached before ${what}; return home`);
    throw new MissionError(
      `Not enough battery for ${what} and the way home (budget ${this.options.maxFlightTimeS} s)`,
      'battery',
    );
  }

  private skip(task: MissionTaskResult, reason: string): void {
    task.status = 'skipped';
    task.skipReason = reason;
    task.skippedAt = round(this.time, 3);
    this.event('skipped', `Skipped ${task.id}: ${reason}`, task.id);
  }

  private move(to: Vec3, yaw: number, phase: Phase, taskId?: string): void {
    const from = this.position;
    const d = distance(from, to);
    const dt = d / this.options.speedMps;
    this.push({ t0: this.time, t1: this.time + dt, from, to, phase, yaw }, taskId);
    this.flown += d;
    this.time += dt;
    this.pose = { ...this.pose, x: to[0], y: to[1], z: to[2], yaw };
  }

  private hold(seconds: number, phase: Phase, taskId?: string): void {
    const p = this.position;
    this.push({ t0: this.time, t1: this.time + seconds, from: p, to: p, phase, yaw: this.pose.yaw }, taskId);
    this.time += seconds;
  }

  private push(segment: MissionSegment, taskId?: string): void {
    this.segments.push(taskId ? { ...segment, taskId } : segment);
  }

  private event(kind: MissionEventKind, message: string, taskId?: string): void {
    this.events.push({ t: round(this.time, 3), kind, message, ...(taskId ? { taskId } : {}) });
  }
}

function validateOptions(options: FlightOptions): FlightOptions {
  if (!(Number.isFinite(options.speedMps) && options.speedMps > 0)) throw new MissionError('speed must be > 0 m/s');
  if (!(options.maxFlightTimeS > 0)) throw new MissionError('max flight time must be > 0 s');
  const { home } = options;
  if (home !== null && !(home.length === 3 && home.every(Number.isFinite))) {
    throw new MissionError('home must be (x, y, z)');
  }
  return { ...options, home: home ? [home[0], home[1], home[2]] : null };
}

function poseAt(p: Vec3, yaw: number): Pose {
  return { x: p[0], y: p[1], z: p[2], roll: 0, pitch: 0, yaw };
}

function isUsableNormal(n: Vec3 | undefined): n is Vec3 {
  return n !== undefined && length(n) > 1e-9;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const l = length(v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function formatVec(v: Vec3): string {
  return `(${v.map((x) => x.toFixed(2)).join(', ')})`;
}

