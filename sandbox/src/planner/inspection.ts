import type { Bounds, Vec3 } from '../domain/types';
import type { GbPlannerConfig } from './configs';
import { gridBox } from './grid';
import { rotateDirection } from './math';
import type { CollisionChecker, Graph } from './rrg';
import { pathTo } from './rrg';
import { boxMask, castRay, cameraDirections, OCCUPIED, UNKNOWN } from './voxelMap';
import type { VoxelMap } from './voxelMap';

/**
 * Inspection planning in the spirit of gbplanner's BWT mode: cover the *mapped* surfaces with
 * the inspection camera. Candidate viewpoints are sampled in known free space; greedy set cover
 * picks viewpoints until min_coverage_percentage (or max_inspection_vertices); the tour is ordered
 * nearest-neighbour + 2-opt over global-graph distances and flown along the graph.
 */
export interface InspectionInput {
  map: VoxelMap;
  checker: CollisionChecker;
  /** The persistent global graph (picked viewpoints are added to it). */
  graph: Graph;
  /** Where the tour starts (a vertex of `graph`). */
  startVertex: number;
  bound: Bounds | null;
  config: GbPlannerConfig;
  rng: () => number;
}

export interface PlannedViewpoint {
  position: Vec3;
  yaw: number;
  pitch: number;
  vertex: number;
  /** Graph path from the previous stop (or the start) to this viewpoint. */
  leg: Vec3[];
}

export interface InspectionPlan {
  viewpoints: PlannedViewpoint[];
  expectedCoveragePct: number;
  knownSurface: number;
}

interface Candidate {
  position: Vec3;
  yaw: number;
  pitch: number;
  covers: Int32Array;
  /** Existing global vertex (graph candidates) or null (connect when picked). */
  vertex: number | null;
}

export function planInspection(input: InspectionInput): InspectionPlan {
  const { map, checker, graph, startVertex, bound, config, rng } = input;
  const mask = bound ? boxMask(map.grid, bound) : null;

  // Universe: known surface voxels in the bound that the camera hasn't seen yet.
  const universeId = new Int32Array(map.state.length).fill(-1);
  let knownSurface = 0;
  let inspected = 0;
  let universe = 0;
  for (let i = 0; i < map.state.length; i++) {
    if ((mask && !mask[i]) || map.state[i] !== OCCUPIED || !map.surface[i]) continue;
    knownSurface++;
    if (map.inspectedAt[i] >= 0) inspected++;
    else universeId[i] = universe++;
  }
  const needed = Math.ceil(config.minCoveragePercentage * knownSurface) - inspected;
  const pct = (covered: number) => (knownSurface ? (100 * (inspected + covered)) / knownSurface : 0);
  if (needed <= 0 || universe === 0) return { viewpoints: [], expectedCoveragePct: pct(0), knownSurface };

  // Candidate positions: global graph vertices and random samples in known free space.
  const box = intersect(bound ?? gridBox(map.grid), map.knownFreeBox() ?? gridBox(map.grid));
  const positions: Array<{ p: Vec3; vertex: number | null }> = [];
  const n = config.sim.inspectionCandidates;
  const graphIds = graph.positions.map((_, id) => id).filter((id) => !mask || inBox(graph.positions[id], box));
  for (let i = 0; i < Math.floor(n / 3) && graphIds.length; i++) {
    const id = graphIds.splice(Math.floor(rng() * graphIds.length), 1)[0];
    positions.push({ p: graph.positions[id], vertex: id });
  }
  for (let attempt = 0; attempt < n * 30 && positions.length < n; attempt++) {
    const p: Vec3 = [0, 1, 2].map((a) => box.min[a] + rng() * (box.max[a] - box.min[a])) as Vec3;
    if (!checker.pointFree(p) || !canConnect(graph, p, config.nearestRangeM, checker)) continue;
    positions.push({ p, vertex: null });
  }

  const candidates: Candidate[] = [];
  const stamp = new Int32Array(universe);
  let stampId = 0;
  const yaws = Array.from({ length: config.sim.inspectionYaws }, (_, i) => -Math.PI + (2 * Math.PI * i) / config.sim.inspectionYaws);
  for (const { p, vertex } of positions) {
    for (const yaw of yaws) {
      for (const pitch of config.sim.inspectionPitchesRad) {
        stampId++;
        const covers: number[] = [];
        for (const d of cameraDirections(map.grid, config.camera)) {
          castRay(map.grid, p, rotateDirection(d, yaw, pitch), config.inspectionViewingRangeM, (index, at) => {
            const s = map.state[index];
            if (s === UNKNOWN) return false;
            if (s !== OCCUPIED) return true;
            const u = universeId[index];
            if (u >= 0 && at >= config.camera.minRangeM && stamp[u] !== stampId) {
              stamp[u] = stampId;
              covers.push(u);
            }
            return false;
          });
        }
        if (covers.length >= 3) candidates.push({ position: p, yaw, pitch, covers: Int32Array.from(covers), vertex });
      }
    }
  }

  // Greedy set cover, then connect the picks to the graph.
  const picks = greedyCover(candidates, needed, config.maxInspectionVertices);
  const stops: Array<{ c: Candidate; vertex: number }> = [];
  for (const index of picks) {
    const c = candidates[index];
    const vertex = c.vertex ?? connect(graph, c.position, config.nearestRangeM, checker);
    if (vertex !== null) stops.push({ c, vertex });
  }

  // Order: graph distances, nearest neighbour from the start, then 2-opt.
  const fromStart = graph.dijkstra(startVertex);
  const reachable = stops.filter((s) => Number.isFinite(fromStart.dist[s.vertex]));
  const trees = reachable.map((s) => graph.dijkstra(s.vertex));
  const d = (a: number, b: number) => trees[a].dist[reachable[b].vertex];
  const s0 = (a: number) => fromStart.dist[reachable[a].vertex];
  const order = twoOpt(nearestNeighbourOrder(reachable.length, d, s0), d, s0);

  const covered = new Uint8Array(universe);
  let coveredCount = 0;
  const viewpoints: PlannedViewpoint[] = [];
  let prevTree = fromStart;
  let prevVertex = startVertex;
  for (const i of order) {
    const { c, vertex } = reachable[i];
    for (const u of c.covers) {
      if (!covered[u]) {
        covered[u] = 1;
        coveredCount++;
      }
    }
    const leg = pathTo(prevTree.prev, vertex, prevVertex).map((v) => graph.positions[v]);
    viewpoints.push({ position: graph.positions[vertex], yaw: c.yaw, pitch: c.pitch, vertex, leg });
    prevTree = trees[i];
    prevVertex = vertex;
  }
  return { viewpoints, expectedCoveragePct: pct(coveredCount), knownSurface };
}

