import { boundsAround, unionBounds } from '../../domain/bounds';
import type { Bounds, Vec3 } from '../../domain/types';
import type { MissionResult } from '../../sim/simulator';

/** Which world axes a view shows: [horizontal, vertical]. */
export type ViewAxes = readonly [0 | 1 | 2, 0 | 1 | 2];
export const TOP_VIEW: ViewAxes = [0, 1]; // x right, y up
export const SIDE_VIEW: ViewAxes = [0, 2]; // x right, z up

export interface Projection {
  toCanvas(p: Vec3): [number, number];
  /** Pixels per metre. */
  scale: number;
}

/** Uniform-scale fit of `bounds` (on the given axes) into a width x height canvas, +y/+z up. */
export function createProjection(
  bounds: Bounds,
  axes: ViewAxes,
  width: number,
  height: number,
  padding = 16,
): Projection {
  const [h, v] = axes;
  const spanH = Math.max(bounds.max[h] - bounds.min[h], 1e-6);
  const spanV = Math.max(bounds.max[v] - bounds.min[v], 1e-6);
  const scale = Math.min((width - 2 * padding) / spanH, (height - 2 * padding) / spanV);
  const offsetX = (width - spanH * scale) / 2;
  const offsetY = (height - spanV * scale) / 2;
  return {
    scale,
    toCanvas: (p) => [
      offsetX + (p[h] - bounds.min[h]) * scale,
      height - (offsetY + (p[v] - bounds.min[v]) * scale),
    ],
  };
}

/** Everything worth showing for a mission: area bounds, home, targets, waypoints and the planner map. */
export function missionViewBounds(mission: MissionResult): Bounds {
  const points: Vec3[] = [mission.home];
  for (const t of mission.tasks) {
    if (t.target) points.push(t.target);
    if (t.waypoint) points.push(t.waypoint);
  }
  const map = mission.planner?.map;
  const mapBox: Bounds | null = map
    ? {
        min: [map.origin[0], map.origin[1], map.origin[2]],
        max: [0, 1, 2].map((a) => map.origin[a] + map.dims[a] * map.resolution) as Vec3,
      }
    : null;
  return (
    unionBounds(unionBounds(mission.bounds, mapBox), boundsAround(points, 0.5)) ?? { min: [-1, -1, -1], max: [1, 1, 1] }
  );
}
