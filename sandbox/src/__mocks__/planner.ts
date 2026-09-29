import type { PlannerMap, PlannerResult } from '../planner/types';

/**
 * Test fixture: a small hand-made planner result. The map is 4 x 3 x 3 voxels of 1 m from the
 * origin, all unknown; set voxels with `setVoxel`.
 */
export function plannerResult(overrides: Partial<PlannerResult> = {}): PlannerResult {
  return {
    config: 'bwt_inspection',
    globalBound: { min: [0, 0, 0], max: [4, 3, 3] },
    timeline: [
      {
        t: 1,
        iteration: 1,
        mode: 'exploration',
        graph: { vertices: [[0.5, 0.5, 1.5], [1.5, 0.5, 1.5], [1.5, 1.5, 1.5]], edges: [[0, 1], [1, 2]] },
        bestPath: [[0.5, 0.5, 1.5], [1.5, 0.5, 1.5]],
      },
      {
        t: 5,
        iteration: 2,
        mode: 'inspection',
        graph: { vertices: [], edges: [] },
        bestPath: [[1.5, 0.5, 1.5], [2.5, 1.5, 1.5]],
      },
    ],
    progress: [
      { t: 0, mode: 'initialization', exploredPct: 10, coveragePct: 0, timeRemainingS: 100, compartment: 1, compartments: 2 },
      { t: 4, mode: 'exploration', exploredPct: 50, coveragePct: 20, timeRemainingS: 96, compartment: 1, compartments: 2 },
      { t: 8, mode: 'inspection', exploredPct: 60, coveragePct: 80, timeRemainingS: 92, compartment: 2, compartments: 2 },
    ],
    viewpoints: [
      { position: [2.5, 1.5, 1.5], yaw: 0, pitch: 0.6, order: 1, plannedAt: 5 },
      { position: [3.5, 1.5, 1.5], yaw: 1, pitch: 0, order: 2, plannedAt: 5 },
    ],
    coveredTasks: { 'task-a': 3, 'task-b': 7 },
    map: emptyMap(),
    sensors: { cameraHFovRad: Math.PI / 2, cameraVFovRad: Math.PI / 3, cameraMaxRangeM: 1.5 },
    ...overrides,
  };
}

export function emptyMap(dims: [number, number, number] = [4, 3, 3]): PlannerMap {
  const n = dims[0] * dims[1] * dims[2];
  return {
    origin: [0, 0, 0],
    resolution: 1,
    dims,
    state: new Uint8Array(n),
    seenAt: new Float32Array(n).fill(-1),
    inspectedAt: new Float32Array(n).fill(-1),
  };
}

/** Marks voxel (i, j, k) free (1) or occupied (2), seen at `seenAt`, optionally inspected. */
export function setVoxel(
  map: PlannerMap,
  [i, j, k]: [number, number, number],
  state: 1 | 2,
  seenAt: number,
  inspectedAt = -1,
): void {
  const index = i + map.dims[0] * (j + map.dims[1] * k);
  map.state[index] = state;
  map.seenAt[index] = seenAt;
  map.inspectedAt[index] = inspectedAt;
}
