import type { Vec3 } from '../domain/types';

/** Deterministic PRNG (mulberry32): the same seed gives the same planner run. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Unit ray directions of a sensor in its own frame (x forward, y left, z up): a grid of headings
 * over `hFov` and elevations over `vFov`, `step` radians apart. A 360° sensor has no seam ray.
 */
export function sensorRayDirections(hFov: number, vFov: number, step: number): Vec3[] {
  const full = hFov >= 2 * Math.PI - 1e-9;
  const count = (fov: number) => (fov < 1e-9 ? 1 : Math.max(1, Math.round(fov / step)) + 1);
  const nh = full ? Math.max(1, Math.round(hFov / step)) : count(hFov);
  const nv = count(vFov);
  const dirs: Vec3[] = [];
  for (let iv = 0; iv < nv; iv++) {
    const el = nv === 1 ? 0 : -vFov / 2 + (vFov * iv) / (nv - 1);
    for (let ih = 0; ih < nh; ih++) {
      const az = full ? -Math.PI + (2 * Math.PI * ih) / nh : nh === 1 ? 0 : -hFov / 2 + (hFov * ih) / (nh - 1);
      dirs.push([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);
    }
  }
  return dirs;
}

/** Sensor-frame direction -> world: tilt by `pitch` (positive looks up), then turn by `yaw`. */
export function rotateDirection(d: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x1 = d[0] * cp - d[2] * sp;
  const z1 = d[0] * sp + d[2] * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [x1 * cy - d[1] * sy, x1 * sy + d[1] * cy, z1];
}

/** Is the world direction `d` inside a camera frustum looking along (yaw, pitch)? */
export function angleWithinFov(d: Vec3, yaw: number, pitch: number, hFov: number, vFov: number): boolean {
  // Undo the yaw, then the pitch, and compare the angles in the camera frame.
  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  const x1 = d[0] * cy - d[1] * sy;
  const y1 = d[0] * sy + d[1] * cy;
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  const x2 = x1 * cp - d[2] * sp;
  const z2 = x1 * sp + d[2] * cp;
  if (x2 <= 0) return false;
  const az = Math.atan2(y1, x2);
  const el = Math.atan2(z2, Math.hypot(x2, y1));
  return Math.abs(az) <= hFov / 2 + 1e-9 && Math.abs(el) <= vFov / 2 + 1e-9;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function lerp(a: Vec3, b: Vec3, f: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function polylineLength(points: readonly Vec3[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += dist(points[i - 1], points[i]);
  return d;
}

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function roundVec(v: Vec3, decimals = 3): Vec3 {
  return [round(v[0], decimals), round(v[1], decimals), round(v[2], decimals)];
}
