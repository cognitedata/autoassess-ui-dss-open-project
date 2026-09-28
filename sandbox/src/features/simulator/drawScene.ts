import type { StructuralElement, Vec3 } from '../../domain/types';
import type { PlannerSample } from '../../planner/plannerPlayback';
import type { PlannerResult } from '../../planner/types';
import type { MissionSample } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import type { MapCellKind, MapProjection } from './mapProjection';
import { cellKindAt } from './mapProjection';
import type { Projection, ViewAxes } from './projection';
import { createProjection, missionViewBounds } from './projection';

export const SCENE_COLORS = {
  background: '#f8fafc',
  area: '#cbd5e1',
  areaFill: '#eef2f7',
  element: '#94a3b8',
  plannedPath: '#94a3b8',
  flownPath: '#2563eb',
  pending: '#d97706',
  visited: '#16a34a',
  skipped: '#dc2626',
  drone: '#1e3a8a',
  home: '#0f172a',
  label: '#475569',
  // Simulated gbplanner layers.
  mapFree: '#cfe2fc',
  mapOccupied: '#94a3b8',
  mapInspected: '#6ee7b7',
  graph: '#c4b5fd',
  bestPath: '#7c3aed',
  camera: 'rgba(37, 99, 235, 0.18)',
  viewpoint: '#db2777',
  covered: '#0d9488',
} as const;

export type PlannerLayer = 'map' | 'graph' | 'bestPath' | 'camera' | 'viewpoints';
export type PlannerLayers = Record<PlannerLayer, boolean>;

/** The simulated gbplanner's state to draw over one view (see usePlannerOverlayViewModel). */
export interface PlannerOverlay {
  planner: PlannerResult;
  sample: PlannerSample;
  /** The planner map flattened onto this view. */
  map: MapProjection;
  layers: PlannerLayers;
  /** Inspection camera pitch at the drone (radians, + up). */
  cameraPitch: number;
}

const MAP_COLORS: Record<Exclude<MapCellKind, 'unknown'>, string> = {
  free: SCENE_COLORS.mapFree,
  occupied: SCENE_COLORS.mapOccupied,
  inspected: SCENE_COLORS.mapInspected,
};

/**
 * Draws one orthographic view (top or side) of a mission at the playback sample, with the
 * simulated gbplanner's layers when a planner flew it.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  axes: ViewAxes,
  mission: MissionResult,
  sample: MissionSample,
  elements: readonly StructuralElement[],
  overlay: PlannerOverlay | null = null,
): void {
  const proj = createProjection(missionViewBounds(mission), axes, width, height, 18);
  const at = (p: Vec3) => proj.toCanvas(p);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = SCENE_COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Area geofence.
  if (mission.bounds) {
    const [x0, y0] = at(mission.bounds.min);
    const [x1, y1] = at(mission.bounds.max);
    ctx.fillStyle = SCENE_COLORS.areaFill;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeStyle = SCENE_COLORS.area;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }

  if (overlay?.layers.map) drawMap(ctx, proj, axes, overlay.map, sample.t);

  // Structural elements (context only).
  ctx.fillStyle = SCENE_COLORS.element;
  for (const e of elements) {
    const [x, y] = at(e.center);
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  const iteration = overlay?.sample.iteration ?? null;
  if (overlay?.layers.graph && iteration) {
    const { vertices, edges } = iteration.graph;
    ctx.strokeStyle = SCENE_COLORS.graph;
    ctx.lineWidth = 1;
    strokePath(ctx, edges.flatMap(([a, b]) => [at(vertices[a]), at(vertices[b])]));
    ctx.fillStyle = SCENE_COLORS.graph;
    ctx.beginPath();
    for (const v of vertices) {
      const [x, y] = at(v);
      ctx.rect(x - 1, y - 1, 2, 2);
    }
    ctx.fill();
  }

  // Planned path (a planner's flight is planned as it goes: its best path shows what's next),
  // then the part already flown.
  if (!overlay) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = SCENE_COLORS.plannedPath;
    ctx.lineWidth = 1;
    strokePath(ctx, mission.segments.flatMap((s) => [at(s.from), at(s.to)]));
    ctx.setLineDash([]);
  }
  const flown: Array<[number, number]> = [];
  for (const s of mission.segments) {
    if (s.t0 > sample.t) break;
    flown.push(at(s.from), s.t1 <= sample.t ? at(s.to) : at(sample.position));
  }
  ctx.strokeStyle = SCENE_COLORS.flownPath;
  ctx.lineWidth = 2;
  strokePath(ctx, flown);

  if (overlay?.layers.bestPath && iteration && iteration.bestPath.length > 1) {
    ctx.strokeStyle = SCENE_COLORS.bestPath;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    strokePath(ctx, iteration.bestPath.slice(1).flatMap((p, i) => [at(iteration.bestPath[i]), at(p)]));
    ctx.setLineDash([]);
  }

  if (overlay?.layers.viewpoints) drawViewpoints(ctx, at, overlay.sample);

  // Home.
  const [hx, hy] = at(mission.home);
  ctx.strokeStyle = SCENE_COLORS.home;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(hx - 5, hy - 5, 10, 10);

  // Tasks: target markers coloured by state, thin line to the hover waypoint.
  for (const task of mission.tasks) {
    if (!task.target) continue;
    const [x, y] = at(task.target);
    const visited = sample.visitedTaskIds.has(task.id);
    const skipped = task.skippedAt !== undefined && task.skippedAt <= sample.t;
    const covered = overlay?.sample.coveredTaskIds.has(task.id) ?? false;
    const color = visited
      ? SCENE_COLORS.visited
      : covered
        ? SCENE_COLORS.covered
        : skipped
          ? SCENE_COLORS.skipped
          : SCENE_COLORS.pending;
    if (task.waypoint) {
      const [wx, wy] = at(task.waypoint);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      strokePath(ctx, [[x, y], [wx, wy]]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    if (task.kind === 'element') ctx.rect(x - 4.5, y - 4.5, 9, 9);
    else ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    if (skipped && !visited && !covered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      strokePath(ctx, [[x - 3, y - 3], [x + 3, y + 3], [x - 3, y + 3], [x + 3, y - 3]]);
    }
    if (sample.activeTaskId === task.id && sample.phase === 'inspect') {
      ctx.strokeStyle = SCENE_COLORS.flownPath;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9 + 2 * Math.sin(sample.t * 6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (overlay?.layers.camera) drawCameraWedge(ctx, at, axes, sample, overlay);

  // Drone, with a heading tick (yaw) where the view shows it.
  const [dx, dy] = at(sample.position);
  const ahead: Vec3 = [
    sample.position[0] + Math.cos(sample.yaw),
    sample.position[1] + Math.sin(sample.yaw),
    sample.position[2],
  ];
  const [ax, ay] = at(ahead);
  const len = Math.hypot(ax - dx, ay - dy);
  if (len > 1e-6) {
    ctx.strokeStyle = SCENE_COLORS.drone;
    ctx.lineWidth = 2;
    strokePath(ctx, [[dx, dy], [dx + ((ax - dx) / len) * 13, dy + ((ay - dy) / len) * 13]]);
  }
  ctx.fillStyle = SCENE_COLORS.drone;
  ctx.beginPath();
  ctx.arc(dx, dy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Scale bar (1 m).
  ctx.strokeStyle = SCENE_COLORS.label;
  ctx.fillStyle = SCENE_COLORS.label;
  ctx.lineWidth = 1.5;
  strokePath(ctx, [[10, height - 8], [10 + proj.scale, height - 8]]);
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('1 m', 14 + proj.scale, height - 5);
}

/** The planner map, merged into runs of equal cells per row. */
function drawMap(ctx: CanvasRenderingContext2D, proj: Projection, axes: ViewAxes, map: MapProjection, t: number): void {
  const corner = (col: number, row: number): [number, number] => {
    const p: Vec3 = [0, 0, 0];
    p[axes[0]] = map.origin[0] + col * map.resolution;
    p[axes[1]] = map.origin[1] + row * map.resolution;
    return proj.toCanvas(p);
  };
  for (let row = 0; row < map.rows; row++) {
    let col = 0;
    while (col < map.cols) {
      const kind = cellKindAt(map, col + map.cols * row, t);
      let end = col + 1;
      while (end < map.cols && cellKindAt(map, end + map.cols * row, t) === kind) end++;
      if (kind !== 'unknown') {
        const [x0, y0] = corner(col, row);
        const [x1, y1] = corner(end, row + 1);
        ctx.fillStyle = MAP_COLORS[kind];
        // Half a pixel of overlap hides the seams between rows.
        ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1) - 0.25, Math.abs(x1 - x0), Math.abs(y1 - y0) + 0.5);
      }
      col = end;
    }
  }
}

