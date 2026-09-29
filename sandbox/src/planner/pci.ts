import type { Bounds, Vec3 } from '../domain/types';
import type { FlightState, Pose } from '../sim/simulator';
import { MissionError } from '../sim/simulator';
import type { GbPlannerConfig } from './configs';
import { worldBox } from './grid';
import { planInspection } from './inspection';
import { angleWithinFov, createRng, dist, polylineLength, round, roundVec } from './math';
import { buildRrg, CollisionChecker, connectToGraph, Graph, mergeInto, pathTo, truncatePath } from './rrg';
import type { SyntheticTank, TankElement } from './syntheticTank';
import { buildSyntheticTank, initMotionPath } from './syntheticTank';
import type {
  CompartmentReport,
  InspectionViewpoint,
  PlannerIteration,
  PlannerMode,
  PlannerProgress,
  PlannerReport,
  PlannerResult,
} from './types';
import { OCCUPIED, VoxelMap } from './voxelMap';

/**
 * The simulated planner control interface (PCI) + planner: a small state machine that answers
 * gbplanner3's real service / topic names and mirrors its behaviour trees:
 *
 * - bwt_inspection: one compartment at a time, like the real BWT behaviour tree
 *   (le_insp_opening: SetNextCompartment -> explore -> inspect -> pass the opening -> repeat):
 *   exploration (local RRG, global repositioning) of the current compartment until exhausted,
 *   inspection of its mapped surfaces, then a target reach through the manhole to the next
 *   compartment; homing after the last one.
 * - WP (waypoint) operation mode: target reach, exploring towards the goal through unknown space.
 * - go_to_waypoint: along the global graph, known free space only.
 * - HomingCheck: goes home when the time remaining gets close to what homing needs.
 *
 * Every flown path is executed with the simulated drone's own `goto` (FlightRecorder), mapping
 * and inspecting every ~0.3 m along the way, so the animation and the map share one timeline.
 */

/** The parts of the simulated drone the planner drives (FlightRecorder implements it). */
export interface DroneLink {
  state(): FlightState;
  takeoff(heightM: number): Pose;
  goto(pose: Pose): Pose;
  returnHome(): Pose;
}

export interface PlannerTask {
  id: string;
  target: Vec3 | null;
  normal: Vec3 | null;
}

export interface GbPlannerSetup {
  drone: DroneLink;
  config: GbPlannerConfig;
  seed: number;
  /** Area bounds (null for an area without structural elements). */
  bounds: Bounds | null;
  elements: readonly TankElement[];
  home: Vec3;
  speedMps: number;
  maxFlightTimeS: number;
  tasks: readonly PlannerTask[];
}

export type TopicMessage =
  | { topic: '/gbplanner_path'; stamp: number; poses: Pose[] }
  | { topic: '/robot_status'; stamp: number; timeRemaining: number };

export interface StepOutput {
  messages: TopicMessage[];
  log: string[];
}
export interface CallOutput extends StepOutput {
  response: Record<string, unknown>;
}
export interface SpinOutput extends StepOutput {
  idle: boolean;
}

export const GBPLANNER_SERVICES = [
  'pci_initialization_trigger',
  'planner_control_interface/std_srvs/automatic_planning',
  'planner_control_interface/std_srvs/single_planning',
  'planner_control_interface/std_srvs/homing_trigger',
  'planner_control_interface/std_srvs/go_to_waypoint',
  'planner_control_interface/std_srvs/stop',
  'planner_control_interface/std_srvs/inspection_srv_trigger',
  'gbplanner/set_global_bound',
  'gbplanner/switch_operation_mode',
  'gbplanner/set_planning_trigger_mode',
] as const;
export type GbPlannerService = (typeof GBPLANNER_SERVICES)[number];

/** Topics a script publishes to (the planner subscribes). */
export const GBPLANNER_INPUT_TOPICS = ['/move_base_simple/goal', '/robot_status', 'planner_control_interface/stop_request'] as const;
/** Topics the planner / robot publish (a script subscribes). */
export const GBPLANNER_OUTPUT_TOPICS = ['/gbplanner_path', '/robot_status'] as const;

/** Extra seconds kept in hand when deciding to go home. */
const HOMING_MARGIN_S = 10;
const HOMING_FACTOR = 1.2;
/** Exploration iterations before the sim calls it exhausted regardless (safety net). */
const MAX_EXPLORATION_ITERATIONS = 150;
const FRONTIERS_EVALUATED = 30;
const TIMELINE_MAX_VERTICES = 150;
const TIMELINE_MAX_EDGES = 400;
/** How far past the manhole the pass-opening target reach aims (m). */
const PASS_BEYOND_M = 0.6;
/** Sampling slack around the current compartment's slab, so the frame and opening get mapped. */
const COMPARTMENT_MARGIN_M = 0.45;
/** A frame closer than this to the global bound's x faces doesn't split off a compartment. */
const FRAME_END_MIN_M = 0.5;

interface CompartmentState {
  /** Slabs of the global bound between the tank's transverse frames, ordered along x. */
  slabs: Bounds[];
  /** Visit order (indices into slabs): from the start compartment to one end, then the rest. */
  sequence: number[];
  /** Position in `sequence`. */
  pos: number;
}

interface Chunk {
  poses: Pose[];
  onDone?: () => void;
}

