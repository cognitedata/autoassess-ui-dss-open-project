import { boundsAround } from '../domain/bounds';
import type { Bounds, Vec3 } from '../domain/types';
import type { VoxelGridSpec } from './types';

/** Smallest world box edge (m): the robot (0.4 m) must fit with room to move. */
export const MIN_WORLD_SIZE_M = 2;

/** Grid over `box`: `baseResolution` unless that would exceed `maxVoxels` (then coarser). */
export function createGrid(box: Bounds, baseResolution: number, maxVoxels: number): VoxelGridSpec {
  const size = [0, 1, 2].map((a) => box.max[a] - box.min[a]);
  const volume = size[0] * size[1] * size[2];
  let resolution = Math.max(baseResolution, Math.cbrt(volume / maxVoxels));
  resolution = Math.ceil(resolution * 1000) / 1000;
  const dimsFor = (r: number) => size.map((s) => Math.max(3, Math.ceil(s / r - 1e-6))) as [number, number, number];
  let dims = dimsFor(resolution);
  while (dims[0] * dims[1] * dims[2] > maxVoxels) {
    resolution = Math.ceil(resolution * 1.05 * 1000) / 1000;
    dims = dimsFor(resolution);
  }
  return { origin: [box.min[0], box.min[1], box.min[2]], resolution, dims };
}

export function voxelIndex(grid: VoxelGridSpec, i: number, j: number, k: number): number {
  return i + grid.dims[0] * (j + grid.dims[1] * k);
}

export function voxelCoords(grid: VoxelGridSpec, index: number): [number, number, number] {
  const [nx, ny] = grid.dims;
  const i = index % nx;
  const j = Math.floor(index / nx) % ny;
  const k = Math.floor(index / (nx * ny));
  return [i, j, k];
}

/** Voxel containing `p`, or null outside the grid. */
export function voxelOf(grid: VoxelGridSpec, p: Vec3): [number, number, number] | null {
  const out: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const v = Math.floor((p[a] - grid.origin[a]) / grid.resolution);
    if (v < 0 || v >= grid.dims[a]) return null;
    out[a] = v;
  }
  return out;
}

export function voxelCenter(grid: VoxelGridSpec, index: number): Vec3 {
  const [i, j, k] = voxelCoords(grid, index);
  const r = grid.resolution;
  return [grid.origin[0] + (i + 0.5) * r, grid.origin[1] + (j + 0.5) * r, grid.origin[2] + (k + 0.5) * r];
}

export function gridBox(grid: VoxelGridSpec): Bounds {
  const r = grid.resolution;
  return {
    min: [...grid.origin],
    max: [grid.origin[0] + grid.dims[0] * r, grid.origin[1] + grid.dims[1] * r, grid.origin[2] + grid.dims[2] * r],
  };
}

/**
 * The simulated world: the area bounds, or (an area without structural elements has none) a box
 * around `fallbackPoints` (home, task targets) with 1 m margin. Every edge is at least
 * MIN_WORLD_SIZE_M so odd live areas (flat or tiny element clouds) still give a flyable tank.
 */
export function worldBox(bounds: Bounds | null, fallbackPoints: readonly Vec3[]): Bounds {
  const box = bounds ?? boundsAround(fallbackPoints, 1) ?? { min: [-2, -2, -1], max: [2, 2, 1] };
  const min: Vec3 = [...box.min];
  const max: Vec3 = [...box.max];
  for (let a = 0; a < 3; a++) {
    const size = max[a] - min[a];
    if (size < MIN_WORLD_SIZE_M) {
      const c = (min[a] + max[a]) / 2;
      min[a] = c - MIN_WORLD_SIZE_M / 2;
      max[a] = c + MIN_WORLD_SIZE_M / 2;
    }
  }
  return { min, max };
}
