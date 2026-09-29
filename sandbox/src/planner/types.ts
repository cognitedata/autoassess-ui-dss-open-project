import type { Bounds, Vec3 } from '../domain/types';

/**
 * Types shared by the simulated gbplanner (src/planner) and the UI. The planner is a simplified,
 * in-browser stand-in for NTNU ARL's gbplanner3 / OmniPlanner (BSD-3): same service / topic
 * names and behaviour, much simpler algorithms.
 */

/** What the planner is doing. Mirrors the PCI/behaviour-tree states of the real planner. */
export type PlannerMode =
  | 'idle'
  | 'initialization'
  | 'exploration'
  | 'inspection'
  | 'target-reach'
  | 'waypoint'
  | 'homing';

/** A regular voxel grid over the world box. Index = i + nx * (j + ny * k). */
export interface VoxelGridSpec {
  origin: Vec3;
  resolution: number;
  dims: [number, number, number];
}

/** A planning iteration as drawn by the UI (graph sub-sampled). */
export interface PlannerIteration {
  /** Simulated flight time when the iteration was planned. */
  t: number;
  iteration: number;
  mode: PlannerMode;
  graph: { vertices: Vec3[]; edges: Array<[number, number]> };
  bestPath: Vec3[];
}

export interface PlannerProgress {
  t: number;
  mode: PlannerMode;
  exploredPct: number;
  coveragePct: number;
  timeRemainingS: number;
  /** 1-based compartment the BWT flow is working on (1 when not sequencing). */
  compartment: number;
  /** Compartments in the BWT sequence (1 when not sequencing). */
  compartments: number;
}

/** Per-compartment result of the BWT flow (slabs between the tank's transverse frames). */
export interface CompartmentReport {
  /** 1-based, ordered along x. */
  index: number;
  xMin: number;
  xMax: number;
  exploredPct: number;
  coveragePct: number;
}

export interface InspectionViewpoint {
  position: Vec3;
  yaw: number;
  pitch: number;
  /** 1-based position in the inspection tour. */
  order: number;
  plannedAt: number;
}

/** The known map. A voxel's kind never changes once seen (ideal, noise-free mapping). */
export interface PlannerMap extends VoxelGridSpec {
  /** 0 unknown, 1 free, 2 occupied (final state). */
  state: Uint8Array;
  /** Simulated time each voxel was first seen (-1 = never). */
  seenAt: Float32Array;
  /** Simulated time the inspection camera first saw each surface voxel (-1 = never). */
  inspectedAt: Float32Array;
}

export interface PlannerSensorsView {
  cameraHFovRad: number;
  cameraVFovRad: number;
  cameraMaxRangeM: number;
}

/** Everything the UI needs to draw the planner (MissionResult.planner). */
export interface PlannerResult {
  config: string;
  globalBound: Bounds;
  timeline: PlannerIteration[];
  progress: PlannerProgress[];
  viewpoints: InspectionViewpoint[];
  /** Plan task id -> simulated time it was covered by the inspection camera. */
  coveredTasks: Record<string, number>;
  map: PlannerMap;
  sensors: PlannerSensorsView;
}

/** What Python's SimGbPlanner.report() returns (camelCase here, snake_case in Python). */
export interface PlannerReport {
  config: string;
  mode: PlannerMode;
  iterations: number;
  exploredPct: number;
  surfaceCoveragePct: number;
  distanceM: number;
  durationS: number;
  viewpoints: number;
  coveredTasks: Record<string, number>;
  uncoveredTasks: string[];
  voxelResolutionM: number;
  voxels: number;
  syntheticTank: string;
  /** One entry per compartment of the BWT sequence ([] when the flow never sequenced). */
  compartments: CompartmentReport[];
}
