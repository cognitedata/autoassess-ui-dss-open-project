import { describe, expect, it } from 'vitest';

import type { Bounds, Vec3 } from '../domain/types';
import { GBPLANNER_CONFIGS } from './configs';
import { createGrid, voxelCenter, voxelIndex, voxelOf } from './grid';
import { createRng, dist } from './math';
import { buildRrg, CollisionChecker, Graph, mergeInto, pathTo, truncatePath } from './rrg';
import { FREE, OCCUPIED, VoxelMap } from './voxelMap';

const CONFIG = GBPLANNER_CONFIGS.bwt_inspection;
const HALF = CONFIG.robotSize[0] / 2;

describe(Graph.name, () => {
  it('should find shortest paths with Dijkstra', () => {
    const g = new Graph(1);
    const a = g.addVertex([0, 0, 0]);
    const b = g.addVertex([1, 0, 0]);
    const c = g.addVertex([1, 1, 0]);
    const d = g.addVertex([5, 5, 0]);
    g.addEdge(a, b);
    g.addEdge(b, c);
    g.addEdge(a, c);

    const { dist: d0, prev } = g.dijkstra(a);

    expect(d0[c]).toBeCloseTo(Math.SQRT2);
    expect(pathTo(prev, c)).toEqual([a, c]);
    expect(d0[d]).toBe(Infinity);
    expect(pathTo(prev, d)).toEqual([]);
    expect(g.within([0.9, 0.1, 0], 0.5)).toEqual([b]);
  });
});

describe(truncatePath.name, () => {
  it('should cut a path to a maximum length', () => {
    const cut = truncatePath([[0, 0, 0], [3, 0, 0], [3, 4, 0]], 5);

    expect(cut).toEqual([[0, 0, 0], [3, 0, 0], [3, 2, 0]]);
    expect(truncatePath([[0, 0, 0], [1, 0, 0]], 5)).toEqual([[0, 0, 0], [1, 0, 0]]);
  });
});

describe(buildRrg.name, () => {
  it('should build the same graph for the same seed', () => {
    const map = boxMap({ knownUpToX: 6 });

    const a = buildRrg(input(map, 7));
    const b = buildRrg(input(map, 7));
    const c = buildRrg(input(map, 8));

    expect(a.graph.positions).toEqual(b.graph.positions);
    expect(a.graph.positions).not.toEqual(c.graph.positions);
    expect(a.graph.size).toBeGreaterThan(20);
  });

  it('should never connect vertices through known obstacles', () => {
    const map = boxMap({ knownUpToX: 6, wallAtX: 3 });

    const result = buildRrg(input(map, 3));

    const fresh = new CollisionChecker(map, HALF);
    for (const [a, b] of result.graph.edges()) {
      expect(fresh.segmentFree(result.graph.positions[a], result.graph.positions[b])).toBe(true);
      // Nothing crosses the (known, solid) wall at x = 3.
      const [xa, xb] = [result.graph.positions[a][0], result.graph.positions[b][0]];
      expect((xa - 3) * (xb - 3) > 0 || Math.min(xa, xb) > 3.2 || Math.max(xa, xb) < 2.8).toBe(true);
    }
  });

  it('should head for the unknown part of the map', () => {
    // Known up to x = 4.5, unknown beyond: the best path must end towards +x.
    const map = boxMap({ knownUpToX: 4.5 });

    const result = buildRrg({ ...input(map, 5), root: [2, 1, 1] });

    expect(result.exhausted).toBe(false);
    const end = result.graph.positions[result.bestPath[result.bestPath.length - 1]];
    expect(end[0]).toBeGreaterThan(3);
    expect(result.bestPath[0]).toBe(0);
  });

  it('should report exhaustion when nothing unknown is left', () => {
    const map = boxMap({ knownUpToX: 99 });

    const result = buildRrg(input(map, 5));

    expect(result.exhausted).toBe(true);
    expect(result.bestGain).toBeLessThan(result.gainThreshold);
  });

  it('should pick the vertex closest to a goal in target-reach mode', () => {
    const map = boxMap({ knownUpToX: 99 });

    const result = buildRrg({ ...input(map, 2), root: [1, 1, 1], goal: [5, 1, 1] });

    const end = result.graph.positions[result.bestPath[result.bestPath.length - 1]];
    expect(dist(end, [5, 1, 1])).toBeLessThan(1);
  });
});

describe(mergeInto.name, () => {
  it('should add a local graph to the global one, reusing nearby vertices', () => {
    const map = boxMap({ knownUpToX: 99 });
    const checker = new CollisionChecker(map, HALF);
    const global = new Graph(1);
    global.addVertex([1, 1, 1]);
    const local = new Graph(1);
    const a = local.addVertex([1.05, 1, 1]);
    const b = local.addVertex([2, 1, 1]);
    local.addEdge(a, b);

    const mapping = mergeInto(global, local, 0.4, checker);

    expect(mapping).toEqual([0, 1]);
    expect(global.size).toBe(2);
    expect(global.edges()).toEqual([[0, 1]]);
  });
});

/** 6 x 2 x 2 m closed box (0.1 m voxels), known (free/occupied) up to x = knownUpToX. */
function boxMap({ knownUpToX, wallAtX }: { knownUpToX: number; wallAtX?: number }): VoxelMap {
  const grid = createGrid({ min: [0, 0, 0], max: [6, 2, 2] }, 0.1, 1e6);
  const [nx, ny, nz] = grid.dims;
  const truth = new Uint8Array(nx * ny * nz);
  const wall = wallAtX === undefined ? -1 : voxelOf(grid, [wallAtX + 0.01, 1, 1])![0];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const shell = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
        if (shell || i === wall) truth[voxelIndex(grid, i, j, k)] = 1;
      }
  const map = new VoxelMap(grid, truth);
  for (let index = 0; index < truth.length; index++) {
    if (voxelCenter(grid, index)[0] > knownUpToX) continue;
    map.state[index] = truth[index] ? OCCUPIED : FREE;
  }
  return map;
}

function input(map: VoxelMap, seed: number) {
  const box: Bounds = { min: [0, 0, 0], max: [6, 2, 2] };
  return {
    map,
    checker: new CollisionChecker(map, HALF),
    root: [1, 1, 1] as Vec3,
    sampleBox: box,
    config: CONFIG,
    rng: createRng(seed),
  };
}
