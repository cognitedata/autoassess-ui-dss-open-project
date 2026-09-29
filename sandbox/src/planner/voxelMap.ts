import type { Bounds, Vec3 } from '../domain/types';
import type { SensorConfig } from './configs';
import { voxelCoords, voxelIndex, voxelOf } from './grid';
import { dist, rotateDirection, sensorRayDirections } from './math';
import type { PlannerMap, VoxelGridSpec } from './types';

export const UNKNOWN = 0;
export const FREE = 1;
export const OCCUPIED = 2;

const DEG = Math.PI / 180;
/** Finest angular spacing used for mapping rays. */
const MIN_RAY_STEP_RAD = 2 * DEG;

export interface MapStats {
  exploredPct: number;
  coveragePct: number;
  knownSurface: number;
  inspectedSurface: number;
}

/**
 * The planner's known map (unknown / free / occupied), built by ray casting into the ground
 * truth: ideal, noise-free sensors, no TSDF/ESDF. Also records when each voxel was first seen
 * and when the inspection camera first saw each surface voxel.
 */
export class VoxelMap {
  readonly state: Uint8Array;
  readonly seenAt: Float32Array;
  readonly inspectedAt: Float32Array;
  /** Ground-truth surface voxels: occupied with a free 6-neighbour. */
  readonly surface: Uint8Array;
  private boundMask: Uint8Array | null = null;
  private readonly freeLo: Vec3 = [Infinity, Infinity, Infinity];
  private readonly freeHi: Vec3 = [-Infinity, -Infinity, -Infinity];

  constructor(
    readonly grid: VoxelGridSpec,
    readonly truth: Uint8Array,
  ) {
    const n = grid.dims[0] * grid.dims[1] * grid.dims[2];
    this.state = new Uint8Array(n);
    this.seenAt = new Float32Array(n).fill(-1);
    this.inspectedAt = new Float32Array(n).fill(-1);
    this.surface = surfaceMask(grid, truth);
  }

  /** Restricts gain and statistics to `bound` (null = the whole grid). */
  setBound(bound: Bounds | null): void {
    this.boundMask = bound ? boxMask(this.grid, bound) : null;
  }

  /** Integrates one scan of a mapping sensor at a pose. Returns the number of newly known voxels. */
  integrateScan(position: Vec3, yaw: number, pitch: number, sensor: SensorConfig, t: number): number {
    const step = Math.max(MIN_RAY_STEP_RAD, this.grid.resolution / sensor.maxRangeM);
    let added = 0;
    for (const d of directions(sensor.hFovRad, sensor.vFovRad, step)) {
      castRay(this.grid, position, rotateDirection(d, yaw, pitch), sensor.maxRangeM, (index, at) => {
        if (at < sensor.minRangeM) return this.truth[index] === 0;
        if (this.truth[index]) {
          added += this.see(index, OCCUPIED, t);
          return false;
        }
        added += this.see(index, FREE, t);
        return true;
      });
    }
    return added;
  }

  /** The inspection camera: records surface voxels seen within its range. Returns the new ones. */
  integrateCamera(position: Vec3, yaw: number, pitch: number, sensor: SensorConfig, t: number): number {
    let added = 0;
    for (const d of cameraDirections(this.grid, sensor)) {
      castRay(this.grid, position, rotateDirection(d, yaw, pitch), sensor.maxRangeM, (index, at) => {
        if (!this.truth[index]) return true;
        if (at >= sensor.minRangeM && this.inspectedAt[index] < 0) {
          this.inspectedAt[index] = t;
          added++;
        }
        return false;
      });
    }
    return added;
  }

  /** Marks the really-free voxels in a box as known free (e.g. the volume the robot occupies). */
  markFree(center: Vec3, half: number, t: number): void {
    const range = this.boxRange(center, half, true);
    if (!range) return;
    const [lo, hi] = range;
    for (let k = lo[2]; k <= hi[2]; k++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let i = lo[0]; i <= hi[0]; i++) {
          const index = voxelIndex(this.grid, i, j, k);
          if (!this.truth[index]) this.see(index, FREE, t);
        }
  }

  /** True when every voxel a robot box (half-size `half`) around `p` overlaps is known free. */
  isBoxFree(p: Vec3, half: number): boolean {
    const v = voxelOf(this.grid, p);
    if (!v) return false;
    const r = this.grid.resolution;
    const c: Vec3 = [0, 1, 2].map((a) => this.grid.origin[a] + (v[a] + 0.5) * r) as Vec3;
    const range = this.boxRange(c, half, false);
    if (!range) return false;
    const [lo, hi] = range;
    for (let k = lo[2]; k <= hi[2]; k++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let i = lo[0]; i <= hi[0]; i++) {
          if (this.state[voxelIndex(this.grid, i, j, k)] !== FREE) return false;
        }
    return true;
  }

