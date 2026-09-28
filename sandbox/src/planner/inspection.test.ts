import { describe, expect, it } from 'vitest';

import type { Vec3 } from '../domain/types';
import { GBPLANNER_CONFIGS } from './configs';
import { createGrid, voxelIndex } from './grid';
import { greedyCover, nearestNeighbourOrder, planInspection, tourLength, twoOpt } from './inspection';
import { createRng, dist } from './math';
import { CollisionChecker, Graph } from './rrg';
import { FREE, OCCUPIED, VoxelMap } from './voxelMap';

const CONFIG = GBPLANNER_CONFIGS.bwt_inspection;

describe(greedyCover.name, () => {
  it('should pick the sets that cover the most new elements first and stop at the target', () => {
    const sets = [{ covers: [1, 2] }, { covers: [1, 2, 3, 4] }, { covers: [5] }, { covers: [4, 5, 6] }];

    expect(greedyCover(sets, 6, 10)).toEqual([1, 3]);
    expect(greedyCover(sets, 4, 10)).toEqual([1]);
    expect(greedyCover(sets, 6, 1)).toEqual([1]);
  });
});

describe(twoOpt.name, () => {
  it('should never make a nearest-neighbour tour longer, and untangle a crossing', () => {
    const rng = createRng(11);
    const points: Vec3[] = Array.from({ length: 30 }, () => [rng() * 10, rng() * 10, rng() * 2]);
    const d = (a: number, b: number) => dist(points[a], points[b]);
    const fromStart = (a: number) => dist([0, 0, 0], points[a]);

    const nn = nearestNeighbourOrder(points.length, d, fromStart);
    const improved = twoOpt(nn, d, fromStart);

    expect([...improved].sort((a, b) => a - b)).toEqual([...nn].sort((a, b) => a - b));
    expect(tourLength(improved, d, fromStart)).toBeLessThanOrEqual(tourLength(nn, d, fromStart) + 1e-9);

    const square: Vec3[] = [[1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0.1, 0]];
    const ds = (a: number, b: number) => dist(square[a], square[b]);
    const s0 = (a: number) => dist([0, 0, 0], square[a]);
    const crossing = [0, 1, 2, 3];
    expect(tourLength(twoOpt(crossing, ds, s0), ds, s0)).toBeLessThan(tourLength(crossing, ds, s0));
  });
});

describe(planInspection.name, () => {
  it('should plan viewpoints that cover at least 90% of a mapped box interior', () => {
    const map = knownBox();
    const graph = new Graph(CONFIG.nearestRangeM);
    const start: Vec3 = [1.5, 1, 1];
    graph.addVertex(start);

    const plan = planInspection({
      map,
      checker: new CollisionChecker(map, CONFIG.robotSize[0] / 2),
      graph,
      startVertex: 0,
      bound: null,
      config: CONFIG,
      rng: createRng(1),
    });

    expect(plan.viewpoints.length).toBeGreaterThan(3);
    expect(plan.viewpoints.length).toBeLessThanOrEqual(CONFIG.maxInspectionVertices);
    expect(plan.expectedCoveragePct).toBeGreaterThanOrEqual(90);
    // Fly it (camera only) and measure.
    for (const vp of plan.viewpoints) map.integrateCamera(vp.position, vp.yaw, vp.pitch, CONFIG.camera, 1);
    expect(map.stats(null).coveragePct).toBeGreaterThanOrEqual(85);
    // Every leg starts where the previous one ended.
    for (let i = 1; i < plan.viewpoints.length; i++) {
      expect(plan.viewpoints[i].leg[0]).toEqual(plan.viewpoints[i - 1].position);
    }
  });

  it('should plan nothing when the surfaces are already inspected', () => {
    const map = knownBox();
    map.inspectedAt.fill(0);
    const graph = new Graph(CONFIG.nearestRangeM);
    graph.addVertex([1.5, 1, 1]);

    const plan = planInspection({
      map,
      checker: new CollisionChecker(map, 0.2),
      graph,
      startVertex: 0,
      bound: null,
      config: CONFIG,
      rng: createRng(1),
    });

    expect(plan.viewpoints).toEqual([]);
  });
});

/** 3 x 2 x 2 m closed box (0.15 m voxels), fully mapped. */
function knownBox(): VoxelMap {
  const grid = createGrid({ min: [0, 0, 0], max: [3, 2, 2] }, 0.15, 1e6);
  const [nx, ny, nz] = grid.dims;
  const truth = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) truth[voxelIndex(grid, i, j, k)] = 1;
      }
  const map = new VoxelMap(grid, truth);
  for (let i = 0; i < truth.length; i++) map.state[i] = truth[i] ? OCCUPIED : FREE;
  return map;
}
