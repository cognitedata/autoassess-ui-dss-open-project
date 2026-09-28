import { describe, expect, it } from 'vitest';

import { withAreaBounds } from '../data/SnapshotSource';
import { DEMO_AREAS, DEMO_ELEMENTS } from '../data/demoFixture';
import type { Bounds, Vec3 } from '../domain/types';
import { voxelIndex, voxelOf } from './grid';
import type { TankElement } from './syntheticTank';
import { buildSyntheticTank, initMotionPath } from './syntheticTank';

const BOX: Bounds = { min: [0, -2, 0], max: [9, 2, 3] };
const INIT = { zTakeoffM: 1.2, zDropM: 0.5, xForwardM: 0.7 };

describe(buildSyntheticTank.name, () => {
  it('should close the shell on every side when there is no home hatch', () => {
    const tank = buildSyntheticTank(BOX, [], { home: null, initMotion: INIT });

    const [nx, ny, nz] = tank.grid.dims;
    let open = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const boundary = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
          if (boundary && !tank.occupied[voxelIndex(tank.grid, i, j, k)]) open++;
        }
    expect(open).toBe(0);
    expect(occupiedAt(tank, [4.5, 0, 1.5])).toBe(false);
  });

  it('should fall back to a plain box tank for an area without elements', () => {
    const tank = buildSyntheticTank(BOX, [], { home: null, initMotion: INIT });

    expect(tank.frames).toEqual([]);
    expect(tank.description).toMatch(/box/);
  });

  it('should cut an access hatch in the shell at a home on the wall, and keep the init path free', () => {
    const home: Vec3 = [0, 0, 0];
    const tank = buildSyntheticTank(BOX, [], { home, initMotion: INIT });

    expect(tank.hatch).not.toBeNull();
    expect(occupiedAt(tank, [0.01, 0, 1.2])).toBe(false);
    expect(occupiedAt(tank, [0.01, 1.5, 1.2])).toBe(true);
    const [, , init] = initMotionPath(BOX, home, INIT);
    expect(init[0]).toBeCloseTo(0.7);
    expect(occupiedAt(tank, init)).toBe(false);
  });

  it('should put transverse frames between compartments, with holes at the manholes', () => {
    const elements: TankElement[] = [
      { elementType: 'compartment', center: [1.5, 0, 1.5] },
      { elementType: 'compartment', center: [4.5, 0, 1.5] },
      { elementType: 'compartment', center: [7.5, 0, 1.5] },
      { elementType: 'manhole', center: [3.1, 0.8, 1.0] },
    ];

    const tank = buildSyntheticTank(BOX, elements, { home: null, initMotion: INIT });

    expect(tank.frames.map((x) => Math.round(x * 10) / 10)).toEqual([3, 6]);
    // Frame at x=3: plate everywhere but the manhole hole.
    expect(occupiedAt(tank, [3, -1, 2])).toBe(true);
    expect(occupiedAt(tank, [3, 0.8, 1.0])).toBe(false);
    // Frame at x=6 has no manhole element: it still gets a default opening so the tank is connected.
    expect(tank.openings.length).toBe(2);
    const [opening] = tank.openings.filter((o) => Math.abs(o.center[0] - 6) < 0.2);
    expect(occupiedAt(tank, opening.center)).toBe(false);
  });

  it('should add longitudinals as bars along x and walls as plates', () => {
    const elements: TankElement[] = [
      { elementType: 'longitudinal', center: [6, 1.5, 2.5] },
      { elementType: 'wall', center: [2, -1.2, 1.2] },
    ];

    const tank = buildSyntheticTank(BOX, elements, { home: null, initMotion: INIT });

    expect(occupiedAt(tank, [5.5, 1.5, 2.5])).toBe(true);
    expect(occupiedAt(tank, [6.5, 1.5, 2.5])).toBe(true);
    expect(occupiedAt(tank, [7.5, 1.5, 2.5])).toBe(false);
    expect(occupiedAt(tank, [2, -1.0, 1.4])).toBe(true);
    expect(occupiedAt(tank, [2, 0.2, 1.2])).toBe(false);
    expect(tank.bars).toBe(1);
    expect(tank.plates).toBe(1);
  });

  it('should build the demo BWT 3P tank with four frames and passable manholes, under the voxel cap', () => {
    const area = withAreaBounds(DEMO_AREAS, DEMO_ELEMENTS).find((a) => a.externalId === 'demo-area-bwt3p');
    const elements = DEMO_ELEMENTS.filter((e) => e.areaExternalId === 'demo-area-bwt3p');

    const tank = buildSyntheticTank(area!.bounds!, elements, { home: [area!.bounds!.min[0], 0.175, area!.bounds!.min[2]], initMotion: INIT });

    expect(tank.frames.length).toBe(4);
    expect(tank.openings.length).toBeGreaterThanOrEqual(4);
    expect(tank.grid.dims[0] * tank.grid.dims[1] * tank.grid.dims[2]).toBeLessThanOrEqual(300_000);
    for (const o of tank.openings) expect(occupiedAt(tank, o.center)).toBe(false);
  });
});

function occupiedAt(tank: ReturnType<typeof buildSyntheticTank>, p: Vec3): boolean {
  const v = voxelOf(tank.grid, p);
  if (!v) throw new Error(`outside the grid: ${p.join(', ')}`);
  return tank.occupied[voxelIndex(tank.grid, ...v)] === 1;
}
