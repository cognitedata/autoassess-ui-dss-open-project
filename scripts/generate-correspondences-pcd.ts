/**
 * Reads mock-data/simulated/ship_CH_data/index-2d3d.csv and writes a binary
 * PCD file to the same directory. No CDF credentials needed.
 *
 * Usage: pnpm generate-correspondences-pcd
 * Open with: python -c "import open3d as o3d; o3d.visualization.draw_geometries([o3d.io.read_point_cloud('mock-data/simulated/ship_CH_data/correspondences.pcd')])"
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const DATA_DIR = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '../mock-data/simulated/ship_CH_data',
);
const CSV_PATH = path.join(DATA_DIR, 'index-2d3d.csv');
const OUT_PATH = path.join(DATA_DIR, 'correspondences.pcd');

console.log('Parsing CSV...');
const text  = fs.readFileSync(CSV_PATH, 'utf8');
const lines = text.split('\n');

const points: number[] = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i]!.trim();
  if (!line) continue;
  const cols = line.split(',');
  const x = parseFloat(cols[0]!);
  const y = parseFloat(cols[1]!);
  const z = parseFloat(cols[2]!);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
  points.push(x, y, z);
}

const n = points.length / 3;
console.log(`${n.toLocaleString()} points`);

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
console.log(`Written to ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1)} MB)`);
