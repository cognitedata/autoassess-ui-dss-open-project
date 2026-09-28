/**
 * Upload script: uploads the 3D model files to CDF Files API and writes the
 * resulting file IDs back to the DMS nodes.
 *
 * Files uploaded:
 *   - mesh_984.ply               → result.cdfFileIds[0]    (PLY mesh, loaded by Three.js PLYLoader)
 *   - mesh_984.pcd               → result.pcdFileIds[0]    (point cloud, loaded by Three.js PCDLoader)
 *   - semantics/labeled_cloud.pcd → result.pcdFileIds[1]   (semantically labelled point cloud)
 *
 * Flow per file:
 *   1. POST /files               → create file metadata, get fileId + uploadUrl
 *   2. PUT <uploadUrl>           → upload bytes to the pre-signed URL
 *   3. Upsert DMS nodes          → store file IDs in the appropriate properties
 *
 * Usage: copy .env.example → .env, fill in credentials, then run:
 *   pnpm upload-3d
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { CogniteClient } from '@cognite/sdk';

const CLUSTER  = process.env['COGNITE_CLUSTER'] ?? 'westeurope-1';
const BASE_URL = `https://${CLUSTER}.cognitedata.com`;
const SPACE      = 'autoassess';
const AREA_EXT   = 'area-01581';
const RESULT_EXT = 'result-legacy-area-01581';

const MOCK_DATA_DIR = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '../mock-data/E300L122060007_01581_388_1flight/map-3d',
);

const PLY_PATH            = path.join(MOCK_DATA_DIR, 'mesh_984.ply');
const PCD_MESH_PATH       = path.join(MOCK_DATA_DIR, 'mesh_984.pcd');
const PCD_LABELED_PATH    = path.join(MOCK_DATA_DIR, 'semantics', 'labeled_cloud.pcd');

// ---------------------------------------------------------------------------
// Auth (same pattern as setup-dm.ts)
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string> {
  const tenantId     = requireEnv('COGNITE_TENANT_ID');
  const clientId     = requireEnv('COGNITE_CLIENT_ID');
  const clientSecret = requireEnv('COGNITE_CLIENT_SECRET');

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId);

  if (isUUID) {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: `${BASE_URL}/.default`,
      }),
    });
    if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
    const json = await res.json() as { access_token?: string };
    if (!json.access_token) throw new Error(`No access_token: ${JSON.stringify(json)}`);
    return json.access_token;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://auth.cognite.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new Error(`No access_token: ${JSON.stringify(json)}`);
  return json.access_token;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// Upload a single file to CDF Files API
// ---------------------------------------------------------------------------

async function uploadFile(
  token: string,
  project: string,
  filePath: string,
  fileName: string,
  mimeType = 'application/octet-stream',
): Promise<number> {
  const createRes = await fetch(`${BASE_URL}/api/v1/projects/${project}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: fileName, mimeType }),
  });
  if (!createRes.ok) throw new Error(`Files create failed: ${createRes.status} ${await createRes.text()}`);
  const { id, uploadUrl } = await createRes.json() as { id: number; uploadUrl: string };

  const data = fs.readFileSync(filePath);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: data,
  });
  if (!putRes.ok) throw new Error(`File PUT failed for ${fileName}: ${putRes.status} ${await putRes.text()}`);

  return id;
}

// ---------------------------------------------------------------------------
// Write file IDs to DMS nodes
// ---------------------------------------------------------------------------

async function updateFileIds(
  client: CogniteClient,
  plyFileIds: number[],
  pcdFileIds: number[],
): Promise<void> {
  const resultView = { type: 'view' as const, space: SPACE, externalId: 'InspectionResultView', version: '1' };
  await client.instances.upsert({
    items: [
      {
        instanceType: 'node',
        space: SPACE,
        externalId: RESULT_EXT,
        sources: [{
          source: resultView,
          properties: {
            cdfFileIds:    plyFileIds,
            pcdFileIds:    pcdFileIds,
            pcdFileLabels: ['Pointcloud', 'Labeled cloud'],
          },
        }],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const project = process.env['COGNITE_PROJECT'] ?? 'autoassess-dev';
  console.log(`\nAutoAssess 3D upload — project: ${project}, cluster: ${CLUSTER}\n`);

  const token = await getAccessToken();

  const client = new CogniteClient({
    project,
    baseUrl: BASE_URL,
    oidcTokenProvider: () => Promise.resolve(token),
    appId: 'autoassess-upload-script',
  });

  console.log('Step 1: Uploading PLY mesh (mesh_984.ply)...');
  const plyFileId = await uploadFile(token, project, PLY_PATH, 'mesh_984.ply');
  console.log(`  ✓ mesh_984.ply uploaded — fileId: ${plyFileId}`);

  console.log('Step 2: Uploading point cloud (mesh_984.pcd)...');
  const pcdMeshFileId = await uploadFile(token, project, PCD_MESH_PATH, 'mesh_984.pcd');
  console.log(`  ✓ mesh_984.pcd uploaded — fileId: ${pcdMeshFileId}`);

  console.log('Step 3: Uploading labelled point cloud (labeled_cloud.pcd)...');
  const pcdLabeledFileId = await uploadFile(token, project, PCD_LABELED_PATH, 'labeled_cloud.pcd');
  console.log(`  ✓ labeled_cloud.pcd uploaded — fileId: ${pcdLabeledFileId}`);

  console.log('Step 4: Writing file IDs to DMS nodes...');
  await updateFileIds(client, [plyFileId], [pcdMeshFileId, pcdLabeledFileId]);
  console.log('  ✓ DMS updated');

  console.log(`\nDone ✓`);
  console.log(`  result.cdfFileIds (PLY): [${plyFileId}]`);
  console.log(`  result.pcdFileIds (PCD): [${pcdMeshFileId}, ${pcdLabeledFileId}]`);
  console.log(`  result.pcdFileLabels:    ['Pointcloud', 'Labeled cloud']\n`);
}

main().catch((err: unknown) => {
  console.error('\nUpload failed:', err);
  process.exit(1);
});
