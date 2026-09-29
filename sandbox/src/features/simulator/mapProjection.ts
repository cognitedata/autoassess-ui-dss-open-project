import type { PlannerMap } from '../../planner/types';
import type { ViewAxes } from './projection';

const FREE = 1;
const OCCUPIED = 2;

/**
 * The planner's 3-D voxel map flattened onto one view (top: x-y, side: x-z). Each cell keeps the
 * earliest simulated time its column held a free, an occupied and an inspected voxel, so the map
 * at any playback time is a cheap comparison per cell. The first and last voxel layers along the
 * depth axis (the synthetic tank's shell: floor/ceiling in the top view, the side walls in the
 * side view) are left out, or they would cover the whole view.
 */
export interface MapProjection {
  axes: ViewAxes;
  cols: number;
  rows: number;
  /** World coordinates (view horizontal, view vertical) of the corner of cell (0, 0). */
  origin: [number, number];
  resolution: number;
  /** Per cell (index = col + cols * row): first time seen, -1 = never. */
  freeAt: Float32Array;
  occupiedAt: Float32Array;
  inspectedAt: Float32Array;
}

export type MapCellKind = 'unknown' | 'free' | 'occupied' | 'inspected';

export function projectPlannerMap(map: PlannerMap, axes: ViewAxes): MapProjection {
  const [h, v] = axes;
  const depth = ([0, 1, 2] as const).find((a) => a !== h && a !== v) ?? 2;
  const cols = map.dims[h];
  const rows = map.dims[v];
  const freeAt = new Float32Array(cols * rows).fill(-1);
  const occupiedAt = new Float32Array(cols * rows).fill(-1);
  const inspectedAt = new Float32Array(cols * rows).fill(-1);
  const [nx, ny, nz] = map.dims;
  const lastDepth = map.dims[depth] - 1;
  const earliest = (arr: Float32Array, cell: number, time: number) => {
    if (time >= 0 && (arr[cell] < 0 || time < arr[cell])) arr[cell] = time;
  };
  const c: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        c[0] = i;
        c[1] = j;
        c[2] = k;
        if (c[depth] === 0 || c[depth] === lastDepth) continue;
        const index = i + nx * (j + ny * k);
        const state = map.state[index];
        if (state !== FREE && state !== OCCUPIED) continue;
        const cell = c[h] + cols * c[v];
        earliest(state === FREE ? freeAt : occupiedAt, cell, map.seenAt[index]);
        if (state === OCCUPIED) earliest(inspectedAt, cell, map.inspectedAt[index]);
      }
  return {
    axes,
    cols,
    rows,
    origin: [map.origin[h], map.origin[v]],
    resolution: map.resolution,
    freeAt,
    occupiedAt,
    inspectedAt,
  };
}

/** What a cell shows at time t: the structure wins over free space in the same column. */
export function cellKindAt(proj: MapProjection, cell: number, t: number): MapCellKind {
  const seen = (arr: Float32Array) => arr[cell] >= 0 && arr[cell] <= t;
  if (seen(proj.inspectedAt)) return 'inspected';
  if (seen(proj.occupiedAt)) return 'occupied';
  if (seen(proj.freeAt)) return 'free';
  return 'unknown';
}