class Collector implements StepOutput {
  readonly messages: TopicMessage[] = [];
  readonly log: string[] = [];
}

export function normalizeRosName(name: string): string {
  return name.replace(/^\/+/, '');
}

export class GbPlannerSim {
  readonly tank: SyntheticTank;
  private readonly map: VoxelMap;
  private readonly graph: Graph;
  private readonly rng: () => number;
  private readonly world: Bounds;
  private readonly half: number;
  private globalBound: Bounds;
  private root: number | null = null;
  private modeValue: PlannerMode = 'idle';
  private iterationsLeft = 0;
  private waypointMode = false;
  private goal: Pose | null = null;
  private goalBest = Infinity;
  private goalStall = 0;
  private afterInspection: 'homing' | 'idle' = 'homing';
  private comps: CompartmentState | null = null;
  private passing = false;
  private planned = false;
  private queue: Chunk[] = [];
  private iterations = 0;
  private explorationIterations = 0;
  private readonly frontiers = new Set<number>();
  private userTimeRemaining: { value: number; at: number } | null = null;
  private readonly timeline: PlannerIteration[] = [];
  private readonly progress: PlannerProgress[] = [];
  private readonly viewpoints: InspectionViewpoint[] = [];
  private readonly covered = new Map<string, number>();
  private out = new Collector();

  constructor(private readonly setup: GbPlannerSetup) {
    const { config, bounds, elements, home, tasks, seed } = setup;
    this.rng = createRng(seed);
    this.half = config.robotSize[0] / 2;
    const targets = tasks.map((t) => t.target).filter((t): t is Vec3 => t !== null);
    this.world = worldBox(bounds, [home, ...targets]);
    this.globalBound = this.world;
    this.tank = buildSyntheticTank(this.world, elements, { home, initMotion: config.initMotion });
    this.map = new VoxelMap(this.tank.grid, this.tank.occupied);
    this.graph = new Graph(config.nearestRangeM);
  }

  get mode(): PlannerMode {
    return this.modeValue;
  }

  // --- ROS interface ----------------------------------------------------------------------

  call(service: string, request: Record<string, unknown>): CallOutput {
    const name = normalizeRosName(service) as GbPlannerService;
    if (!(GBPLANNER_SERVICES as readonly string[]).includes(name)) {
      throw new Error(`Unknown service '${service}'. Supported services: ${GBPLANNER_SERVICES.join(', ')}`);
    }
    this.out = new Collector();
    const response = this.handleService(name, request);
    return { response, ...this.flush() };
  }

  publish(topic: string, msg: Record<string, unknown>): StepOutput {
    const name = normalizeRosName(topic);
    this.out = new Collector();
    if (name === 'move_base_simple/goal') this.setGoal(parsePose(msg['pose']));
    else if (name === 'robot_status') {
      const value = Number(msg['timeRemaining']);
      if (!Number.isFinite(value)) throw new Error('RobotStatus.time_remaining must be a number');
      this.userTimeRemaining = { value, at: this.now() };
    } else if (name === 'planner_control_interface/stop_request') {
      if (msg['data'] === true) this.stop('stop_request');
    } else {
      throw new Error(`Unknown topic '${topic}'. Topics you can publish: ${GBPLANNER_INPUT_TOPICS.join(', ')}`);
    }
    return this.flush();
  }

  /** One PCI step: plan if nothing is queued, then fly the next chunk. */
  spinStep(untilS: number | null): SpinOutput {
    this.out = new Collector();
    const idle = this.step(untilS);
    this.out.messages.push({ topic: '/robot_status', stamp: round(this.now(), 3), timeRemaining: round(this.timeRemaining(), 2) });
    return { idle, ...this.flush() };
  }

  report(): PlannerReport {
    const stats = this.map.stats(this.globalBound);
    const st = this.setup.drone.state();
    const [nx, ny, nz] = this.tank.grid.dims;
    return {
      config: this.setup.config.name,
      mode: this.modeValue,
      iterations: this.iterations,
      exploredPct: round(stats.exploredPct, 1),
      surfaceCoveragePct: round(stats.coveragePct, 1),
      distanceM: st.distanceM,
      durationS: st.flightTimeS,
      viewpoints: this.viewpoints.length,
      coveredTasks: Object.fromEntries(this.covered),
      uncoveredTasks: this.setup.tasks.filter((t) => t.target && !this.covered.has(t.id)).map((t) => t.id),
      voxelResolutionM: this.tank.grid.resolution,
      voxels: nx * ny * nz,
      syntheticTank: this.tank.description,
      compartments: this.compartmentReports(),
    };
  }

  private compartmentReports(): CompartmentReport[] {
    if (!this.comps) return [];
    return this.comps.slabs.map((slab, i) => {
      const stats = this.map.stats(clipBounds(this.globalBound, slab));
      return {
        index: i + 1,
        xMin: round(slab.min[0], 2),
        xMax: round(slab.max[0], 2),
        exploredPct: round(stats.exploredPct, 1),
        coveragePct: round(stats.coveragePct, 1),
      };
    });
  }

