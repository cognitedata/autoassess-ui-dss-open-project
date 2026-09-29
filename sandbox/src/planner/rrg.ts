import type { Bounds, Vec3 } from '../domain/types';
import type { GbPlannerConfig } from './configs';
import { voxelIndex, voxelOf } from './grid';
import { dist, lerp } from './math';
import { directionCount } from './voxelMap';
import type { VoxelMap } from './voxelMap';

/**
 * Random-sampled graph (RRG) planning in the spirit of gbplanner: vertices are sampled in the
 * local bound, must be collision-free in *known* free space (unknown counts as blocked), and are
 * connected to their nearest neighbours; Dijkstra from the root gives the paths; the best path
 * maximises volumetric gain (unknown voxels visible) with a path-length discount.
 */

/** An undirected graph with Euclidean edge weights and a spatial hash for neighbour queries. */
export class Graph {
  readonly positions: Vec3[] = [];
  readonly adjacency: Array<Array<{ to: number; w: number }>> = [];
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly cellSize: number) {}

  get size(): number {
    return this.positions.length;
  }

  addVertex(p: Vec3): number {
    const id = this.positions.length;
    this.positions.push([p[0], p[1], p[2]]);
    this.adjacency.push([]);
    const key = this.cellKey(p);
    const cell = this.cells.get(key);
    if (cell) cell.push(id);
    else this.cells.set(key, [id]);
    return id;
  }

  addEdge(a: number, b: number): void {
    if (a === b || this.adjacency[a].some((e) => e.to === b)) return;
    const w = dist(this.positions[a], this.positions[b]);
    this.adjacency[a].push({ to: b, w });
    this.adjacency[b].push({ to: a, w });
  }

  /** Vertices within `radius` of `p`, nearest first. */
  within(p: Vec3, radius: number): number[] {
    const out: Array<[number, number]> = [];
    const reach = Math.ceil(radius / this.cellSize);
    const [cx, cy, cz] = this.cellOf(p);
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -reach; dy <= reach; dy++)
        for (let dz = -reach; dz <= reach; dz++) {
          for (const id of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = dist(p, this.positions[id]);
            if (d <= radius) out.push([id, d]);
          }
        }
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([id]) => id);
  }

  nearest(p: Vec3): number | null {
    for (let r = this.cellSize; r < 1e4; r *= 2) {
      const found = this.within(p, r);
      if (found.length) return found[0];
      if (r > 64 * this.cellSize) break;
    }
    let best: number | null = null;
    let bestD = Infinity;
    this.positions.forEach((q, id) => {
      const d = dist(p, q);
      if (d < bestD) [best, bestD] = [id, d];
    });
    return best;
  }

  edges(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    this.adjacency.forEach((list, a) => {
      for (const { to } of list) if (a < to) out.push([a, to]);
    });
    return out;
  }

  /** Shortest distances and predecessors from `source`. */
  dijkstra(source: number): { dist: Float64Array; prev: Int32Array } {
    const n = this.size;
    const d = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    if (source < 0 || source >= n) return { dist: d, prev };
    d[source] = 0;
    const heap = new MinHeap();
    heap.push(source, 0);
    while (heap.size) {
      const [u, du] = heap.pop();
      if (du > d[u]) continue;
      for (const { to, w } of this.adjacency[u]) {
        const nd = du + w;
        if (nd < d[to]) {
          d[to] = nd;
          prev[to] = u;
          heap.push(to, nd);
        }
      }
    }
    return { dist: d, prev };
  }

  private cellOf(p: Vec3): [number, number, number] {
    return [Math.floor(p[0] / this.cellSize), Math.floor(p[1] / this.cellSize), Math.floor(p[2] / this.cellSize)];
  }

  private cellKey(p: Vec3): string {
    return this.cellOf(p).join(',');
  }
}

/** Vertex ids from the Dijkstra `source` to `target` (empty if unreachable). */
export function pathTo(prev: Int32Array, target: number, source = 0): number[] {
  if (target < 0 || target >= prev.length) return [];
  if (target !== source && prev[target] === -1) return [];
  const out = [target];
  let v = target;
  while (v !== source) {
    v = prev[v];
    if (v === -1 || out.length > prev.length) return [];
    out.push(v);
  }
  return out.reverse();
}

