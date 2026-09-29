import type { Bounds, ElementType, Vec3 } from '../domain/types';
import { createGrid, voxelCenter, voxelIndex, voxelOf } from './grid';
import { dist } from './math';
import type { VoxelGridSpec } from './types';

/**
 * Ground truth for the simulated planner: a ballast-tank-like voxel world generated from the
 * AutoAssess area bounds and structural elements (the real campaign point cloud is not loaded).
 *
 * - Shell: the area bounds box, closed, except an access hatch where the drone takes off.
 * - Transverse frames (plates across y-z) between neighbouring compartment centres (or at
 *   manhole x-clusters), with a hole at every manhole element near the frame. A frame with no
 *   manhole gets a default opening so every compartment is reachable.
 * - Walls: small plates facing x (absorbed into a frame when they sit on one).
 * - Longitudinals: 1.2 m bars along x at their centre.
 */
export interface TankElement {
  elementType: ElementType;
  center: Vec3;
}

export interface TankOpening {
  center: Vec3;
  /** Half size of the hole in y and z (m). */
  halfSize: [number, number];
}

export interface SyntheticTank {
  grid: VoxelGridSpec;
  /** 1 = occupied (ground truth). */
  occupied: Uint8Array;
  frames: number[];
  openings: TankOpening[];
  plates: number;
  bars: number;
  hatch: Vec3 | null;
  description: string;
}

export interface TankOptions {
  /** Take-off point; on the shell it gets an access hatch. Null = closed shell. */
  home: Vec3 | null;
  initMotion: { zTakeoffM: number; xForwardM: number };
  baseResolutionM?: number;
  maxVoxels?: number;
}

export const DEFAULT_RESOLUTION_M = 0.15;
export const MAX_VOXELS = 300_000;

const FRAME_END_CLEARANCE_M = 1;
const MANHOLE_TO_FRAME_M = 0.6;
const WALL_ON_FRAME_M = 0.5;
const PLATE_HALF_M = 0.3;
const BAR_HALF_LENGTH_M = 0.6;
const KEEP_CLEAR_PLATE_M = 0.9;
const KEEP_CLEAR_BAR_M = 0.6;
const HOME_ON_WALL_M = 0.5;

