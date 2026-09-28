import { describe, expect, it } from 'vitest';

import type { Vec3 } from '../domain/types';
import type { SensorConfig } from './configs';
import { createGrid, voxelIndex, voxelOf } from './grid';
import type { VoxelGridSpec } from './types';
import { FREE, OCCUPIED, UNKNOWN, VoxelMap } from './voxelMap';

const DEG = Math.PI / 180;
/** One ray straight ahead. */
const PENCIL: SensorConfig = { maxRangeM: 3.5, minRangeM: 0, hFovRad: 0, vFovRad: 0, resolutionRad: DEG };
const CAMERA: SensorConfig = { maxRangeM: 1.5, minRangeM: 0.25, hFovRad: 80 * DEG, vFovRad: 60 * DEG, resolutionRad: 5 * DEG };
const LIDAR: SensorConfig = { maxRangeM: 3.5, minRangeM: 0, hFovRad: 2 * Math.PI, vFovRad: 90 * DEG, resolutionRad: 10 * DEG };

describe(VoxelMap.name, () => {
  it('should mark voxels free along a ray and occupied where it hits', () => {
    const { grid, map } = corridorWithWallAt(2.5);

    map.integrateScan([0.55, 0.55, 0.55], 0, 0, PENCIL, 4);

    expect(stateAt(map, grid, [1.0, 0.55, 0.55])).toBe(FREE);
    expect(stateAt(map, grid, [2.45, 0.55, 0.55])).toBe(FREE);
    expect(stateAt(map, grid, [2.55, 0.55, 0.55])).toBe(OCCUPIED);
    expect(stateAt(map, grid, [2.75, 0.55, 0.55])).toBe(UNKNOWN);
    expect(map.seenAt[index(grid, [2.55, 0.55, 0.55])]).toBe(4);
  });

  it('should not see past the sensor range', () => {
    const { grid, map } = corridorWithWallAt(2.5);

    map.integrateScan([0.55, 0.55, 0.55], 0, 0, { ...PENCIL, maxRangeM: 1 }, 0);

    expect(stateAt(map, grid, [1.4, 0.55, 0.55])).toBe(FREE);
    expect(stateAt(map, grid, [1.8, 0.55, 0.55])).toBe(UNKNOWN);
    expect(stateAt(map, grid, [2.55, 0.55, 0.55])).toBe(UNKNOWN);
  });

  it('should only see inside the field of view', () => {
    const { grid, map } = corridorWithWallAt(2.5);

    // Looking along -y (yaw -90°) with an 80° camera: the wall ahead in +x stays unknown.
    map.integrateScan([0.55, 0.55, 0.55], -Math.PI / 2, 0, CAMERA, 0);

    expect(stateAt(map, grid, [0.55, 0.2, 0.55])).toBe(FREE);
    expect(stateAt(map, grid, [1.6, 0.55, 0.55])).toBe(UNKNOWN);
  });

  it('should only clear voxels that are really free', () => {
    const { grid, map } = corridorWithWallAt(2.5);

    map.markFree([2.5, 0.5, 0.5], 0.3, 1);

    expect(stateAt(map, grid, [2.3, 0.55, 0.55])).toBe(FREE);
    expect(stateAt(map, grid, [2.55, 0.55, 0.55])).toBe(UNKNOWN);
  });

  it('should count unknown voxels a viewpoint would see, and none once everything is mapped', () => {
    const { map } = closedBox();
    const p: Vec3 = [1.5, 1, 1];

    const before = map.visibleUnknown(p, LIDAR);
    map.integrateScan(p, 0, 0, LIDAR, 0);
    for (const q of [[0.5, 0.5, 0.5], [2.5, 1.5, 1.5], [0.5, 1.5, 0.5], [2.5, 0.5, 1.5]] as Vec3[]) {
      map.integrateScan(q, 0, 0, LIDAR, 0);
    }

    expect(before).toBeGreaterThan(100);
    expect(map.visibleUnknown(p, LIDAR)).toBeLessThan(before / 5);
  });

  it('should report explored and surface coverage percentages', () => {
    const { map } = closedBox();

    map.integrateScan([1.5, 1, 1], 0, 0, LIDAR, 0);
    const mapped = map.stats(null);
    map.integrateCamera([1.5, 1, 1], 0, 0, CAMERA, 2);
    const inspected = map.stats(null);

    expect(mapped.exploredPct).toBeGreaterThan(20);
    expect(mapped.coveragePct).toBe(0);
    expect(inspected.coveragePct).toBeGreaterThan(0);
    expect(inspected.coveragePct).toBeLessThan(100);
  });

  it('should check line of sight against the ground truth', () => {
    const { map } = corridorWithWallAt(2.5);

    expect(map.lineOfSight([0.55, 0.55, 0.55], [2.0, 0.55, 0.55])).toBe(true);
    expect(map.lineOfSight([0.55, 0.55, 0.55], [2.9, 0.55, 0.55])).toBe(false);
    // A target on the wall surface itself is visible.
    expect(map.lineOfSight([0.55, 0.55, 0.55], [2.52, 0.55, 0.55])).toBe(true);
  });

  it('should say a robot-sized box is free only when all its voxels are known free', () => {
    const { map } = closedBox();
    const p: Vec3 = [1.5, 1, 1];

    expect(map.isBoxFree(p, 0.2)).toBe(false);
    map.markFree(p, 0.3, 0);
    map.markFree([0.1, 1, 1], 0.3, 0);

    expect(map.isBoxFree(p, 0.2)).toBe(true);
    // Next to the wall: the box reaches into the (never free) shell.
    expect(map.isBoxFree([0.1, 1, 1], 0.2)).toBe(false);
  });

  it('should export the map with copies of its arrays', () => {
    const { map } = closedBox();
    map.integrateScan([1.5, 1, 1], 0, 0, LIDAR, 3);

    const exported = map.toPlannerMap();
    map.integrateScan([0.5, 0.5, 0.5], 0, 0, LIDAR, 9);

    expect(exported.seenAt).not.toBe(map.seenAt);
    expect(Array.from(exported.seenAt).includes(9)).toBe(false);
    expect(exported.dims).toEqual(map.grid.dims);
  });
});