/**
 * Lazy greedy set cover: repeatedly takes the set adding the most uncovered elements until
 * `target` elements are covered, `maxPicks` sets are taken, or nothing adds anything.
 */
export function greedyCover(sets: ReadonlyArray<{ covers: ArrayLike<number> }>, target: number, maxPicks: number): number[] {
  const covered = new Set<number>();
  const gainOf = (i: number) => {
    let g = 0;
    const c = sets[i].covers;
    for (let k = 0; k < c.length; k++) if (!covered.has(c[k])) g++;
    return g;
  };
  // Max-heap by (stale) gain; ties by index for determinism.
  const heap: Array<[number, number]> = sets.map((s, i) => [s.covers.length, i]);
  heap.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const picks: number[] = [];
  while (covered.size < target && picks.length < maxPicks && heap.length) {
    const [, i] = heap.shift()!;
    const g = gainOf(i);
    if (g === 0) continue;
    const next = heap[0];
    if (next && g < next[0]) {
      insertSorted(heap, [g, i]);
      continue;
    }
    picks.push(i);
    const c = sets[i].covers;
    for (let k = 0; k < c.length; k++) covered.add(c[k]);
  }
  return picks;
}

/** Open tour from a start point: always go to the closest unvisited stop. */
export function nearestNeighbourOrder(n: number, d: (a: number, b: number) => number, fromStart: (a: number) => number): number[] {
  const left = new Set(Array.from({ length: n }, (_, i) => i));
  const order: number[] = [];
  let here = -1;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const di = here < 0 ? fromStart(i) : d(here, i);
      if (di < bestD || best < 0) [best, bestD] = [i, di];
    }
    order.push(best);
    left.delete(best);
    here = best;
  }
  return order;
}

/** 2-opt on an open tour with a fixed start: reverse segments while that shortens the tour. */
export function twoOpt(order: readonly number[], d: (a: number, b: number) => number, fromStart: (a: number) => number): number[] {
  const tour = [...order];
  const n = tour.length;
  const edge = (j: number) => (j >= n - 1 ? 0 : d(tour[j], tour[j + 1]));
  const before = (i: number) => (i === 0 ? fromStart(tour[0]) : d(tour[i - 1], tour[i]));
  let improved = true;
  for (let round = 0; improved && round < 50; round++) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const oldCost = before(i) + edge(j);
        const newIn = i === 0 ? fromStart(tour[j]) : d(tour[i - 1], tour[j]);
        const newOut = j >= n - 1 ? 0 : d(tour[i], tour[j + 1]);
        if (newIn + newOut < oldCost - 1e-9) {
          reverse(tour, i, j);
          improved = true;
        }
      }
    }
  }
  return tour;
}

export function tourLength(order: readonly number[], d: (a: number, b: number) => number, fromStart: (a: number) => number): number {
  if (!order.length) return 0;
  let total = fromStart(order[0]);
  for (let i = 1; i < order.length; i++) total += d(order[i - 1], order[i]);
  return total;
}

function reverse(a: number[], i: number, j: number): void {
  while (i < j) {
    [a[i], a[j]] = [a[j], a[i]];
    i++;
    j--;
  }
}

function insertSorted(heap: Array<[number, number]>, item: [number, number]): void {
  let lo = 0;
  let hi = heap.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const m = heap[mid];
    if (m[0] > item[0] || (m[0] === item[0] && m[1] < item[1])) lo = mid + 1;
    else hi = mid;
  }
  heap.splice(lo, 0, item);
}

function canConnect(graph: Graph, p: Vec3, radius: number, checker: CollisionChecker): boolean {
  return graph.within(p, radius).some((v) => checker.segmentFree(p, graph.positions[v]));
}

function connect(graph: Graph, p: Vec3, radius: number, checker: CollisionChecker): number | null {
  const neighbours = graph.within(p, radius).filter((v) => checker.segmentFree(p, graph.positions[v])).slice(0, 4);
  if (!neighbours.length) return null;
  const id = graph.addVertex(p);
  for (const v of neighbours) graph.addEdge(id, v);
  return id;
}

function intersect(a: Bounds, b: Bounds): Bounds {
  return {
    min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
    max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
  };
}

function inBox(p: Vec3, box: Bounds): boolean {
  return p.every((v, a) => v >= box.min[a] && v <= box.max[a]);
}
