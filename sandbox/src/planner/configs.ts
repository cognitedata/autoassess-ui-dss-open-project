import type { Vec3 } from '../domain/types';

/**
 * Parameter sets of the simulated gbplanner. Values marked "gbplanner" are copied from NTNU ARL's
 * gbplanner3 configs (github.com/ntnu-arl/gbplanner_ros, branch gbplanner3, BSD-3):
 * config/uav/gzc/bwt_inspection and config/uav/gzc/cave_exploration (gbplanner_config.yaml and
 * planner_control_interface_sim_config.yaml). Values under `sim` are the sandbox's own knobs that
 * keep a run fast in the browser.
 */
export interface SensorConfig {
  maxRangeM: number;
  minRangeM: number;
  /** Full field of view, radians (2π = all around). */
  hFovRad: number;
  vFovRad: number;
  /** Ray spacing of the planner's gain model, radians. */
  resolutionRad: number;
}

export interface GbPlannerConfig {
  name: GbPlannerConfigName;
  /** RobotParams.size (m). */
  robotSize: Vec3;
  /** Exploration sensor (OS064 lidar): mapping and volumetric gain. */
  lidar: SensorConfig;
  /** Inspection camera ("Cam"): surface coverage. */
  camera: SensorConfig;
  /** BoundedSpaceParams.Local, relative to the robot. */
  localBound: { min: Vec3; max: Vec3 };
  edgeLengthMinM: number;
  edgeLengthMaxM: number;
  nearestRangeM: number;
  pathLengthPenalty: number;
  unknownVoxelGain: number;
  traverseLengthMaxM: number;
  frontierPercentageThreshold: number;
  minCoveragePercentage: number;
  /** inspection_target_viewing_range (m): a surface/task counts as inspected within this range. */
  inspectionViewingRangeM: number;
  maxInspectionVertices: number;
  maxSurfaceDistanceM: number;
  /** PCI init_motion. */
  initMotion: { zTakeoffM: number; zDropM: number; xForwardM: number };
  /** Behaviour: BWT inspects the mapped surfaces once exploration is exhausted. */
  inspectAfterExploration: boolean;
  /** go_home_if_fully_explored. */
  goHomeWhenExplored: boolean;
  sim: {
    /** Vertices per local RRG (gbplanner's num_vertices_max is 400). */
    rrgVertices: number;
    /** Sampling attempts per local RRG. */
    rrgAttempts: number;
    /** Extra neighbours an RRG vertex is connected to (besides the nearest). */
    rrgNeighbours: number;
    /** Candidate inspection positions (gbplanner's inspection_graph_vertices is 500). */
    inspectionCandidates: number;
    /** Camera pitch options for inspection viewpoints (radians, + looks up). */
    inspectionPitchesRad: number[];
    /** Heading options for inspection viewpoints. */
    inspectionYaws: number;
    /** Distance between map updates while flying (m). */
    scanSpacingM: number;
    /** Target reach gives up after this many iterations without getting closer. */
    targetReachPatience: number;
    /** Merge a local-graph vertex into an existing global vertex closer than this (m). */
    globalMergeRadiusM: number;
  };
}

export type GbPlannerConfigName = 'bwt_inspection' | 'cave_exploration';

const deg = (d: number): number => (d * Math.PI) / 180;

const SIM_DEFAULTS: GbPlannerConfig['sim'] = {
  rrgVertices: 120,
  rrgAttempts: 2500,
  rrgNeighbours: 5,
  inspectionCandidates: 300,
  inspectionPitchesRad: [-0.6, 0, 0.6],
  inspectionYaws: 8,
  scanSpacingM: 0.3,
  targetReachPatience: 4,
  globalMergeRadiusM: 0.4,
};

export const GBPLANNER_CONFIGS: Record<GbPlannerConfigName, GbPlannerConfig> = {
  bwt_inspection: {
    name: 'bwt_inspection',
    robotSize: [0.4, 0.4, 0.4],
    lidar: { maxRangeM: 3.5, minRangeM: 0, hFovRad: 2 * Math.PI, vFovRad: deg(90), resolutionRad: deg(10) },
    camera: { maxRangeM: 1.5, minRangeM: 0.25, hFovRad: deg(80), vFovRad: deg(60), resolutionRad: deg(5) },
    localBound: { min: [-7.5, -7.5, -7], max: [7.5, 7.5, 7] },
    edgeLengthMinM: 0.2,
    edgeLengthMaxM: 3,
    nearestRangeM: 3,
    pathLengthPenalty: 0.01,
    unknownVoxelGain: 60,
    traverseLengthMaxM: 5,
    frontierPercentageThreshold: 0.005,
    minCoveragePercentage: 0.9,
    inspectionViewingRangeM: 1.5,
    maxInspectionVertices: 100,
    maxSurfaceDistanceM: 1.5,
    initMotion: { zTakeoffM: 1.2, zDropM: 0.5, xForwardM: 0.7 },
    inspectAfterExploration: true,
    goHomeWhenExplored: true,
    sim: SIM_DEFAULTS,
  },
  cave_exploration: {
    name: 'cave_exploration',
    robotSize: [0.4, 0.4, 0.4],
    lidar: { maxRangeM: 15, minRangeM: 0, hFovRad: 2 * Math.PI, vFovRad: deg(90), resolutionRad: deg(10) },
    camera: { maxRangeM: 2.5, minRangeM: 0.25, hFovRad: deg(120), vFovRad: deg(80), resolutionRad: deg(5) },
    localBound: { min: [-15, -15, -15], max: [15, 15, 15] },
    edgeLengthMinM: 0.2,
    edgeLengthMaxM: 4,
    nearestRangeM: 4,
    pathLengthPenalty: 0.01,
    unknownVoxelGain: 60,
    traverseLengthMaxM: 12,
    frontierPercentageThreshold: 0.005,
    minCoveragePercentage: 0.9,
    inspectionViewingRangeM: 1.25,
    maxInspectionVertices: 75,
    maxSurfaceDistanceM: 1.5,
    initMotion: { zTakeoffM: 1.2, zDropM: 0.5, xForwardM: 0.7 },
    inspectAfterExploration: false,
    goHomeWhenExplored: true,
    sim: SIM_DEFAULTS,
  },
};

export const GBPLANNER_CONFIG_NAMES = Object.keys(GBPLANNER_CONFIGS) as GbPlannerConfigName[];

export function gbPlannerConfig(name: string): GbPlannerConfig {
  if (name in GBPLANNER_CONFIGS) return GBPLANNER_CONFIGS[name as GbPlannerConfigName];
  throw new Error(`Unknown gbplanner config '${name}'. Available: ${GBPLANNER_CONFIG_NAMES.join(', ')}`);
}