  result(): PlannerResult {
    const { camera } = this.setup.config;
    return {
      config: this.setup.config.name,
      globalBound: { min: [...this.globalBound.min], max: [...this.globalBound.max] },
      timeline: [...this.timeline],
      progress: [...this.progress],
      viewpoints: [...this.viewpoints],
      coveredTasks: Object.fromEntries(this.covered),
      map: this.map.toPlannerMap(),
      sensors: { cameraHFovRad: camera.hFovRad, cameraVFovRad: camera.vFovRad, cameraMaxRangeM: camera.maxRangeM },
    };
  }

  // --- services ---------------------------------------------------------------------------

  private handleService(name: GbPlannerService, request: Record<string, unknown>): Record<string, unknown> {
    switch (name) {
      case 'pci_initialization_trigger':
        return { success: this.initialize() };
      case 'planner_control_interface/std_srvs/automatic_planning':
      case 'planner_control_interface/std_srvs/single_planning': {
        const refusal = this.ensureInitialized();
        if (refusal) return { success: false, message: refusal };
        this.iterationsLeft = name.endsWith('automatic_planning') ? Infinity : 1;
        if (this.modeValue === 'idle' || this.modeValue === 'exploration' || this.modeValue === 'target-reach') {
          this.setMode(this.waypointMode ? 'target-reach' : 'exploration');
          this.afterInspection = 'homing';
          if (this.modeValue === 'exploration' && this.setup.config.inspectAfterExploration) this.initCompartments();
        }
        return { success: true, message: '' };
      }
      case 'planner_control_interface/std_srvs/homing_trigger': {
        const refusal = this.ensureInitialized();
        if (refusal) return { success: false, message: refusal };
        this.queue = [];
        this.setMode('homing');
        return { success: true, message: '' };
      }
      case 'planner_control_interface/std_srvs/go_to_waypoint':
        return this.goToWaypoint();
      case 'planner_control_interface/std_srvs/stop':
        this.stop(name);
        return { success: true, message: '' };
      case 'planner_control_interface/std_srvs/inspection_srv_trigger': {
        const refusal = this.ensureInitialized();
        if (refusal) return { success: false, message: refusal };
        this.queue = [];
        this.afterInspection = 'idle';
        this.setMode('inspection');
        return { success: true, message: '' };
      }
      case 'gbplanner/set_global_bound':
        return this.setGlobalBound(request);
      case 'gbplanner/switch_operation_mode': {
        this.waypointMode = request['data'] === true;
        if (this.modeValue === 'exploration' && this.waypointMode) this.setMode('target-reach');
        else if (this.modeValue === 'target-reach' && !this.waypointMode) this.setMode('exploration');
        this.log(`Operation mode: ${this.waypointMode ? 'WP (target reach)' : 'EXP (exploration)'}`);
        return { success: true, message: this.waypointMode ? 'WP' : 'EXP' };
      }
      case 'gbplanner/set_planning_trigger_mode': {
        const auto = Number(request['planningMode']) === 1;
        this.iterationsLeft = auto ? Infinity : 0;
        return { success: true };
      }
    }
  }

