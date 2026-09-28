/**
 * One-time setup script: creates the DMS data model and upserts mock instances.
 *
 * Usage: copy .env.example → .env, fill in credentials, then run:
 *   pnpm setup-dm
 *
 * Auth: COGNITE_TENANT_ID is a UUID → Azure AD; org name → Cognite-native IDP.
 * The script is idempotent — safe to run multiple times.
 */

import { CogniteClient } from '@cognite/sdk';

const CLUSTER = process.env['COGNITE_CLUSTER'] ?? 'westeurope-1';
const BASE_URL = `https://${CLUSTER}.cognitedata.com`;
const SPACE = 'autoassess';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string> {
  const tenantId = requireEnv('COGNITE_TENANT_ID');
  const clientId = requireEnv('COGNITE_CLIENT_ID');
  const clientSecret = requireEnv('COGNITE_CLIENT_SECRET');

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId);

  if (isUUID) {
    // Azure AD / Entra ID — tenant is a UUID
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

  // Cognite-native IDP (org name like "cog-autoassess").
  // Uses Basic auth: Authorization: Basic base64(clientId:clientSecret)
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
// Step 1: Space
// ---------------------------------------------------------------------------

async function upsertSpace(client: CogniteClient): Promise<void> {
  console.log(`  Upserting space "${SPACE}"...`);
  await client.spaces.upsert([{ space: SPACE }]);
  console.log('  ✓ Space ready');
}

// ---------------------------------------------------------------------------
// Step 2: Containers
// ---------------------------------------------------------------------------

async function upsertContainers(client: CogniteClient): Promise<void> {
  console.log('  Upserting containers...');
  await client.containers.upsert([
    {
      space: SPACE,
      externalId: 'VesselContainer',
      properties: {
        name:       { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        description:{ type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        vesselType: { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        deletedAt:  { type: { type: 'timestamp' }, nullable: true },
      },
    },
    {
      space: SPACE,
      externalId: 'AreaContainer',
      properties: {
        name:          { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        description:   { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        areaType:      { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        vessel:        { type: { type: 'direct' }, nullable: true },
        cdfFileIds:    { type: { type: 'int64', list: true }, nullable: true },
        deletedAt:     { type: { type: 'timestamp' }, nullable: true },
        // World-space "up" vector [x, y, z] defining the ground plane for this area.
        // Used by the 3D viewer to set camera.up so fly-to animations have correct roll.
        groundPlane:            { type: { type: 'float64', list: true }, nullable: true },
        // Default starting camera position [x, y, z] in world space.
        initialCameraPosition:  { type: { type: 'float64', list: true }, nullable: true },
        // Default starting camera lookAt target [x, y, z] in world space.
        initialCameraTarget:    { type: { type: 'float64', list: true }, nullable: true },
      },
    },
    {
      space: SPACE,
      externalId: 'StructuralElementContainer',
      properties: {
        elementType: { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        label:       { type: { type: 'int64' }, nullable: false },
        centerX:     { type: { type: 'float64' }, nullable: false },
        centerY:     { type: { type: 'float64' }, nullable: false },
        centerZ:     { type: { type: 'float64' }, nullable: false },
        area:        { type: { type: 'direct' }, nullable: true },
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionResultContainer',
      properties: {
        // Direct relation to the AreaView node this result belongs to.
        area:          { type: { type: 'direct' }, nullable: true },
        // ISO-8601 date string of the inspection, e.g. "2024-09-15".
        campaignDate:  { type: { type: 'date' }, nullable: true },
        // One of: InProgress | Complete
        status:        { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        createdBy:     { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        // CDF file IDs for the PLY mesh models associated with this result.
        cdfFileIds:    { type: { type: 'int64', list: true }, nullable: true },
        // CDF file IDs for the point cloud files associated with this result.
        pcdFileIds:    { type: { type: 'int64', list: true }, nullable: true },
        // Display labels for each PCD file (parallel array to pcdFileIds).
        pcdFileLabels: { type: { type: 'text', collation: 'ucs_basic', list: true }, nullable: true },
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionPlanContainer',
      properties: {
        // Direct relation to the AreaView node this plan belongs to.
        area:        { type: { type: 'direct' }, nullable: true },
        // One of: Draft | Ready | Complete
        status:      { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        name:        { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        description: { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        deletedAt:   { type: { type: 'timestamp' }, nullable: true },
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionTaskContainer',
      properties: {
        // Direct relation to the InspectionPlanView node this task belongs to.
        plan:                    { type: { type: 'direct' }, nullable: true },
        // One of: element | region
        taskType:                { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        // One of: visual | ndt_thickness
        inspectionType:          { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        // Element tasks: direct relation to StructuralElementView node.
        targetElement:           { type: { type: 'direct' }, nullable: true },
        // Region tasks: [x, y, z] world position.
        position3d:              { type: { type: 'float64', list: true }, nullable: true },
        // Region tasks: [nx, ny, nz] surface normal vector.
        normalVector:            { type: { type: 'float64', list: true }, nullable: true },
        // Region tasks: radius in metres (default 0.3).
        radiusM:                 { type: { type: 'float64' }, nullable: true },
        // Stable ID of the recommendation that generated this task (if any).
        suggestionId:            { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
      },
    },
    {
      space: SPACE,
      externalId: 'DefectDetectionContainer',
      properties: {
        // Direct relation to the InspectionResultView node this defect was detected in.
        campaign:      { type: { type: 'direct' }, nullable: true },
        // ML confidence score in [0, 1].
        probability:   { type: { type: 'float64' }, nullable: false },
        // Defect class label, e.g. "corrosion", "crack", "deformation".
        defectClass:   { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        // Oriented bounding box: [cx, cy, cz, hx, hy, hz, rx, ry, rz]
        // where c = centre, h = half-extents, r = Euler rotation (radians).
        boundingBox3d: { type: { type: 'float64', list: true }, nullable: true },
        // Review status. One of: New | UnderReview | Confirmed | Dismissed
        status:        { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        // Surface normal [nx, ny, nz]. Stored when defect is created from a surface hit.
        normal3d:      { type: { type: 'float64', list: true }, nullable: true },
        // Origin of the defect. One of: ml | manual. Absent on legacy rows — treat as ml.
        source:        { type: { type: 'text', collation: 'ucs_basic' }, nullable: true },
        // Direct relation to the AreaView node. Set for manually created defects.
        area:          { type: { type: 'direct' }, nullable: true },
      },
    },
    {
      space: SPACE,
      externalId: 'NdtMeasurementContainer',
      properties: {
        // Direct relation to the InspectionResultView node this measurement belongs to.
        campaign:      { type: { type: 'direct' }, nullable: true },
        // World-space measurement position [x, y, z].
        position3d:    { type: { type: 'float64', list: true }, nullable: false },
        // Measured steel plate thickness in millimetres.
        thicknessMm:   { type: { type: 'float64' }, nullable: false },
        // ISO-8601 datetime string of when the measurement was taken.
        timestamp:     { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
      },
    },
    {
      space: SPACE,
      externalId: 'CampaignMetricContainer',
      properties: {
        // Direct relation to the InspectionResultView node this metric belongs to.
        campaign: { type: { type: 'direct' }, nullable: true },
        // Human-readable metric name, e.g. "Coverage" or "Corrosion rate".
        name:     { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        // Numeric metric value.
        value:    { type: { type: 'float64' }, nullable: false },
        // Display unit. One of: "decimal" | "percentage".
        unit:     { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
      },
    },
    {
      space: SPACE,
      externalId: 'DroneImageContainer',
      properties: {
        // externalId of the InspectionResult (campaign) this image belongs to.
        campaignExternalId: { type: { type: 'text', collation: 'ucs_basic' }, nullable: false },
        // 1-indexed frame number matching the line order in rgb.txt.
        frameId:    { type: { type: 'int32' }, nullable: false },
        // Unix timestamp in seconds.
        timestamp:  { type: { type: 'float64' }, nullable: false },
        // Camera position in mesh world frame.
        positionX:  { type: { type: 'float64' }, nullable: false },
        positionY:  { type: { type: 'float64' }, nullable: false },
        positionZ:  { type: { type: 'float64' }, nullable: false },
        // Camera orientation quaternion [qx, qy, qz, qw].
        orientQx:   { type: { type: 'float64' }, nullable: false },
        orientQy:   { type: { type: 'float64' }, nullable: false },
        orientQz:   { type: { type: 'float64' }, nullable: false },
        orientQw:   { type: { type: 'float64' }, nullable: false },
        // CDF Files API file ID for the RGB image.
        cdfFileId:  { type: { type: 'int64' }, nullable: false },
        // AABB of visible surface points — used for spatial image suggestions.
        bboxMinX:   { type: { type: 'float64' }, nullable: false },
        bboxMinY:   { type: { type: 'float64' }, nullable: false },
        bboxMinZ:   { type: { type: 'float64' }, nullable: false },
        bboxMaxX:   { type: { type: 'float64' }, nullable: false },
        bboxMaxY:   { type: { type: 'float64' }, nullable: false },
        bboxMaxZ:   { type: { type: 'float64' }, nullable: false },
        // Camera intrinsics from sensor config (e.g. ship_CH_test.yaml).
        focalLengthX:    { type: { type: 'float64' }, nullable: false },
        focalLengthY:    { type: { type: 'float64' }, nullable: false },
        principalPointX: { type: { type: 'float64' }, nullable: false },
        principalPointY: { type: { type: 'float64' }, nullable: false },
        imageWidth:      { type: { type: 'int32'   }, nullable: false },
        imageHeight:     { type: { type: 'int32'   }, nullable: false },
        nearPlane:       { type: { type: 'float64' }, nullable: false },
        farPlane:        { type: { type: 'float64' }, nullable: false },
      },
    },
  ]);
  console.log('  ✓ Containers ready');
}

// ---------------------------------------------------------------------------
// Step 3: Views
// ---------------------------------------------------------------------------

function containerRef(externalId: string) {
  return { type: 'container' as const, space: SPACE, externalId };
}

function containerProp(containerExternalId: string, propertyId: string) {
  return {
    container: containerRef(containerExternalId),
    containerPropertyIdentifier: propertyId,
  };
}

async function upsertViews(client: CogniteClient): Promise<void> {
  console.log('  Upserting views...');
  await client.views.upsert([
    {
      space: SPACE,
      externalId: 'VesselView',
      version: '1',
      properties: {
        name:       containerProp('VesselContainer', 'name'),
        description:containerProp('VesselContainer', 'description'),
        vesselType: containerProp('VesselContainer', 'vesselType'),
      },
    },
    {
      space: SPACE,
      externalId: 'VesselView',
      version: '2',
      properties: {
        name:       containerProp('VesselContainer', 'name'),
        description:containerProp('VesselContainer', 'description'),
        vesselType: containerProp('VesselContainer', 'vesselType'),
        deletedAt:  containerProp('VesselContainer', 'deletedAt'),
      },
    },
    {
      space: SPACE,
      externalId: 'AreaView',
      version: '1',
      properties: {
        name:          containerProp('AreaContainer', 'name'),
        description:   containerProp('AreaContainer', 'description'),
        areaType:      containerProp('AreaContainer', 'areaType'),
        vessel:        containerProp('AreaContainer', 'vessel'),
        cdfFileIds:    containerProp('AreaContainer', 'cdfFileIds'),
      },
    },
    {
      space: SPACE,
      externalId: 'AreaView',
      version: '2',
      properties: {
        name:       containerProp('AreaContainer', 'name'),
        description:containerProp('AreaContainer', 'description'),
        areaType:   containerProp('AreaContainer', 'areaType'),
        vessel:     containerProp('AreaContainer', 'vessel'),
        cdfFileIds: containerProp('AreaContainer', 'cdfFileIds'),
        deletedAt:  containerProp('AreaContainer', 'deletedAt'),
      },
    },
    {
      space: SPACE,
      externalId: 'AreaView',
      version: '3',
      properties: {
        name:        containerProp('AreaContainer', 'name'),
        description: containerProp('AreaContainer', 'description'),
        areaType:    containerProp('AreaContainer', 'areaType'),
        vessel:      containerProp('AreaContainer', 'vessel'),
        cdfFileIds:  containerProp('AreaContainer', 'cdfFileIds'),
        deletedAt:   containerProp('AreaContainer', 'deletedAt'),
        groundPlane: containerProp('AreaContainer', 'groundPlane'),
      },
    },
    {
      space: SPACE,
      externalId: 'AreaView',
      version: '4',
      properties: {
        name:                  containerProp('AreaContainer', 'name'),
        description:           containerProp('AreaContainer', 'description'),
        areaType:              containerProp('AreaContainer', 'areaType'),
        vessel:                containerProp('AreaContainer', 'vessel'),
        cdfFileIds:            containerProp('AreaContainer', 'cdfFileIds'),
        deletedAt:             containerProp('AreaContainer', 'deletedAt'),
        groundPlane:           containerProp('AreaContainer', 'groundPlane'),
        initialCameraPosition: containerProp('AreaContainer', 'initialCameraPosition'),
        initialCameraTarget:   containerProp('AreaContainer', 'initialCameraTarget'),
      },
    },
    {
      space: SPACE,
      externalId: 'StructuralElementView',
      version: '1',
      properties: {
        elementType: containerProp('StructuralElementContainer', 'elementType'),
        label:       containerProp('StructuralElementContainer', 'label'),
        centerX:     containerProp('StructuralElementContainer', 'centerX'),
        centerY:     containerProp('StructuralElementContainer', 'centerY'),
        centerZ:     containerProp('StructuralElementContainer', 'centerZ'),
        area:        containerProp('StructuralElementContainer', 'area'),
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionResultView',
      version: '1',
      properties: {
        area:          containerProp('InspectionResultContainer', 'area'),
        campaignDate:  containerProp('InspectionResultContainer', 'campaignDate'),
        status:        containerProp('InspectionResultContainer', 'status'),
        createdBy:     containerProp('InspectionResultContainer', 'createdBy'),
        cdfFileIds:    containerProp('InspectionResultContainer', 'cdfFileIds'),
        pcdFileIds:    containerProp('InspectionResultContainer', 'pcdFileIds'),
        pcdFileLabels: containerProp('InspectionResultContainer', 'pcdFileLabels'),
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionPlanView',
      version: '1',
      properties: {
        area:   containerProp('InspectionPlanContainer', 'area'),
        status: containerProp('InspectionPlanContainer', 'status'),
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionPlanView',
      version: '2',
      properties: {
        area:        containerProp('InspectionPlanContainer', 'area'),
        status:      containerProp('InspectionPlanContainer', 'status'),
        name:        containerProp('InspectionPlanContainer', 'name'),
        description: containerProp('InspectionPlanContainer', 'description'),
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionPlanView',
      version: '3',
      properties: {
        area:        containerProp('InspectionPlanContainer', 'area'),
        status:      containerProp('InspectionPlanContainer', 'status'),
        name:        containerProp('InspectionPlanContainer', 'name'),
        description: containerProp('InspectionPlanContainer', 'description'),
        deletedAt:   containerProp('InspectionPlanContainer', 'deletedAt'),
      },
    },
    {
      space: SPACE,
      externalId: 'InspectionTaskView',
      version: '1',
      properties: {
        plan:           containerProp('InspectionTaskContainer', 'plan'),
        taskType:       containerProp('InspectionTaskContainer', 'taskType'),
        inspectionType: containerProp('InspectionTaskContainer', 'inspectionType'),
        targetElement:  containerProp('InspectionTaskContainer', 'targetElement'),
        position3d:     containerProp('InspectionTaskContainer', 'position3d'),
        normalVector:   containerProp('InspectionTaskContainer', 'normalVector'),
        radiusM:        containerProp('InspectionTaskContainer', 'radiusM'),
        suggestionId:   containerProp('InspectionTaskContainer', 'suggestionId'),
      },
    },
    {
      space: SPACE,
      externalId: 'DefectDetectionView',
      version: '1',
      properties: {
        campaign:      containerProp('DefectDetectionContainer', 'campaign'),
        probability:   containerProp('DefectDetectionContainer', 'probability'),
        defectClass:   containerProp('DefectDetectionContainer', 'defectClass'),
        boundingBox3d: containerProp('DefectDetectionContainer', 'boundingBox3d'),
        status:        containerProp('DefectDetectionContainer', 'status'),
        normal3d:      containerProp('DefectDetectionContainer', 'normal3d'),
        source:        containerProp('DefectDetectionContainer', 'source'),
        area:          containerProp('DefectDetectionContainer', 'area'),
      },
    },
    {
      space: SPACE,
      externalId: 'NdtMeasurementView',
      version: '1',
      properties: {
        campaign:    containerProp('NdtMeasurementContainer', 'campaign'),
        position3d:  containerProp('NdtMeasurementContainer', 'position3d'),
        thicknessMm: containerProp('NdtMeasurementContainer', 'thicknessMm'),
        timestamp:   containerProp('NdtMeasurementContainer', 'timestamp'),
      },
    },
    {
      space: SPACE,
      externalId: 'CampaignMetricView',
      version: '1',
      properties: {
        campaign: containerProp('CampaignMetricContainer', 'campaign'),
        name:     containerProp('CampaignMetricContainer', 'name'),
        value:    containerProp('CampaignMetricContainer', 'value'),
        unit:     containerProp('CampaignMetricContainer', 'unit'),
      },
    },
    {
      space: SPACE,
      externalId: 'DroneImageView',
      version: '2',
      properties: {
        campaignExternalId: containerProp('DroneImageContainer', 'campaignExternalId'),
        frameId:    containerProp('DroneImageContainer', 'frameId'),
        timestamp:  containerProp('DroneImageContainer', 'timestamp'),
        positionX:  containerProp('DroneImageContainer', 'positionX'),
        positionY:  containerProp('DroneImageContainer', 'positionY'),
        positionZ:  containerProp('DroneImageContainer', 'positionZ'),
        orientQx:   containerProp('DroneImageContainer', 'orientQx'),
        orientQy:   containerProp('DroneImageContainer', 'orientQy'),
        orientQz:   containerProp('DroneImageContainer', 'orientQz'),
        orientQw:   containerProp('DroneImageContainer', 'orientQw'),
        cdfFileId:  containerProp('DroneImageContainer', 'cdfFileId'),
        bboxMinX:   containerProp('DroneImageContainer', 'bboxMinX'),
        bboxMinY:   containerProp('DroneImageContainer', 'bboxMinY'),
        bboxMinZ:   containerProp('DroneImageContainer', 'bboxMinZ'),
        bboxMaxX:   containerProp('DroneImageContainer', 'bboxMaxX'),
        bboxMaxY:   containerProp('DroneImageContainer', 'bboxMaxY'),
        bboxMaxZ:   containerProp('DroneImageContainer', 'bboxMaxZ'),
        focalLengthX:    containerProp('DroneImageContainer', 'focalLengthX'),
        focalLengthY:    containerProp('DroneImageContainer', 'focalLengthY'),
        principalPointX: containerProp('DroneImageContainer', 'principalPointX'),
        principalPointY: containerProp('DroneImageContainer', 'principalPointY'),
        imageWidth:      containerProp('DroneImageContainer', 'imageWidth'),
        imageHeight:     containerProp('DroneImageContainer', 'imageHeight'),
        nearPlane:       containerProp('DroneImageContainer', 'nearPlane'),
        farPlane:        containerProp('DroneImageContainer', 'farPlane'),
      },
    },
  ]);
  console.log('  ✓ Views ready');
}

// ---------------------------------------------------------------------------
// Step 4: Mock instances
// ---------------------------------------------------------------------------

async function upsertMockInstances(client: CogniteClient): Promise<void> {
  console.log('  Upserting mock vessel and area nodes...');

  const vesselView = { type: 'view' as const, space: SPACE, externalId: 'VesselView', version: '1' };
  const areaView   = { type: 'view' as const, space: SPACE, externalId: 'AreaView',   version: '1' };

  await client.instances.upsert({
    items: [
      {
        instanceType: 'node',
        space: SPACE,
        externalId: 'vessel-test',
        sources: [
          {
            source: vesselView,
            properties: {
              name:       'Test Vessel',
              vesselType: 'Bulk Carrier',
            },
          },
        ],
      },
      {
        instanceType: 'node',
        space: SPACE,
        externalId: 'area-01581',
        sources: [
          {
            source: areaView,
            properties: {
              name:     'Ballast Water Tank 01581',
              areaType: 'BWT',
              vessel:   { space: SPACE, externalId: 'vessel-test' },
            },
          },
        ],
      },
    ],
  });

  console.log('  ✓ Mock instances ready');
}

// ---------------------------------------------------------------------------
// Step 5: Structural elements (from ssg.yaml, inlined)
// ---------------------------------------------------------------------------

const CLASS_NAMES: Record<number, string> = { 1: 'manhole', 2: 'longitudinal', 3: 'wall', 4: 'compartment' };

const SSG_INSTANCES: Array<{ id: number; class: number; center: [number, number, number] }> = [
  { id: 11,  class: 2, center: [4.17074, 0.237193, 0.844808] },
  { id: 27,  class: 2, center: [1.82102, 0.505733, 1.06218] },
  { id: 70,  class: 2, center: [6.48366, -0.360319, 1.27096] },
  { id: 78,  class: 2, center: [6.47339, -0.41217, 0.897854] },
  { id: 52,  class: 2, center: [0.72688, 0.173976, 2.37482] },
  { id: 116, class: 2, center: [9.84724, 0.3041, 0.410274] },
  { id: 105, class: 2, center: [11.2444, -0.315228, 2.12592] },
  { id: 104, class: 2, center: [11.2053, -0.550177, 1.31174] },
  { id: 99,  class: 2, center: [7.24726, -1.04143, 0.292368] },
  { id: 4,   class: 4, center: [10.1499, -0.480591, 1.24152] },
  { id: 110, class: 2, center: [9.88743, -1.75951, 1.9275] },
  { id: 109, class: 2, center: [9.78717, -1.72703, 1.11675] },
  { id: 108, class: 2, center: [9.70735, -1.05073, 2.70316] },
  { id: 106, class: 2, center: [9.92495, -1.57154, 2.73671] },
  { id: 103, class: 2, center: [11.1581, -0.378474, 2.71401] },
  { id: 102, class: 2, center: [10.6849, -0.318888, 2.72282] },
  { id: 94,  class: 2, center: [7.51936, 0.479101, 0.509687] },
  { id: 93,  class: 2, center: [7.28861, -1.49268, 0.347666] },
  { id: 88,  class: 2, center: [8.86346, -0.620807, 1.29864] },
  { id: 91,  class: 2, center: [7.61307, 1.3409, 2.06299] },
  { id: 90,  class: 2, center: [7.55857, 0.948852, 1.24976] },
  { id: 92,  class: 2, center: [7.43596, 0.95987, 2.74082] },
  { id: 89,  class: 2, center: [7.69011, 1.51604, 2.79824] },
  { id: 590, class: 1, center: [8.92672, -0.830998, 0.852471] },
  { id: 3,   class: 4, center: [7.8224, -0.256237, 1.33203] },
  { id: 86,  class: 2, center: [7.561, -1.53249, 1.98602] },
  { id: 87,  class: 2, center: [7.36613, -1.49676, 1.17424] },
  { id: 15,  class: 3, center: [7.90088, 1.11582, 1.30948] },
  { id: 85,  class: 2, center: [7.67115, -1.48459, 2.77665] },
  { id: 84,  class: 2, center: [7.63941, -1.33091, 2.78527] },
  { id: 82,  class: 2, center: [8.23785, -0.033231, 2.76736] },
  { id: 79,  class: 2, center: [8.73601, -0.0954208, 2.75085] },
  { id: 120, class: 2, center: [11.1759, -0.790905, 0.533004] },
  { id: 9,   class: 3, center: [-1.32506, 0.583757, 0.831941] },
  { id: 6,   class: 2, center: [2.99914, 1.95921, 2.94149] },
  { id: 16,  class: 3, center: [11.383, -0.521781, 1.40255] },
  { id: 0,   class: 2, center: [1.61992, 0.686673, 2.93763] },
  { id: 114, class: 2, center: [9.97342, 0.72702, 1.21209] },
  { id: 3,   class: 3, center: [3.11825, 1.4751, 1.29672] },
  { id: 4,   class: 3, center: [0.72248, 0.3682, 1.53543] },
  { id: 17,  class: 3, center: [10.1039, -1.91171, 1.07353] },
  { id: 1,   class: 2, center: [3.96188, 0.244558, 2.89608] },
  { id: 12,  class: 2, center: [2.49783, -0.48475, 2.90687] },
  { id: 71,  class: 2, center: [5.33075, 1.74913, 2.86794] },
  { id: 20,  class: 2, center: [2.94043, 0.964951, 0.596918] },
  { id: 119, class: 2, center: [9.65303, -1.70911, 0.303175] },
  { id: 8,   class: 3, center: [-0.119401, 1.77125, 1.36142] },
  { id: 5,   class: 2, center: [2.72383, 1.40203, 2.87329] },
  { id: 22,  class: 2, center: [2.78263, -0.979576, 2.91763] },
  { id: 7,   class: 3, center: [-0.339704, -0.957965, 1.05332] },
  { id: 4,   class: 2, center: [2.5399, -1.04467, 1.30749] },
  { id: 63,  class: 2, center: [5.87539, 0.176712, 2.82424] },
  { id: 21,  class: 2, center: [2.71036, -1.08679, 2.12161] },
  { id: 10,  class: 2, center: [4.14822, 0.107323, 1.91732] },
  { id: 13,  class: 3, center: [8.98526, -0.361041, 1.32707] },
  { id: 69,  class: 2, center: [4.85542, -1.27626, 0.408714] },
  { id: 9,   class: 2, center: [4.112, -0.126588, 1.40218] },
  { id: 12,  class: 3, center: [5.55878, 1.281, 1.2008] },
  { id: 68,  class: 2, center: [5.09626, -1.3079, 2.02489] },
  { id: 111, class: 2, center: [9.76575, 0.783164, 2.7011] },
  { id: 0,   class: 3, center: [1.86617, 0.341846, 1.31946] },
  { id: 112, class: 2, center: [10.0383, 1.30747, 2.76332] },
  { id: 1,   class: 3, center: [4.23995, 0.0964318, 1.46137] },
  { id: 130, class: 2, center: [7.37312, -0.77886, 2.75194] },
  { id: 3,   class: 2, center: [2.51558, -1.05797, 0.504618] },
  { id: 6,   class: 3, center: [1.10118, -1.07721, 1.17857] },
  { id: 14,  class: 3, center: [7.71862, -1.69182, 1.14477] },
  { id: 236, class: 1, center: [1.40999, 1.45866, 0.939663] },
  { id: 62,  class: 2, center: [6.38334, 0.0627464, 2.80746] },
  { id: 472, class: 1, center: [6.56641, -0.489369, 1.00944] },
  { id: 0,   class: 1, center: [4.17798, -0.340033, 1.13663] },
  { id: 113, class: 2, center: [9.98848, 1.1124, 2.01829] },
  { id: 2,   class: 3, center: [2.80383, -1.24163, 1.19372] },
  { id: 18,  class: 3, center: [10.333, 0.842213, 1.17159] },
  { id: 2,   class: 2, center: [3.47581, 0.372636, 2.90356] },
  { id: 0,   class: 4, center: [3.02809, 0.156985, 1.31749] },
  { id: 33,  class: 2, center: [1.82263, 0.871608, 2.72934] },
  { id: 118, class: 1, center: [1.90983, -0.900261, 0.158748] },
  { id: 7,   class: 2, center: [2.96941, 1.38809, 1.40431] },
  { id: 10,  class: 3, center: [6.62196, -0.113163, 1.43201] },
  { id: 177, class: 1, center: [1.81501, -0.204956, 0.962313] },
  { id: 66,  class: 2, center: [5.02367, -1.27764, 1.21617] },
  { id: 34,  class: 2, center: [1.19865, 0.928955, 2.94419] },
  { id: 37,  class: 2, center: [-0.100186, -0.830927, 1.39957] },
  { id: 8,   class: 2, center: [3.01354, 1.77363, 2.20497] },
  { id: 11,  class: 3, center: [5.29962, -1.46657, 1.11897] },
  { id: 67,  class: 2, center: [5.11876, -1.15475, 2.82773] },
  { id: 38,  class: 2, center: [-0.0632519, -0.828183, 0.599399] },
  { id: 39,  class: 2, center: [0.131441, 1.21304, 0.679484] },
  { id: 43,  class: 2, center: [0.11553, 1.64251, 1.46709] },
  { id: 46,  class: 2, center: [0.117053, 2.04415, 2.25934] },
  { id: 48,  class: 2, center: [0.205338, 2.26297, 2.98337] },
  { id: 49,  class: 2, center: [0.149561, 1.7245, 2.92285] },
  { id: 50,  class: 2, center: [0.766326, 0.556125, 2.82216] },
  { id: 1,   class: 4, center: [-0.17673, 0.424982, 1.15031] },
  { id: 2,   class: 4, center: [5.46912, -0.0650266, 1.31035] },
  { id: 74,  class: 2, center: [5.08806, 1.20489, 2.79956] },
  { id: 72,  class: 2, center: [5.25166, 1.18607, 1.31425] },
  { id: 73,  class: 2, center: [5.32481, 1.56643, 2.11872] },
  { id: 59,  class: 1, center: [0.689959, -0.0562929, 0.93662] },
  { id: 75,  class: 2, center: [5.2192, 0.746903, 0.507499] },
  { id: 77,  class: 2, center: [4.87083, -0.626361, 2.8053] },
  { id: 76,  class: 2, center: [6.4836, -0.367647, 1.29841] },
];

async function upsertStructuralElements(client: CogniteClient): Promise<void> {
  console.log(`  Upserting ${SSG_INSTANCES.length} structural elements...`);
  const elementView = { type: 'view' as const, space: SPACE, externalId: 'StructuralElementView', version: '1' };
  const areaRef = { space: SPACE, externalId: 'area-01581' };

  // Batch in groups of 100 to stay under API limits
  const BATCH = 100;
  for (let i = 0; i < SSG_INSTANCES.length; i += BATCH) {
    const batch = SSG_INSTANCES.slice(i, i + BATCH);
    await client.instances.upsert({
      items: batch.map((inst) => ({
        instanceType: 'node' as const,
        space: SPACE,
        externalId: `element-${inst.class}-${inst.id}`,
        sources: [
          {
            source: elementView,
            properties: {
              elementType: CLASS_NAMES[inst.class],
              label: 1000 * inst.class + inst.id,
              centerX: inst.center[0],
              centerY: inst.center[1],
              centerZ: inst.center[2],
              area: areaRef,
            },
          },
        ],
      })),
    });
  }
  console.log('  ✓ Structural elements ready');
}

// ---------------------------------------------------------------------------
// Step 6: Mock defect detections
// ---------------------------------------------------------------------------

async function upsertMockDefectDetections(client: CogniteClient): Promise<void> {
  console.log('  Upserting mock defect detections...');

  const defectView = { type: 'view' as const, space: SPACE, externalId: 'DefectDetectionView', version: '1' };
  // Campaign is the legacy result node created by seed-campaigns (or setup-dm step 4 seedata).
  const campaignRef = { space: SPACE, externalId: 'result-legacy-area-01581' };

  // Sample defects spread across the ballast tank geometry.
  // boundingBox3d: [cx, cy, cz,  hx, hy, hz,  rx, ry, rz]
  const mockDefects = [
    { externalId: 'defect-001', defectClass: 'corrosion', probability: 0.91, status: 'New',         bbox: [7.90, 1.12, 1.31,  0.15, 0.15, 0.10,  0, 0, 0] },
    { externalId: 'defect-002', defectClass: 'corrosion', probability: 0.76, status: 'UnderReview',  bbox: [4.17, 0.24, 0.84,  0.10, 0.10, 0.08,  0, 0, 0] },
    { externalId: 'defect-003', defectClass: 'crack',     probability: 0.83, status: 'New',         bbox: [8.93, -0.83, 0.85, 0.12, 0.08, 0.06,  0, 0, 0] },
    { externalId: 'defect-004', defectClass: 'deformation',probability: 0.55, status: 'Confirmed',  bbox: [1.41, 1.46, 0.94,  0.20, 0.20, 0.12,  0, 0, 0] },
    { externalId: 'defect-005', defectClass: 'corrosion', probability: 0.62, status: 'Dismissed',   bbox: [6.57, -0.49, 1.01, 0.08, 0.08, 0.05,  0, 0, 0] },
  ];

  await client.instances.upsert({
    items: mockDefects.map((d) => ({
      instanceType: 'node' as const,
      space: SPACE,
      externalId: d.externalId,
      sources: [
        {
          source: defectView,
          properties: {
            campaign:      campaignRef,
            probability:   d.probability,
            defectClass:   d.defectClass,
            boundingBox3d: d.bbox,
            status:        d.status,
          },
        },
      ],
    })),
  });

  console.log(`  ✓ ${mockDefects.length} mock defect detections ready`);
}

// ---------------------------------------------------------------------------
// Step 7: Mock NDT measurements
// ---------------------------------------------------------------------------

async function upsertMockNdtMeasurements(client: CogniteClient): Promise<void> {
  console.log('  Upserting mock NDT measurements...');

  const ndtView = { type: 'view' as const, space: SPACE, externalId: 'NdtMeasurementView', version: '1' };
  // All mock measurements belong to the legacy campaign created by seed-campaigns.
  const campaignRef = { space: SPACE, externalId: 'result-legacy-area-01581' };

  // 5 sample positions spread across the ballast tank geometry (sampled near structural elements).
  const mockMeasurements = [
    { externalId: 'ndt-001', position3d: [7.90, 1.12, 1.31],  thicknessMm: 12.5, timestamp: '2024-09-15T09:23:00Z' },
    { externalId: 'ndt-002', position3d: [4.24, 0.10, 1.46],  thicknessMm: 10.2, timestamp: '2024-09-15T09:31:00Z' },
    { externalId: 'ndt-003', position3d: [8.99, -0.36, 1.33], thicknessMm: 14.1, timestamp: '2024-09-15T09:44:00Z' },
    { externalId: 'ndt-004', position3d: [1.87, 0.34, 1.32],  thicknessMm: 8.7,  timestamp: '2024-09-15T10:02:00Z' },
    { externalId: 'ndt-005', position3d: [10.33, 0.84, 1.17], thicknessMm: 11.8, timestamp: '2024-09-15T10:15:00Z' },
  ];

  await client.instances.upsert({
    items: mockMeasurements.map((m) => ({
      instanceType: 'node' as const,
      space: SPACE,
      externalId: m.externalId,
      sources: [
        {
          source: ndtView,
          properties: {
            campaign:    campaignRef,
            position3d:  m.position3d,
            thicknessMm: m.thicknessMm,
            timestamp:   m.timestamp,
          },
        },
      ],
    })),
  });

  console.log(`  ✓ ${mockMeasurements.length} mock NDT measurements ready`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const project = process.env['COGNITE_PROJECT'] ?? 'autoassess-dev';

  console.log(`\nAutoAssess DM setup — project: ${project}, cluster: ${CLUSTER}\n`);

  const client = new CogniteClient({
    project,
    baseUrl: BASE_URL,
    oidcTokenProvider: getAccessToken,
    appId: 'autoassess-setup-script',
  });

  console.log('Step 1: Space');
  await upsertSpace(client);

  console.log('Step 2: Containers');
  await upsertContainers(client);

  console.log('Step 3: Views');
  await upsertViews(client);

  console.log('Step 4: Mock instances');
  await upsertMockInstances(client);

  console.log('Step 5: Structural elements');
  await upsertStructuralElements(client);

  console.log('Step 6: Mock defect detections');
  await upsertMockDefectDetections(client);

  console.log('Step 7: Mock NDT measurements');
  await upsertMockNdtMeasurements(client);

  console.log('\nDone ✓\n');
}

main().catch((err: unknown) => {
  console.error('\nSetup failed:', err);
  process.exit(1);
});
