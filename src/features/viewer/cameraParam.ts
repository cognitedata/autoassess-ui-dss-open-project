/**
 * `?camera=px,py,pz,tx,ty,tz` — an explicit start pose for the 3D viewer.
 *
 * Overrides the area's saved default camera pose. Used for shareable views and for
 * pixel-comparable regression screenshots across viewer versions.
 */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export function parseCameraParam(raw: string | null): CameraPose | null {
  if (!raw) return null;
  const values = raw.split(',').map((v) => Number(v.trim()));
  if (values.length !== 6 || !values.every(Number.isFinite)) return null;
  const [px, py, pz, tx, ty, tz] = values;
  if (px === tx && py === ty && pz === tz) return null;
  return { position: [px, py, pz], target: [tx, ty, tz] };
}

export function formatCameraParam(pose: CameraPose): string {
  return [...pose.position, ...pose.target].map((v) => Number(v.toFixed(4))).join(',');
}