  private initialize(): boolean {
    const { drone, config, home } = this.setup;
    let st = drone.state();
    try {
      if (st.state === 'landed') {
        drone.takeoff(config.initMotion.zTakeoffM);
        st = drone.state();
      }
      const start = position(st.pose);
      this.scanAt(start, st.pose.yaw, 0, st.flightTimeS);
      if (this.root === null) {
        const [, up, forward] = initMotionPath(this.world, home, config.initMotion);
        const nearHome = dist(start, up) < 0.05;
        const target = nearHome ? forward : start;
        if (nearHome) {
          this.fly([{ x: target[0], y: target[1], z: target[2], roll: 0, pitch: 0, yaw: Math.atan2(forward[1] - up[1], forward[0] - up[0]) }]);
        }
        this.map.markFree(target, this.half + 0.1, this.now());
        this.root = this.graph.addVertex(target);
      }
      this.log(`Initialization done: ${this.tank.description}`);
      this.record();
      return true;
    } catch (err) {
      this.log(`Initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Planning needs a flying robot and a graph root. Returns a refusal message or null. */
  private ensureInitialized(): string | null {
    const st = this.setup.drone.state();
    if (st.state !== 'flying') return 'The robot is not flying: call pci_initialization_trigger first';
    if (this.root === null) {
      const p = position(st.pose);
      this.map.markFree(p, this.half, this.now());
      this.root = this.graph.addVertex(p);
    }
    return null;
  }

  private goToWaypoint(): Record<string, unknown> {
    const refusal = this.ensureInitialized();
    if (refusal) return { success: false, message: refusal };
    if (!this.goal) return { success: false, message: 'No waypoint: publish a PoseStamped on /move_base_simple/goal first' };
    const goal = this.goal;
    const checker = new CollisionChecker(this.map, this.half);
    const here = this.currentVertex(checker);
    const target = checker.pointFree(position(goal))
      ? connectToGraph(this.graph, position(goal), this.setup.config.nearestRangeM, checker)
      : null;
    const path = here !== null && target !== null ? pathTo(this.graph.dijkstra(here).prev, target, here) : [];
    if (!path.length) {
      const message =
        'No path to the waypoint through known free space (go_to_waypoint follows the global graph; ' +
        'switch to WP mode with gbplanner/switch_operation_mode for target reach through unknown space)';
      this.log(message);
      return { success: false, message };
    }
    this.queue = [];
    this.setMode('waypoint');
    const poses = this.posesAlong(path.map((v) => this.graph.positions[v]), goal);
    this.publishPath('waypoint', poses, null);
    this.queue.push({ poses, onDone: () => this.finish('Waypoint reached') });
    return { success: true, message: '' };
  }

  private setGlobalBound(request: Record<string, unknown>): Record<string, unknown> {
    const current = () => ({ useZVal: true, min: roundVec(this.globalBound.min), max: roundVec(this.globalBound.max) });
    if (request['getCurrentBound'] === true) return { success: true, boundRet: current() };
    if (request['resetToDefault'] === true) {
      this.globalBound = this.world;
      this.map.setBound(null);
      this.comps = null;
      return { success: true, boundRet: current() };
    }
    const bound = asRecord(request['bound']);
    const lo = parseVec(bound['min']);
    const hi = parseVec(bound['max']);
    const useZ = bound['useZVal'] === true;
    if (!lo || !hi) return { success: false, boundRet: current() };
    const min: Vec3 = [lo[0], lo[1], useZ ? lo[2] : this.globalBound.min[2]];
    const max: Vec3 = [hi[0], hi[1], useZ ? hi[2] : this.globalBound.max[2]];
    for (let a = 0; a < 3; a++) {
      min[a] = Math.max(min[a], this.world.min[a]);
      max[a] = Math.min(max[a], this.world.max[a]);
      if (!(max[a] - min[a] > this.half * 2)) return { success: false, boundRet: current() };
    }
    this.globalBound = { min, max };
    this.map.setBound(this.globalBound);
    this.comps = null;
    this.log(`Global bound set to ${fmt(min)} – ${fmt(max)}`);
    return { success: true, boundRet: current() };
  }

  private setGoal(pose: Pose): void {
    this.goal = pose;
    this.goalBest = Infinity;
    this.goalStall = 0;
    this.log(`New goal ${fmt(position(pose))}`);
    if (this.waypointMode && this.iterationsLeft > 0 && this.root !== null) {
      this.queue = [];
      this.setMode('target-reach');
    }
  }

  // --- compartments (BWT SetNextCompartment) ---------------------------------------------

  /** Slabs of the global bound between the tank's frames; visit order starts where the robot is. */
  private initCompartments(): void {
    if (this.comps) return;
    const gb = this.globalBound;
    const frames = this.tank.frames.filter((x) => x - gb.min[0] > FRAME_END_MIN_M && gb.max[0] - x > FRAME_END_MIN_M);
    const edges = [gb.min[0], ...frames, gb.max[0]];
    const slabs: Bounds[] = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      slabs.push({ min: [edges[i], gb.min[1], gb.min[2]], max: [edges[i + 1], gb.max[1], gb.max[2]] });
    }
    const x = this.here()[0];
    let start = slabs.findIndex((s) => x >= s.min[0] && x <= s.max[0]);
    if (start < 0) start = x < slabs[0].min[0] ? 0 : slabs.length - 1;
    const up = slabs.map((_, i) => i).slice(start);
    const down = slabs.map((_, i) => i).slice(0, start).reverse();
    this.comps = { slabs, sequence: [...up, ...down], pos: 0 };
    if (slabs.length > 1) {
      this.log(
        `Compartments: ${slabs.length} (frames at x = ${frames.map((f) => f.toFixed(2)).join(', ')}), ` +
          `starting in compartment 1/${slabs.length} (x ${slabs[start].min[0].toFixed(2)} – ${slabs[start].max[0].toFixed(2)})`,
      );
    }
  }

  private currentSlab(): Bounds | null {
    return this.comps ? this.comps.slabs[this.comps.sequence[this.comps.pos]] : null;
  }

  /** Inspection of the current compartment is done: target reach through its manhole. */
  private startPass(): boolean {
    const c = this.comps;
    if (!c || c.pos >= c.sequence.length - 1) return false;
    const cur = c.slabs[c.sequence[c.pos]];
    const next = c.slabs[c.sequence[c.pos + 1]];
    const dir = Math.sign((next.min[0] + next.max[0]) / 2 - (cur.min[0] + cur.max[0]) / 2) || 1;
    const frameX = dir > 0 ? cur.max[0] : cur.min[0];
    const here = this.here();
    const openings = this.tank.openings
      .filter((o) => Math.abs(o.center[0] - frameX) < 0.1)
      .filter((o) => o.center.every((v, a) => v >= this.globalBound.min[a] && v <= this.globalBound.max[a]));
    const target: Vec3 = openings.length
      ? openings.reduce((best, o) => (dist(o.center, here) < dist(best.center, here) ? o : best)).center
      : [frameX, (cur.min[1] + cur.max[1]) / 2, (cur.min[2] + cur.max[2]) / 2];
    const beyond: Vec3 = [target[0] + dir * PASS_BEYOND_M, target[1], target[2]];
    this.passing = true;
    this.goal = { x: beyond[0], y: beyond[1], z: beyond[2], roll: 0, pitch: 0, yaw: dir > 0 ? 0 : Math.PI };
    this.goalBest = Infinity;
    this.goalStall = 0;
    this.log(
      `Compartment ${c.pos + 1}/${c.sequence.length} done: passing the manhole at ${fmt(target)} ` +
        `to compartment ${c.pos + 2}/${c.sequence.length}`,
    );
    this.setMode('target-reach');
    return true;
  }

  private completePass(): void {
    const c = this.comps;
    this.passing = false;
    if (!c) return;
    c.pos++;
    this.explorationIterations = 0;
    this.log(`Compartment ${c.pos + 1}/${c.sequence.length}: exploring`);
    this.record();
    this.setMode('exploration');
  }

  private stop(source: string): void {
    this.queue = [];
    this.iterationsLeft = 0;
    this.goal = null;
    this.setMode('idle');
    this.log(`Stopped (${source})`);
  }

  // --- the PCI loop -----------------------------------------------------------------------

  private step(untilS: number | null): boolean {
    const st = this.setup.drone.state();
    if (st.state !== 'flying') {
      if (this.modeValue !== 'idle') this.setMode('idle');
      return true;
    }
    if (untilS !== null && st.flightTimeS >= untilS) return true;
    try {
      if (!this.queue.length) this.plan();
      const chunk = this.queue.shift();
      if (chunk) {
        if (this.modeValue !== 'homing' && this.lowBattery(chunk.poses)) {
          this.startHoming();
          return false;
        }
        this.fly(chunk.poses);
        chunk.onDone?.();
        this.record();
      }
    } catch (err) {
      if (!(err instanceof MissionError)) throw err;
      if (err.kind === 'battery' && this.modeValue !== 'homing') {
        this.log(`Battery: ${err.message}`);
        this.startHoming();
        return false;
      }
      this.log(`Flight stopped: ${err.message}`);
      this.queue = [];
      this.setMode('idle');
    }
    return this.modeValue === 'idle' || (this.modeValue === 'target-reach' && !this.goal && !this.queue.length);
  }

  private plan(): void {
    switch (this.modeValue) {
      case 'exploration':
        return this.planExploration();
      case 'target-reach':
        return this.planTargetReach();
      case 'inspection':
        return this.planInspectionTour();
      case 'homing':
        return this.planHoming();
      case 'waypoint':
        return this.finish('Waypoint reached');
      case 'idle':
      case 'initialization':
        return;
    }
  }

  private planExploration(): void {
    if (this.iterationsLeft <= 0) return this.setMode('idle');
    const { config } = this.setup;
    const t = this.now();
    const here = this.here();
    const checker = new CollisionChecker(this.map, this.half);
    this.map.markFree(here, this.half, t);
    const rrg = buildRrg({
      map: this.map,
      checker,
      root: here,
      sampleBox: this.sampleBox(here, this.currentSlab()),
      config,
      rng: this.rng,
      bias: this.openings(),
    });
    const mapping = mergeInto(this.graph, rrg.graph, config.sim.globalMergeRadiusM, checker);
    rrg.gains.forEach((g, v) => {
      if (v > 0 && g >= rrg.gainThreshold) this.frontiers.add(mapping[v]);
    });
    this.explorationIterations++;

    let points: Vec3[] | null = null;
    let what = '';
    if (!rrg.exhausted && this.explorationIterations <= MAX_EXPLORATION_ITERATIONS) {
      points = truncatePath(rrg.bestPath.map((v) => rrg.graph.positions[v]), config.traverseLengthMaxM);
      what = `gain ${rrg.bestGain} unknown voxels`;
    } else {
      points = this.repositioningPath(checker);
      if (points) what = `local exploration exhausted: repositioning to a frontier ${polylineLength(points).toFixed(1)} m away`;
    }
    if (!points || points.length < 2) {
      const stats = this.map.stats(this.globalBound);
      this.log(`Exploration exhausted after ${this.explorationIterations} iterations (explored ${stats.exploredPct.toFixed(0)}%)`);
      this.record();
      if (config.inspectAfterExploration) return this.setMode('inspection');
      if (config.goHomeWhenExplored) return this.setMode('homing');
      return this.setMode('idle');
    }
    const poses = this.posesAlong(points, null);
    if (this.lowBattery(poses)) return this.startHoming();
    this.forgetFrontiersNear(points[points.length - 1]);
    this.publishPath('exploration', poses, rrg.graph, t);
    this.log(`Iteration ${this.iterations}: ${what}`);
    this.iterationsLeft--;
    this.queue.push({ poses, onDone: this.iterationsLeft <= 0 ? () => this.setMode('idle') : undefined });
  }

  private planTargetReach(): void {
    const goal = this.goal;
    if (!goal) return;
    const { config } = this.setup;
    const g = position(goal);
    if (!g.every((v, a) => v >= this.globalBound.min[a] && v <= this.globalBound.max[a])) {
      return this.giveUp('the goal is outside the global bound');
    }
    if (this.boxHasKnownObstacle(g)) return this.giveUp('the goal is in collision with the mapped structure');
    const t = this.now();
    const here = this.here();
    const checker = new CollisionChecker(this.map, this.half);
    this.map.markFree(here, this.half, t);
    const rrg = buildRrg({
      map: this.map,
      checker,
      root: here,
      sampleBox: this.sampleBox(here),
      config,
      rng: this.rng,
      bias: this.openings(),
      goal: g,
    });
    mergeInto(this.graph, rrg.graph, config.sim.globalMergeRadiusM, checker);
    let points = rrg.bestPath.map((v) => rrg.graph.positions[v]);
    if (!rrg.reachesGoal) points = truncatePath(points, config.traverseLengthMaxM);
    const end = points[points.length - 1] ?? here;
    const remaining = dist(end, g);
    if (!rrg.reachesGoal) {
      if (remaining < this.goalBest - 0.1) {
        this.goalBest = remaining;
        this.goalStall = 0;
      } else if (++this.goalStall >= config.sim.targetReachPatience) {
        return this.giveUp(`no progress for ${this.goalStall} iterations (${remaining.toFixed(1)} m short)`);
      }
    }
    if (points.length < 2) return;
    const poses = this.posesAlong(points, rrg.reachesGoal ? goal : null);
    if (this.lowBattery(poses)) return this.startHoming();
    this.publishPath('target-reach', poses, rrg.graph, t);
    this.log(`Iteration ${this.iterations}: target reach, ${rrg.reachesGoal ? 'path to the goal' : `${remaining.toFixed(1)} m to go`}`);
    this.queue.push({
      poses,
      onDone: rrg.reachesGoal
        ? () => {
            this.goal = null;
            this.log(`Target reached ${fmt(g)}`);
            if (this.passing) this.completePass();
          }
        : undefined,
    });
  }

  private planInspectionTour(): void {
    if (this.planned) {
      this.planned = false;
      if (this.afterInspection === 'homing') {
        if (this.startPass()) return;
        return this.setMode('homing');
      }
      return this.finish('Inspection done');
    }
    this.planned = true;
    const { config } = this.setup;
    const t = this.now();
    const checker = new CollisionChecker(this.map, this.half);
    const start = this.currentVertex(checker);
    if (start === null) {
      this.log('Inspection: the robot is not on the graph');
      return;
    }
    const slab = this.currentSlab();
    // A compartment is a fraction of the tank: fewer candidate positions keep the whole
    // sequence within the same compute budget as one global inspection pass.
    const perCompartment =
      this.comps && this.comps.sequence.length > 1
        ? Math.max(80, Math.round(config.sim.inspectionCandidates / this.comps.sequence.length))
        : config.sim.inspectionCandidates;
    const plan = planInspection({
      map: this.map,
      checker,
      graph: this.graph,
      startVertex: start,
      bound: slab ? clipBounds(this.globalBound, slab) : this.globalBound,
      config: perCompartment === config.sim.inspectionCandidates ? config : { ...config, sim: { ...config.sim, inspectionCandidates: perCompartment } },
      rng: this.rng,
    });
    this.log(
      `Inspection: ${plan.viewpoints.length} viewpoints for ${plan.knownSurface} mapped surface voxels ` +
        `(expected coverage ${plan.expectedCoveragePct.toFixed(0)}%)`,
    );
    if (!plan.viewpoints.length) return;
    const chunks = plan.viewpoints.map((vp) => ({
      poses: this.posesAlong(vp.leg, { x: vp.position[0], y: vp.position[1], z: vp.position[2], roll: 0, pitch: vp.pitch, yaw: vp.yaw }),
    }));
    const all = chunks.flatMap((c) => c.poses);
    // HomingCheck guards the whole behaviour tree: no tour the battery can't finish.
    if (this.lowBattery(all)) return this.startHoming();
    plan.viewpoints.forEach((vp, i) =>
      this.viewpoints.push({ position: roundVec(vp.position), yaw: round(vp.yaw, 3), pitch: round(vp.pitch, 3), order: i + 1, plannedAt: round(t, 3) }),
    );
    this.publishPath('inspection', all, null, t);
    this.queue.push(...chunks);
  }

  private planHoming(): void {
    if (this.planned) {
      this.planned = false;
      this.setup.drone.returnHome();
      this.scanAt(position(this.setup.drone.state().pose), this.setup.drone.state().pose.yaw, 0, this.now());
      return this.finish('Homing complete');
    }
    this.planned = true;
    const checker = new CollisionChecker(this.map, this.half);
    const here = this.currentVertex(checker);
    const path = here !== null && this.root !== null ? pathTo(this.graph.dijkstra(here).prev, this.root, here) : [];
    if (path.length < 2) {
      this.publishPath('homing', [this.setup.drone.state().pose], null);
      return;
    }
    const poses = this.posesAlong(path.map((v) => this.graph.positions[v]), null);
    this.publishPath('homing', poses, null);
    this.queue.push({ poses });
  }

  private startHoming(): void {
    this.log(
      `HomingCheck: time remaining ${this.timeRemaining().toFixed(0)} s is close to what homing needs: going home`,
    );
    this.queue = [];
    this.planned = false;
    this.setMode('homing');
  }

  private giveUp(reason: string): void {
    this.log(`Target reach gave up: ${reason}`);
    this.goal = null;
    if (this.passing) {
      this.log('Passing the manhole gave up: continuing with the next compartment anyway');
      this.completePass();
    }
  }

  private finish(message: string): void {
    this.log(message);
    this.planned = false;
    this.setMode('idle');
  }

  private setMode(mode: PlannerMode): void {
    if (mode !== this.modeValue) this.planned = false;
    if (mode !== 'target-reach') this.passing = false;
    this.modeValue = mode;
  }

  // --- flying -----------------------------------------------------------------------------

  /** Flies the poses with the drone, mapping and inspecting every scan spacing along the way. */
  private fly(poses: Pose[]): void {
    const { drone, speedMps, config } = this.setup;
    for (const pose of poses) {
      const st = drone.state();
      const from = position(st.pose);
      const to = position(pose);
      const d = dist(from, to);
      const n = Math.max(1, Math.ceil(d / config.sim.scanSpacingM));
      // Refuses (battery) before moving, like the real verbs.
      drone.goto(pose);
      for (let s = 1; s <= n; s++) {
        const f = s / n;
        const p: Vec3 = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
        this.scanAt(p, pose.yaw, pose.pitch, st.flightTimeS + (d * f) / speedMps);
      }
    }
  }

  private scanAt(p: Vec3, yaw: number, pitch: number, t: number): void {
    const { config, tasks } = this.setup;
    this.map.markFree(p, this.half, t);
    this.map.integrateScan(p, yaw, 0, config.lidar, t);
    this.map.integrateCamera(p, yaw, pitch, config.camera, t);
    const cam = config.camera;
    for (const task of tasks) {
      if (!task.target || this.covered.has(task.id)) continue;
      const v: Vec3 = [task.target[0] - p[0], task.target[1] - p[1], task.target[2] - p[2]];
      const d = Math.hypot(v[0], v[1], v[2]);
      if (d < cam.minRangeM || d > config.inspectionViewingRangeM) continue;
      if (!angleWithinFov(v, yaw, pitch, cam.hFovRad, cam.vFovRad)) continue;
      if (task.normal && v[0] * task.normal[0] + v[1] * task.normal[1] + v[2] * task.normal[2] >= 0) continue;
      if (!this.map.lineOfSight(p, task.target)) continue;
      this.covered.set(task.id, round(t, 3));
      this.log(`Task ${task.id} covered at t=${t.toFixed(1)} s`);
    }
  }

  // --- helpers ----------------------------------------------------------------------------

  private now(): number {
    return this.setup.drone.state().flightTimeS;
  }

  private here(): Vec3 {
    return position(this.setup.drone.state().pose);
  }

  private timeRemaining(): number {
    const now = this.now();
    const battery = this.setup.maxFlightTimeS - now;
    const user = this.userTimeRemaining ? this.userTimeRemaining.value - (now - this.userTimeRemaining.at) : Infinity;
    return Math.max(0, Math.min(battery, user));
  }

  /** HomingCheck: flying `poses` and then going home would eat into the reserve. */
  private lowBattery(poses: Pose[]): boolean {
    if (this.root === null || !poses.length) return false;
    const pts = [this.here(), ...poses.map(position)];
    const end = pts[pts.length - 1];
    const tree = this.graph.dijkstra(this.root);
    const near = this.graph.within(end, this.setup.config.nearestRangeM);
    const viaGraph = near.length ? tree.dist[near[0]] + dist(end, this.graph.positions[near[0]]) : Infinity;
    const home = (Number.isFinite(viaGraph) ? viaGraph : 1.5 * dist(end, this.graph.positions[this.root])) + this.setup.config.initMotion.xForwardM;
    const needed = (HOMING_FACTOR * (polylineLength(pts) + home)) / this.setup.speedMps + HOMING_MARGIN_S;
    return this.timeRemaining() < needed;
  }

  private currentVertex(checker: CollisionChecker): number | null {
    const here = this.here();
    return connectToGraph(this.graph, here, this.setup.config.nearestRangeM, checker, 4, true);
  }

  /**
   * Local bound around `p`, clipped to the global bound and to where free space is known.
   * With a compartment slab, x is also clipped to the slab (plus slack so the frame and its
   * opening get mapped). The RRG root is added explicitly, so `p` need not be inside.
   */
  private sampleBox(p: Vec3, slab: Bounds | null = null): Bounds {
    const { localBound } = this.setup.config;
    const known = this.map.knownFreeBox() ?? this.world;
    const min: Vec3 = [0, 0, 0];
    const max: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      min[a] = Math.max(p[a] + localBound.min[a], this.globalBound.min[a], known.min[a] - 0.5);
      max[a] = Math.min(p[a] + localBound.max[a], this.globalBound.max[a], known.max[a] + 0.5);
    }
    if (slab) {
      min[0] = Math.max(min[0], slab.min[0] - COMPARTMENT_MARGIN_M);
      max[0] = Math.min(max[0], slab.max[0] + COMPARTMENT_MARGIN_M);
    }
    return { min, max };
  }

  private openings(): Vec3[] {
    return this.tank.openings
      .map((o) => o.center)
      .filter((c) => c.every((v, a) => v >= this.globalBound.min[a] && v <= this.globalBound.max[a]));
  }

  /** Global-graph path to the best frontier vertex (in the current compartment, if sequencing). */
  private repositioningPath(checker: CollisionChecker): Vec3[] | null {
    const here = this.currentVertex(checker);
    if (here === null || !this.frontiers.size) return null;
    const slab = this.currentSlab();
    const inSlab = (v: number): boolean =>
      !slab ||
      (this.graph.positions[v][0] >= slab.min[0] - COMPARTMENT_MARGIN_M &&
        this.graph.positions[v][0] <= slab.max[0] + COMPARTMENT_MARGIN_M);
    const tree = this.graph.dijkstra(here);
    const candidates = [...this.frontiers]
      .filter((v) => Number.isFinite(tree.dist[v]) && tree.dist[v] > 0.5 && inSlab(v))
      .sort((a, b) => tree.dist[a] - tree.dist[b] || a - b)
      .slice(0, FRONTIERS_EVALUATED);
    const threshold = buildGainThreshold(this.setup.config, this.map);
    let best = -1;
    let bestScore = 0;
    for (const v of candidates) {
      const gain = this.map.visibleUnknown(this.graph.positions[v], this.setup.config.lidar);
      if (gain < threshold) {
        this.frontiers.delete(v);
        continue;
      }
      const score = gain / (1 + tree.dist[v]);
      if (score > bestScore) [best, bestScore] = [v, score];
    }
    for (const v of this.frontiers) if (!Number.isFinite(tree.dist[v])) this.frontiers.delete(v);
    if (best < 0) return null;
    this.frontiers.delete(best);
    return pathTo(tree.prev, best, here).map((v) => this.graph.positions[v]);
  }

  private forgetFrontiersNear(p: Vec3): void {
    for (const v of this.frontiers) if (dist(this.graph.positions[v], p) < 1) this.frontiers.delete(v);
  }

  private boxHasKnownObstacle(p: Vec3): boolean {
    const r = this.tank.grid.resolution;
    for (let dx = -this.half; dx <= this.half + 1e-9; dx += r / 2)
      for (let dy = -this.half; dy <= this.half + 1e-9; dy += r / 2)
        for (let dz = -this.half; dz <= this.half + 1e-9; dz += r / 2) {
          const q: Vec3 = [p[0] + dx, p[1] + dy, p[2] + dz];
          const index = voxelIndexAt(this.map, q);
          if (index !== null && this.map.state[index] === OCCUPIED) return true;
        }
    return false;
  }

  /** Poses along a polyline (skipping its first point, the robot): heading along the path. */
  private posesAlong(points: readonly Vec3[], final: Pose | null): Pose[] {
    const poses: Pose[] = [];
    let yaw = this.setup.drone.state().pose.yaw;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
      poses.push({ x: b[0], y: b[1], z: b[2], roll: 0, pitch: 0, yaw });
    }
    if (final) {
      if (poses.length) poses[poses.length - 1] = { ...final };
      else poses.push({ ...final });
    }
    return poses;
  }

  private publishPath(mode: PlannerMode, poses: Pose[], graph: Graph | null, t = this.now()): void {
    this.iterations++;
    this.out.messages.push({ topic: '/gbplanner_path', stamp: round(t, 3), poses: poses.map((p) => ({ ...p })) });
    const vertices = graph ? graph.positions.slice(0, TIMELINE_MAX_VERTICES).map((p) => roundVec(p, 2)) : [];
    const edges = graph
      ? graph
          .edges()
          .filter(([a, b]) => a < TIMELINE_MAX_VERTICES && b < TIMELINE_MAX_VERTICES)
          .slice(0, TIMELINE_MAX_EDGES)
      : [];
    this.timeline.push({
      t: round(t, 3),
      iteration: this.iterations,
      mode,
      graph: { vertices, edges },
      bestPath: [this.here(), ...poses.map(position)].map((p) => roundVec(p, 2)),
    });
  }

  private record(): void {
    const stats = this.map.stats(this.globalBound);
    this.progress.push({
      t: round(this.now(), 3),
      mode: this.modeValue,
      exploredPct: round(stats.exploredPct, 1),
      coveragePct: round(stats.coveragePct, 1),
      timeRemainingS: round(this.timeRemaining(), 1),
      compartment: this.comps ? this.comps.pos + 1 : 1,
      compartments: this.comps ? this.comps.sequence.length : 1,
    });
  }

  private log(message: string): void {
    this.out.log.push(message);
  }

  private flush(): StepOutput {
    const { messages, log } = this.out;
    this.out = new Collector();
    return { messages, log };
  }
}

function buildGainThreshold(config: GbPlannerConfig, map: VoxelMap): number {
  // Same threshold as the local RRG (frontier_percentage_threshold of the gain rays' voxels).
  const rays = Math.round((2 * Math.PI) / config.lidar.resolutionRad) * (Math.round(config.lidar.vFovRad / config.lidar.resolutionRad) + 1);
  return config.frontierPercentageThreshold * rays * (config.lidar.maxRangeM / map.grid.resolution);
}

function voxelIndexAt(map: VoxelMap, p: Vec3): number | null {
  const { origin, resolution, dims } = map.grid;
  const i = Math.floor((p[0] - origin[0]) / resolution);
  const j = Math.floor((p[1] - origin[1]) / resolution);
  const k = Math.floor((p[2] - origin[2]) / resolution);
  if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return null;
  return i + dims[0] * (j + dims[1] * k);
}

function position(p: { x: number; y: number; z: number }): Vec3 {
  return [p.x, p.y, p.z];
}

function clipBounds(a: Bounds, b: Bounds): Bounds {
  return {
    min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
    max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function parseVec(v: unknown): Vec3 | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;
}

export function parsePose(value: unknown): Pose {
  const v = asRecord(value);
  const read = (key: keyof Pose, fallback?: number): number => {
    const n = v[key] ?? fallback;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`pose.${key} must be a number`);
    return n;
  };
  return { x: read('x'), y: read('y'), z: read('z'), roll: read('roll', 0), pitch: read('pitch', 0), yaw: read('yaw', 0) };
}

function fmt(v: Vec3): string {
  return `(${v.map((x) => x.toFixed(2)).join(', ')})`;
}