  /**
   * Volumetric gain: unknown voxels (inside the bound) along the sensor's gain rays from `p`,
   * treating unknown space as transparent and stopping at known obstacles.
   */
  visibleUnknown(p: Vec3, sensor: SensorConfig): number {
    let count = 0;
    const mask = this.boundMask;
    for (const d of directions(sensor.hFovRad, sensor.vFovRad, sensor.resolutionRad)) {
      castRay(this.grid, p, d, sensor.maxRangeM, (index) => {
        const s = this.state[index];
        if (s === OCCUPIED) return false;
        if (s === UNKNOWN && (!mask || mask[index])) count++;
        return true;
      });
    }
    return count;
  }

  /** Is `to` visible from `from` (nothing solid in between; a target on a surface counts)? */
  lineOfSight(from: Vec3, to: Vec3): boolean {
    const length = dist(from, to);
    if (length < 1e-9) return true;
    const dir: Vec3 = [(to[0] - from[0]) / length, (to[1] - from[1]) / length, (to[2] - from[2]) / length];
    const slack = 1.5 * this.grid.resolution;
    let blocked = false;
    castRay(this.grid, from, dir, length, (index, at) => {
      if (this.truth[index] && at < length - slack) {
        blocked = true;
        return false;
      }
      return true;
    });
    return !blocked;
  }

  /** Explored share of the bound's voxels and inspected share of its known surface voxels. */
  stats(bound: Bounds | null): MapStats {
    const mask = bound ? boxMask(this.grid, bound) : null;
    let total = 0;
    let known = 0;
    let knownSurface = 0;
    let inspected = 0;
    for (let i = 0; i < this.state.length; i++) {
      if (mask && !mask[i]) continue;
      total++;
      const s = this.state[i];
      if (s === UNKNOWN) continue;
      known++;
      if (s === OCCUPIED && this.surface[i]) {
        knownSurface++;
        if (this.inspectedAt[i] >= 0) inspected++;
      }
    }
    return {
      exploredPct: total ? (100 * known) / total : 0,
      coveragePct: knownSurface ? (100 * inspected) / knownSurface : 0,
      knownSurface,
      inspectedSurface: inspected,
    };
  }

  toPlannerMap(): PlannerMap {
    return {
      origin: [...this.grid.origin],
      resolution: this.grid.resolution,
      dims: [...this.grid.dims],
      state: this.state.slice(),
      seenAt: this.seenAt.slice(),
      inspectedAt: this.inspectedAt.slice(),
    };
  }

  /** Box around every known-free voxel (where the planner can sample), or null. */
  knownFreeBox(): Bounds | null {
    const [lo, hi] = [this.freeLo, this.freeHi];
    if (lo[0] > hi[0]) return null;
    const r = this.grid.resolution;
    const o = this.grid.origin;
    return {
      min: [o[0] + lo[0] * r, o[1] + lo[1] * r, o[2] + lo[2] * r],
      max: [o[0] + (hi[0] + 1) * r, o[1] + (hi[1] + 1) * r, o[2] + (hi[2] + 1) * r],
    };
  }

  private see(index: number, kind: number, t: number): number {
    if (this.state[index] !== UNKNOWN) return 0;
    this.state[index] = kind;
    this.seenAt[index] = t;
    if (kind === FREE) {
      const c = voxelCoords(this.grid, index);
      for (let a = 0; a < 3; a++) {
        if (c[a] < this.freeLo[a]) this.freeLo[a] = c[a];
        if (c[a] > this.freeHi[a]) this.freeHi[a] = c[a];
      }
    }
    return 1;
  }

  /** Voxel index ranges a box overlaps; null if it leaves the grid (unless `clip`). */
  private boxRange(center: Vec3, half: number, clip: boolean): [Vec3, Vec3] | null {
    const lo: Vec3 = [0, 0, 0];
    const hi: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const r = this.grid.resolution;
      let l = Math.floor((center[a] - half - this.grid.origin[a]) / r + 1e-9);
      let h = Math.floor((center[a] + half - this.grid.origin[a]) / r - 1e-9);
      if (clip) {
        l = Math.max(l, 0);
        h = Math.min(h, this.grid.dims[a] - 1);
        if (l > h) return null;
      } else if (l < 0 || h >= this.grid.dims[a]) return null;
      lo[a] = l;
      hi[a] = h;
    }
    return [lo, hi];
  }
}

/**
 * 3-D DDA (Amanatides & Woo): visits every voxel a ray passes through, in order, with the
 * distance at which the ray enters it, until `visit` returns false, the range ends or the ray
 * leaves the grid.
 */
