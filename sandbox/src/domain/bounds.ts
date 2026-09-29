import type { Bounds, Vec3 } from './types';

/** Axis-aligned box around `points`, grown by `margin` on every side. Null for no points. */
export function boundsAround(points: readonly Vec3[], margin = 0): Bounds | null {
  if (points.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return {
    min: [min[0] - margin, min[1] - margin, min[2] - margin],
    max: [max[0] + margin, max[1] + margin, max[2] + margin],
  };
}

export function containsPoint(bounds: Bounds, p: Vec3): boolean {
  return p.every((v, i) => v >= bounds.min[i] && v <= bounds.max[i]);
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Default take-off point: the low, -x end of the area (where the access hatch usually is). */
export function defaultHome(bounds: Bounds): Vec3 {
  return [bounds.min[0], (bounds.min[1] + bounds.max[1]) / 2, bounds.min[2]];
}