/** 3 x 1 x 1 m corridor (0.1 m voxels) with a wall across x at `wallX`, open elsewhere. */
function corridorWithWallAt(wallX: number): { grid: VoxelGridSpec; map: VoxelMap } {
  const grid = createGrid({ min: [0, 0, 0], max: [3, 1.1, 1.1] }, 0.1, 1e6);
  const truth = new Uint8Array(grid.dims[0] * grid.dims[1] * grid.dims[2]);
  const wi = voxelOf(grid, [wallX + 0.01, 0, 0])![0];
  for (let k = 0; k < grid.dims[2]; k++) for (let j = 0; j < grid.dims[1]; j++) truth[voxelIndex(grid, wi, j, k)] = 1;
  return { grid, map: new VoxelMap(grid, truth) };
}

/** 3 x 2 x 2 m box with a closed shell (0.1 m voxels). */
function closedBox(): { grid: VoxelGridSpec; map: VoxelMap } {
  const grid = createGrid({ min: [0, 0, 0], max: [3, 2, 2] }, 0.1, 1e6);
  const [nx, ny, nz] = grid.dims;
  const truth = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) truth[voxelIndex(grid, i, j, k)] = 1;
      }
  return { grid, map: new VoxelMap(grid, truth) };
}

function index(grid: VoxelGridSpec, p: Vec3): number {
  const v = voxelOf(grid, p);
  if (!v) throw new Error('outside');
  return voxelIndex(grid, ...v);
}

function stateAt(map: VoxelMap, grid: VoxelGridSpec, p: Vec3): number {
  return map.state[index(grid, p)];
}