export function castRay(
  grid: VoxelGridSpec,
  origin: Vec3,
  dir: Vec3,
  maxRange: number,
  visit: (index: number, distance: number) => boolean,
): void {
  const r = grid.resolution;
  const [nx, ny, nz] = grid.dims;
  const start = voxelOf(grid, origin);
  if (!start) return;
  let [i, j, k] = start;
  const stepI = dir[0] > 0 ? 1 : dir[0] < 0 ? -1 : 0;
  const stepJ = dir[1] > 0 ? 1 : dir[1] < 0 ? -1 : 0;
  const stepK = dir[2] > 0 ? 1 : dir[2] < 0 ? -1 : 0;
  const boundary = (a: number, v: number, step: number) => grid.origin[a] + (v + (step > 0 ? 1 : 0)) * r;
  const tMaxFor = (a: number, v: number, step: number) =>
    step === 0 ? Infinity : (boundary(a, v, step) - origin[a]) / dir[a];
  let tMaxX = tMaxFor(0, i, stepI);
  let tMaxY = tMaxFor(1, j, stepJ);
  let tMaxZ = tMaxFor(2, k, stepK);
  const dX = stepI === 0 ? Infinity : r / Math.abs(dir[0]);
  const dY = stepJ === 0 ? Infinity : r / Math.abs(dir[1]);
  const dZ = stepK === 0 ? Infinity : r / Math.abs(dir[2]);
  let t = 0;
  const nxy = nx * ny;
  while (t <= maxRange) {
    if (!visit(i + nx * j + nxy * k, t)) return;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      i += stepI;
      t = tMaxX;
      tMaxX += dX;
      if (i < 0 || i >= nx) return;
    } else if (tMaxY < tMaxZ) {
      j += stepJ;
      t = tMaxY;
      tMaxY += dY;
      if (j < 0 || j >= ny) return;
    } else {
      k += stepK;
      t = tMaxZ;
      tMaxZ += dZ;
      if (k < 0 || k >= nz) return;
    }
  }
}

const directionCache = new Map<string, Vec3[]>();

/** Ray pattern of the inspection camera (planning and simulation use the same one). */
export function cameraDirections(grid: VoxelGridSpec, sensor: SensorConfig): Vec3[] {
  const step = Math.max(MIN_RAY_STEP_RAD, Math.min(sensor.resolutionRad, grid.resolution / sensor.maxRangeM));
  return directions(sensor.hFovRad, sensor.vFovRad, step);
}

/** Number of gain rays of a sensor (its resolution-spaced ray model). */
export function directionCount(sensor: SensorConfig): number {
  return directions(sensor.hFovRad, sensor.vFovRad, sensor.resolutionRad).length;
}

function directions(hFov: number, vFov: number, step: number): Vec3[] {
  const key = `${hFov.toFixed(5)}|${vFov.toFixed(5)}|${step.toFixed(5)}`;
  let dirs = directionCache.get(key);
  if (!dirs) {
    dirs = sensorRayDirections(hFov, vFov, step);
    directionCache.set(key, dirs);
  }
  return dirs;
}

function surfaceMask(grid: VoxelGridSpec, truth: Uint8Array): Uint8Array {
  const [nx, ny, nz] = grid.dims;
  const out = new Uint8Array(truth.length);
  for (let index = 0; index < truth.length; index++) {
    if (!truth[index]) continue;
    const [i, j, k] = voxelCoords(grid, index);
    const free = (a: number, b: number, c: number) =>
      a >= 0 && b >= 0 && c >= 0 && a < nx && b < ny && c < nz && !truth[voxelIndex(grid, a, b, c)];
    if (free(i - 1, j, k) || free(i + 1, j, k) || free(i, j - 1, k) || free(i, j + 1, k) || free(i, j, k - 1) || free(i, j, k + 1)) {
      out[index] = 1;
    }
  }
  return out;
}

/** 1 for voxels whose centre lies inside `bound`. */
export function boxMask(grid: VoxelGridSpec, bound: Bounds): Uint8Array {
  const [nx, ny, nz] = grid.dims;
  const mask = new Uint8Array(nx * ny * nz);
  const r = grid.resolution;
  const range = (a: number): [number, number] => [
    Math.max(0, Math.ceil((bound.min[a] - grid.origin[a]) / r - 0.5)),
    Math.min(grid.dims[a] - 1, Math.floor((bound.max[a] - grid.origin[a]) / r - 0.5)),
  ];
  const [i0, i1] = range(0);
  const [j0, j1] = range(1);
  const [k0, k1] = range(2);
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) mask[voxelIndex(grid, i, j, k)] = 1;
  return mask;
}