export function buildSyntheticTank(box: Bounds, elements: readonly TankElement[], options: TankOptions): SyntheticTank {
  const grid = createGrid(box, options.baseResolutionM ?? DEFAULT_RESOLUTION_M, options.maxVoxels ?? MAX_VOXELS);
  const [nx, ny, nz] = grid.dims;
  const res = grid.resolution;
  const occupied = new Uint8Array(nx * ny * nz);
  const inside = elements.filter((e) => e.center.every((v, a) => v >= box.min[a] && v <= box.max[a]));
  const corridor = options.home ? initMotionPath(box, options.home, options.initMotion) : [];

  // Shell.
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
          occupied[voxelIndex(grid, i, j, k)] = 1;
        }
      }

  // Frames and their openings.
  const frames = frameXs(box, inside, corridor[2] ?? null);
  const half: [number, number] = [Math.max(0.4, 2.5 * res), Math.max(0.5, 2.5 * res)];
  const openings: TankOpening[] = [];
  const manholes = inside.filter((e) => e.elementType === 'manhole');
  for (const fx of frames) {
    const near = manholes.filter((m) => Math.abs(m.center[0] - fx) <= MANHOLE_TO_FRAME_M);
    const centres: Array<[number, number]> = near.length
      ? near.map((m) => [m.center[1], m.center[2]])
      : [[(box.min[1] + box.max[1]) / 2, box.min[2] + options.initMotion.zTakeoffM]];
    for (const [y, z] of centres) {
      openings.push({
        center: [fx, clamp(y, box.min[1] + res + half[0], box.max[1] - res - half[0]), clamp(z, box.min[2] + res + half[1], box.max[2] - res - half[1])],
        halfSize: half,
      });
    }
    const fi = voxelOf(grid, [fx, box.min[1], box.min[2]])?.[0];
    if (fi === undefined) continue;
    for (let k = 1; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++) {
        const c = voxelCenter(grid, voxelIndex(grid, fi, j, k));
        const inHole = openings.some(
          (o) => Math.abs(o.center[0] - fx) < 1e-9 && Math.abs(c[1] - o.center[1]) <= o.halfSize[0] && Math.abs(c[2] - o.center[2]) <= o.halfSize[1],
        );
        if (!inHole) occupied[voxelIndex(grid, fi, j, k)] = 1;
      }
  }

  const keepClear = (p: Vec3, r: number): boolean =>
    openings.some((o) => dist(o.center, p) < r) || distanceToPolyline(p, corridor) < r;

  // Walls -> plates facing x.
  let plates = 0;
  for (const wall of inside.filter((e) => e.elementType === 'wall')) {
    const [wx, wy, wz] = wall.center;
    if (frames.some((fx) => Math.abs(fx - wx) < WALL_ON_FRAME_M) || keepClear(wall.center, KEEP_CLEAR_PLATE_M)) continue;
    const v = voxelOf(grid, wall.center);
    if (!v) continue;
    let placed = false;
    for (let k = 1; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++) {
        const c = voxelCenter(grid, voxelIndex(grid, v[0], j, k));
        if (Math.abs(c[1] - wy) <= PLATE_HALF_M && Math.abs(c[2] - wz) <= PLATE_HALF_M) {
          occupied[voxelIndex(grid, v[0], j, k)] = 1;
          placed = true;
        }
      }
    if (placed) plates++;
  }

  // Longitudinals -> bars along x.
  let bars = 0;
  for (const bar of inside.filter((e) => e.elementType === 'longitudinal')) {
    const v = voxelOf(grid, bar.center);
    if (!v || v[1] === 0 || v[2] === 0 || v[1] === ny - 1 || v[2] === nz - 1) continue;
    let placed = false;
    for (let i = 1; i < nx - 1; i++) {
      const index = voxelIndex(grid, i, v[1], v[2]);
      const c = voxelCenter(grid, index);
      if (Math.abs(c[0] - bar.center[0]) > BAR_HALF_LENGTH_M || keepClear(c, KEEP_CLEAR_BAR_M)) continue;
      occupied[index] = 1;
      placed = true;
    }
    if (placed) bars++;
  }

  // Access hatch where the drone takes off (a doorway in the wall next to home).
  let hatch: Vec3 | null = null;
  if (options.home && corridor.length === 3) {
    const face = nearestWall(box, options.home);
    if (face && face.distance <= HOME_ON_WALL_M) {
      hatch = carveHatch(grid, occupied, face.axis, face.side, options.home, corridor[1], half[0]);
    }
  }

  const size = [0, 1, 2].map((a) => (grid.dims[a] * res).toFixed(1)).join(' × ');
  const description =
    frames.length + plates + bars === 0
      ? `box tank ${size} m (no frames: the area has no compartment/manhole elements), ${res} m voxels`
      : `synthetic tank ${size} m: ${frames.length} frames (${openings.length} openings), ${plates} plates, ${bars} bars, ${res} m voxels`;
  return { grid, occupied, frames, openings, plates, bars, hatch, description };
}

/**
 * The PCI initialization motion: climb to z_takeoff above home, then fly x_forward into the tank
 * (away from the wall home sits on, or towards the tank centre).
 */