function drawViewpoints(ctx: CanvasRenderingContext2D, at: (p: Vec3) => [number, number], sample: PlannerSample): void {
  ctx.font = '9px system-ui, sans-serif';
  for (const vp of sample.viewpoints) {
    const [x, y] = at(vp.position);
    // Viewpoints already flown to fade out, so the rest of the tour stands out.
    ctx.globalAlpha = sample.reachedViewpoints.has(vp.order) ? 0.3 : 1;
    ctx.strokeStyle = SCENE_COLORS.viewpoint;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = SCENE_COLORS.viewpoint;
    ctx.fillText(String(vp.order), x + 4, y - 3);
  }
  ctx.globalAlpha = 1;
}

/**
 * The inspection camera's field of view at the drone, cut at its range: yaw +/- hFoV/2 in the
 * top view, pitch +/- vFoV/2 along the heading in the side view.
 */
function drawCameraWedge(
  ctx: CanvasRenderingContext2D,
  at: (p: Vec3) => [number, number],
  axes: ViewAxes,
  sample: MissionSample,
  overlay: PlannerOverlay,
): void {
  const { cameraHFovRad, cameraVFovRad, cameraMaxRangeM: range } = overlay.planner.sensors;
  const topView = axes[1] === 1;
  const p = sample.position;
  const ray = (offset: number): Vec3 => {
    const yaw = topView ? sample.yaw + offset : sample.yaw;
    const pitch = topView ? 0 : overlay.cameraPitch + offset;
    return [
      p[0] + range * Math.cos(yaw) * Math.cos(pitch),
      p[1] + range * Math.sin(yaw) * Math.cos(pitch),
      p[2] + range * Math.sin(pitch),
    ];
  };
  const half = (topView ? cameraHFovRad : cameraVFovRad) / 2;
  const steps = 8;
  ctx.fillStyle = SCENE_COLORS.camera;
  ctx.beginPath();
  const [x0, y0] = at(p);
  ctx.moveTo(x0, y0);
  for (let s = 0; s <= steps; s++) {
    const [x, y] = at(ray(-half + (2 * half * s) / steps));
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Pairs of points -> separate line segments. */
function strokePath(ctx: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  if (points.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    ctx.moveTo(points[i][0], points[i][1]);
    ctx.lineTo(points[i + 1][0], points[i + 1][1]);
  }
  ctx.stroke();
}
