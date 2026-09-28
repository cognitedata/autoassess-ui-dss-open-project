/**
 * Reads mock-data/simulated/ship_CH_data/groundtruth.txt and writes a binary
 * PCD of the camera trajectory positions (tx, ty, tz columns) so the path
 * can be compared visually against the mesh in Open3D.
 *
 * Usage: pnpm generate-trajectory-pcd
 * Open with:
 *   import open3d as o3d
 *   traj = o3d.io.read_point_cloud("mock-data/simulated/ship_CH_data/trajectory.pcd")
 *   mesh = o3d.io.read_triangle_mesh("mock-data/simulated/simulator_ship_CH_mesh.ply")
 *   o3d.visualization.draw_geometries([mesh, traj])
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const DATA_DIR = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '../mock-data/simulated/ship_CH_data',
);
const IN_PATH  = path.join(DATA_DIR, 'groundtruth.txt');
const OUT_PATH = path.join(DATA_DIR, 'trajectory.pcd');

console.log('Parsing groundtruth.txt...');
const text  = fs.readFileSync(IN_PATH, 'utf8');
const lines = text.split('\n');

// Format: timestamp tx ty tz qx qy qz qw  (space-separated)
const points: number[] = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const cols = trimmed.split(/\s+/);
  const tx = parseFloat(cols[1]!);
  const ty = parseFloat(cols[2]!);
  const tz = parseFloat(cols[3]!);
  if (!isFinite(tx) || !isFinite(ty) || !isFinite(tz)) continue;
  points.push(tx, ty, tz);
}

const n = points.length / 3;
console.log(`${n.toLocaleString()} pose positions`);

const header = [
  'VERSION .7',
  'FIELDS x y z',
  'SIZE 4 4 4',
  'TYPE F F F',
  'COUNT 1 1 1',
  `WIDTH ${n}`,
  'HEIGHT 1',
  'VIEWPOINT 0 0 0 1 0 0 0',
  `POINTS ${n}`,
  'DATA binary',
  '',
].join('\n');

const dataBuf = Buffer.allocUnsafe(n * 12);
for (let i = 0; i < n; i++) {
  dataBuf.writeFloatLE(points[i * 3]!,     i * 12);
  dataBuf.writeFloatLE(points[i * 3 + 1]!, i * 12 + 4);
  dataBuf.writeFloatLE(points[i * 3 + 2]!, i * 12 + 8);
}

fs.writeFileSync(OUT_PATH, Buffer.concat([Buffer.from(header, 'ascii'), dataBuf]));
console.log(`Written to ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB)`);
