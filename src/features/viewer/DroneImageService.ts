import type { CogniteClient, NodeDefinition } from '@cognite/sdk';

import {
  AUTOASSESS_SPACE,
  DRONE_IMAGE_VIEW,
  DRONE_IMAGE_CONTAINER,
  INSPECTION_RESULT_VIEW,
  INSPECTION_RESULT_CONTAINER,
  DroneImage,
  getContainerProperty,
  getViewKey,
} from '../../shared/cdf/dataModel';

export type { DroneImage };

export interface DroneImageService {
  listForArea(areaSpace: string, areaExternalId: string): Promise<DroneImage[]>;
  listForCampaign(campaignExternalId: string): Promise<DroneImage[]>;
  getDownloadUrl(cdfFileId: number): Promise<string>;
}

export class CdfDroneImageService implements DroneImageService {
  constructor(private readonly client: CogniteClient) {}

  async listForArea(areaSpace: string, areaExternalId: string): Promise<DroneImage[]> {
    // Step 1: resolve all campaign (InspectionResult) IDs for this area.
    const resultsResponse = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...INSPECTION_RESULT_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(INSPECTION_RESULT_CONTAINER, 'area'),
          value: { space: areaSpace, externalId: areaExternalId },
        },
      },
      limit: 1000,
    });

    const campaignExternalIds = resultsResponse.items
      .filter(isNode)
      .map((node) => node.externalId);

    if (campaignExternalIds.length === 0) return [];

    // Step 2: fetch all drone images for any of those campaigns.
    const allImages = await Promise.all(
      campaignExternalIds.map((id) => this.listForCampaign(id)),
    );
    return allImages.flat();
  }

  async listForCampaign(campaignExternalId: string): Promise<DroneImage[]> {
    const response = await this.client.instances.list({
      instanceType: 'node',
      sources: [{ source: { type: 'view', ...DRONE_IMAGE_VIEW } }],
      filter: {
        equals: {
          property: getContainerProperty(DRONE_IMAGE_CONTAINER, 'campaignExternalId'),
          value: campaignExternalId,
        },
      },
      limit: 1000,
    });

    return response.items.filter(isNode).map(mapNodeToDroneImage);
  }

  async getDownloadUrl(cdfFileId: number): Promise<string> {
    const result = await this.client.files.getDownloadUrls([{ id: cdfFileId }]);
    const item = result[0];
    if (!item || !('downloadUrl' in item)) {
      throw new Error(`No download URL returned for fileId ${cdfFileId}`);
    }
    return item.downloadUrl;
  }
}

// ---- Internal helpers ----

function isNode(item: NodeDefinition | { instanceType: string }): item is NodeDefinition {
  return item.instanceType === 'node';
}

function mapNodeToDroneImage(item: NodeDefinition): DroneImage {
  const props = item.properties?.[AUTOASSESS_SPACE]?.[getViewKey(DRONE_IMAGE_VIEW)] ?? {};

  return {
    space:              item.space,
    externalId:         item.externalId,
    campaignExternalId: String(props['campaignExternalId'] ?? ''),
    frameId:            typeof props['frameId'] === 'number' ? props['frameId'] : 0,
    timestamp:          typeof props['timestamp'] === 'number' ? props['timestamp'] : 0,
    position: [
      typeof props['positionX'] === 'number' ? props['positionX'] : 0,
      typeof props['positionY'] === 'number' ? props['positionY'] : 0,
      typeof props['positionZ'] === 'number' ? props['positionZ'] : 0,
    ],
    orientationQuat: [
      typeof props['orientQx'] === 'number' ? props['orientQx'] : 0,
      typeof props['orientQy'] === 'number' ? props['orientQy'] : 0,
      typeof props['orientQz'] === 'number' ? props['orientQz'] : 0,
      typeof props['orientQw'] === 'number' ? props['orientQw'] : 1,
    ],
    cdfFileId: typeof props['cdfFileId'] === 'number' ? props['cdfFileId'] : 0,
    bboxMin: [
      typeof props['bboxMinX'] === 'number' ? props['bboxMinX'] : 0,
      typeof props['bboxMinY'] === 'number' ? props['bboxMinY'] : 0,
      typeof props['bboxMinZ'] === 'number' ? props['bboxMinZ'] : 0,
    ],
    bboxMax: [
      typeof props['bboxMaxX'] === 'number' ? props['bboxMaxX'] : 0,
      typeof props['bboxMaxY'] === 'number' ? props['bboxMaxY'] : 0,
      typeof props['bboxMaxZ'] === 'number' ? props['bboxMaxZ'] : 0,
    ],
    focalLengthX:    typeof props['focalLengthX']    === 'number' ? props['focalLengthX']    : 390.598938,
    focalLengthY:    typeof props['focalLengthY']    === 'number' ? props['focalLengthY']    : 390.598938,
    principalPointX: typeof props['principalPointX'] === 'number' ? props['principalPointX'] : 320.0,
    principalPointY: typeof props['principalPointY'] === 'number' ? props['principalPointY'] : 240.0,
    imageWidth:      typeof props['imageWidth']      === 'number' ? props['imageWidth']      : 640,
    imageHeight:     typeof props['imageHeight']     === 'number' ? props['imageHeight']     : 480,
    nearPlane:       typeof props['nearPlane']       === 'number' ? props['nearPlane']       : 0.4,
    farPlane:        typeof props['farPlane']        === 'number' ? props['farPlane']        : 35.0,
  };
}