/** Cuts a polyline after `maxLength` metres (gbplanner's traverse_length_max). */
export function truncatePath(points: readonly Vec3[], maxLength: number): Vec3[] {
  const out: Vec3[] = points.length ? [points[0]] : [];
  let left = maxLength;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1], points[i]);
    if (d <= left + 1e-9) {
      out.push(points[i]);
      left -= d;
      continue;
    }
    if (left > 1e-6) out.push(lerp(points[i - 1], points[i], left / d));
    break;
  }
  return out;
}

/**
 * Collision checks of the robot box against the known map, cached per voxel. Build a fresh one
 * per planning iteration (the known map only grows, but a cached "blocked" may become free).
 */
export class CollisionChecker {
  private readonly cache: Int8Array;

  constructor(
    readonly map: VoxelMap,
    readonly half: number,
  ) {
    this.cache = new Int8Array(map.state.length).fill(-1);
  }

  pointFree(p: Vec3): boolean {
    const v = voxelOf(this.map.grid, p);
    if (!v) return false;
    const index = voxelIndex(this.map.grid, v[0], v[1], v[2]);
    const cached = this.cache[index];
    if (cached !== -1) return cached === 1;
    const free = this.map.isBoxFree(p, this.half);
    this.cache[index] = free ? 1 : 0;
    return free;
  }

  /** Every sample along a→b (every half voxel) is free. `skipStart` for the robot's own spot. */
  segmentFree(a: Vec3, b: Vec3, skipStart = false): boolean {
    const d = dist(a, b);
    const n = Math.max(1, Math.ceil(d / (this.map.grid.resolution * 0.5)));
    for (let s = skipStart ? 1 : 0; s <= n; s++) {
      if (!this.pointFree(lerp(a, b, s / n))) return false;
    }
    return true;
  }
}

export interface RrgInput {
  map: VoxelMap;
  checker: CollisionChecker;
  root: Vec3;
  /** Where to sample: local bound ∩ global bound (∩ the known-free box). */
  sampleBox: Bounds;
  config: GbPlannerConfig;
  rng: () => number;
  /** Points to sample around more often (openings the planner knows about). */
  bias?: readonly Vec3[];
  /** Target reach: choose the vertex closest to this goal instead of the highest gain. */
  goal?: Vec3 | null;
}

export interface RrgResult {
  graph: Graph;
  /** Unknown voxels visible from each vertex (0 for the root and in target-reach mode). */
  gains: number[];
  bestPath: number[];
  bestGain: number;
  gainThreshold: number;
  exhausted: boolean;
  /** Target reach: the path ends exactly at the goal. */
  reachesGoal: boolean;
}

