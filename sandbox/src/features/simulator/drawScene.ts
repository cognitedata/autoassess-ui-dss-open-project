import type { StructuralElement, Vec3 } from '../../domain/types';
import type { MissionSample } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import type { ViewAxes } from './projection';
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
} as const;

/** Draws one orthographic view (top or side) of a mission at the playback sample. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  axes: ViewAxes,
  mission: MissionResult,
  sample: MissionSample,
  elements: readonly StructuralElement[],
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

  // Structural elements (context only).
  ctx.fillStyle = SCENE_COLORS.element;
  for (const e of elements) {
    const [x, y] = at(e.center);
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  // Planned path, then the part already flown.
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = SCENE_COLORS.plannedPath;
  ctx.lineWidth = 1;
  strokePath(ctx, mission.segments.flatMap((s) => [at(s.from), at(s.to)]));
  ctx.setLineDash([]);
  const flown: Array<[number, number]> = [];
  for (const s of mission.segments) {
    if (s.t0 > sample.t) break;
    flown.push(at(s.from), s.t1 <= sample.t ? at(s.to) : at(sample.position));
  }
  ctx.strokeStyle = SCENE_COLORS.flownPath;
  ctx.lineWidth = 2;
  strokePath(ctx, flown);

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
    const color = skipped ? SCENE_COLORS.skipped : visited ? SCENE_COLORS.visited : SCENE_COLORS.pending;
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
    if (skipped) {
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