export function initMotionPath(box: Bounds, home: Vec3, init: { zTakeoffM: number; xForwardM: number }): [Vec3, Vec3, Vec3] {
  const up: Vec3 = [home[0], home[1], Math.min(home[2] + init.zTakeoffM, box.max[2] - 0.3)];
  const face = nearestWall(box, home);
  let dir: [number, number];
  if (face && face.distance <= HOME_ON_WALL_M) {
    dir = face.axis === 0 ? [face.side === 'min' ? 1 : -1, 0] : [0, face.side === 'min' ? 1 : -1];
  } else {
    const cx = (box.min[0] + box.max[0]) / 2 - home[0];
    const cy = (box.min[1] + box.max[1]) / 2 - home[1];
    const l = Math.hypot(cx, cy);
    dir = l > 1e-6 ? [cx / l, cy / l] : [1, 0];
  }
  return [home, up, [up[0] + dir[0] * init.xForwardM, up[1] + dir[1] * init.xForwardM, up[2]]];
}

function frameXs(box: Bounds, elements: readonly TankElement[], initPoint: Vec3 | null): number[] {
  const compartments = clusterXs(elements.filter((e) => e.elementType === 'compartment').map((e) => e.center[0]), 1);
  let xs: number[];
  if (compartments.length >= 2) {
    xs = compartments.slice(1).map((x, i) => (x + compartments[i]) / 2);
  } else {
    xs = clusterXs(elements.filter((e) => e.elementType === 'manhole').map((e) => e.center[0]), MANHOLE_TO_FRAME_M);
  }
  const kept: number[] = [];
  for (const x of xs) {
    if (x - box.min[0] < FRAME_END_CLEARANCE_M || box.max[0] - x < FRAME_END_CLEARANCE_M) continue;
    if (initPoint && Math.abs(x - initPoint[0]) < 0.9) continue;
    if (kept.length && x - kept[kept.length - 1] < 0.8) continue;
    kept.push(x);
  }
  return kept;
}

/** Sorted cluster means of 1-D values (values closer than `gap` join a cluster). */
function clusterXs(values: number[], gap: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let group: number[] = [];
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > gap) {
      out.push(mean(group));
      group = [];
    }
    group.push(v);
  }
  if (group.length) out.push(mean(group));
  return out;
}

function nearestWall(box: Bounds, p: Vec3): { axis: 0 | 1; side: 'min' | 'max'; distance: number } | null {
  const candidates: Array<{ axis: 0 | 1; side: 'min' | 'max'; distance: number }> = [
    { axis: 0, side: 'min', distance: Math.abs(p[0] - box.min[0]) },
    { axis: 0, side: 'max', distance: Math.abs(box.max[0] - p[0]) },
    { axis: 1, side: 'min', distance: Math.abs(p[1] - box.min[1]) },
    { axis: 1, side: 'max', distance: Math.abs(box.max[1] - p[1]) },
  ];
  return candidates.reduce((best, c) => (c.distance < best.distance ? c : best));
}

function carveHatch(
  grid: VoxelGridSpec,
  occupied: Uint8Array,
  axis: 0 | 1,
  side: 'min' | 'max',
  home: Vec3,
  up: Vec3,
  halfWidth: number,
): Vec3 {
  const [nx, ny, nz] = grid.dims;
  const layer = side === 'min' ? 0 : (axis === 0 ? nx : ny) - 1;
  const lateral = axis === 0 ? 1 : 0;
  const top = up[2] + halfWidth;
  for (let k = 0; k < nz; k++)
    for (let l = 0; l < (axis === 0 ? ny : nx); l++) {
      const index = axis === 0 ? voxelIndex(grid, layer, l, k) : voxelIndex(grid, l, layer, k);
      const c = voxelCenter(grid, index);
      if (Math.abs(c[lateral] - home[lateral]) <= halfWidth && c[2] >= home[2] - grid.resolution && c[2] <= top) {
        occupied[index] = 0;
      }
    }
  return [home[0], home[1], (home[2] + top) / 2];
}

function distanceToPolyline(p: Vec3, line: readonly Vec3[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i - 1], line[i]));
  return best;
}

export function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = l2 > 0 ? clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2, 0, 1) : 0;
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

function clamp(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}