export function buildRrg(input: RrgInput): RrgResult {
  const { map, checker, root, sampleBox, config, rng, bias = [], goal = null } = input;
  const graph = new Graph(config.nearestRangeM);
  graph.addVertex(root);
  const { rrgVertices, rrgAttempts, rrgNeighbours } = config.sim;

  for (let attempt = 0; attempt < rrgAttempts && graph.size < rrgVertices; attempt++) {
    let p = sample(sampleBox, rng, bias);
    const nearest = graph.nearest(p);
    if (nearest === null) break;
    const from = graph.positions[nearest];
    const d = dist(from, p);
    if (d < config.edgeLengthMinM) continue;
    if (d > config.edgeLengthMaxM) p = lerp(from, p, config.edgeLengthMaxM / d);
    if (!checker.pointFree(p) || !checker.segmentFree(from, p, nearest === 0)) continue;
    const id = graph.addVertex(p);
    graph.addEdge(nearest, id);
    let extra = 0;
    for (const other of graph.within(p, config.nearestRangeM)) {
      if (extra >= rrgNeighbours) break;
      if (other === id || other === nearest) continue;
      if (checker.segmentFree(graph.positions[other], p, other === 0)) {
        graph.addEdge(other, id);
        extra++;
      }
    }
  }

  const { dist: pathLength, prev } = graph.dijkstra(0);
  const gains = new Array<number>(graph.size).fill(0);
  const gainThreshold =
    config.frontierPercentageThreshold * directionCount(config.lidar) * (config.lidar.maxRangeM / map.grid.resolution);

  if (goal) {
    let reachesGoal = false;
    let best = 0;
    let bestD = dist(root, goal);
    if (checker.pointFree(goal)) {
      for (const v of graph.within(goal, config.nearestRangeM)) {
        if (Number.isFinite(pathLength[v]) && checker.segmentFree(graph.positions[v], goal, v === 0)) {
          const g = graph.addVertex(goal);
          graph.addEdge(v, g);
          gains.push(0);
          return {
            graph,
            gains,
            bestPath: [...pathTo(prev, v), g],
            bestGain: 0,
            gainThreshold,
            exhausted: false,
            reachesGoal: true,
          };
        }
      }
    }
    graph.positions.forEach((q, v) => {
      if (!Number.isFinite(pathLength[v])) return;
      const d = dist(q, goal);
      if (d < bestD - 1e-9) [best, bestD] = [v, d];
    });
    return { graph, gains, bestPath: pathTo(prev, best), bestGain: 0, gainThreshold, exhausted: false, reachesGoal };
  }

  let best = -1;
  let bestScore = -Infinity;
  for (let v = 1; v < graph.size; v++) {
    if (!Number.isFinite(pathLength[v])) continue;
    gains[v] = map.visibleUnknown(graph.positions[v], config.lidar);
    const score = config.unknownVoxelGain * gains[v] * Math.exp(-config.pathLengthPenalty * pathLength[v]);
    if (score > bestScore) [best, bestScore] = [v, score];
  }
  const bestGain = best >= 0 ? gains[best] : 0;
  return {
    graph,
    gains,
    bestPath: best >= 0 ? pathTo(prev, best) : [0],
    bestGain,
    gainThreshold,
    exhausted: bestGain < gainThreshold,
    reachesGoal: false,
  };
}

/**
 * Adds a local graph to the persistent global graph (repositioning, homing). Local vertices
 * closer than `mergeRadius` to a global vertex reuse it; edges whose ends moved are re-checked.
 * Returns local id -> global id.
 */
export function mergeInto(global: Graph, local: Graph, mergeRadius: number, checker: CollisionChecker): number[] {
  const snapped: boolean[] = [];
  const mapping = local.positions.map((p) => {
    const near = global.within(p, mergeRadius);
    if (near.length) {
      snapped.push(true);
      return near[0];
    }
    snapped.push(false);
    return global.addVertex(p);
  });
  for (const [a, b] of local.edges()) {
    const [ga, gb] = [mapping[a], mapping[b]];
    if (ga === gb) continue;
    if ((snapped[a] || snapped[b]) && !checker.segmentFree(global.positions[ga], global.positions[gb])) continue;
    global.addEdge(ga, gb);
  }
  return mapping;
}

/**
 * Connects a point to the global graph through known free space (up to `k` neighbours within
 * `radius`). Returns its vertex id, or null if nothing is reachable.
 */
export function connectToGraph(graph: Graph, p: Vec3, radius: number, checker: CollisionChecker, k = 4, skipStart = false): number | null {
  const existing = graph.within(p, 0.05);
  if (existing.length) return existing[0];
  const neighbours = graph.within(p, radius).filter((v) => checker.segmentFree(p, graph.positions[v], skipStart)).slice(0, k);
  if (!neighbours.length) return null;
  const id = graph.addVertex(p);
  for (const v of neighbours) graph.addEdge(id, v);
  return id;
}

function sample(box: Bounds, rng: () => number, bias: readonly Vec3[]): Vec3 {
  if (bias.length && rng() < 0.2) {
    const c = bias[Math.floor(rng() * bias.length)];
    const p: Vec3 = [c[0] + (rng() - 0.5) * 1.6, c[1] + (rng() - 0.5) * 0.3, c[2] + (rng() - 0.5) * 0.3];
    // Stay inside the sample box (e.g. the current compartment's slab).
    return [0, 1, 2].map((a) => Math.min(Math.max(p[a], box.min[a]), box.max[a])) as Vec3;
  }
  return [
    box.min[0] + rng() * (box.max[0] - box.min[0]),
    box.min[1] + rng() * (box.max[1] - box.min[1]),
    box.min[2] + rng() * (box.max[2] - box.min[2]),
  ];
}

class MinHeap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.ids[0], this.keys[0]];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
