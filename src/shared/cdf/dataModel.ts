// Authoritative CDF data model for this repo. When changing spaces/containers/views or bumping
// a view version here, mirror the change in sdk/src/uidss/cdf/data_model.py.
export const AUTOASSESS_SPACE = 'autoassess';

export const VESSEL_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'VesselContainer',
} as const;

export const AREA_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'AreaContainer',
} as const;

export const VESSEL_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'VesselView',
  version: '2',
} as const;

export const AREA_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'AreaView',
  version: '4',
} as const;

export function getContainerProperty(
  container: { space: string; externalId: string },
  propertyIdentifier: string,
): [string, string, string] {
  return [container.space, container.externalId, propertyIdentifier];
}

export const STRUCTURAL_ELEMENT_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'StructuralElementContainer',
} as const;

export const STRUCTURAL_ELEMENT_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'StructuralElementView',
  version: '1',
} as const;

export function getViewKey(view: { externalId: string; version: string }): string {
  return `${view.externalId}/${view.version}`;
}

export const INSPECTION_RESULT_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionResultContainer',
} as const;

export const INSPECTION_RESULT_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionResultView',
  version: '1',
} as const;

export const INSPECTION_PLAN_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionPlanContainer',
} as const;

export const INSPECTION_PLAN_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionPlanView',
  version: '4',
} as const;

export const INSPECTION_TASK_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionTaskContainer',
} as const;

export const INSPECTION_TASK_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionTaskView',
  version: '1',
} as const;

export const DEFECT_DETECTION_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'DefectDetectionContainer',
} as const;

export const DEFECT_DETECTION_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'DefectDetectionView',
  version: '1',
} as const;

export const NDT_MEASUREMENT_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'NdtMeasurementContainer',
} as const;

export const NDT_MEASUREMENT_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'NdtMeasurementView',
  version: '1',
} as const;

export const CAMPAIGN_METRIC_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'CampaignMetricContainer',
} as const;

export const CAMPAIGN_METRIC_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'CampaignMetricView',
  version: '1',
} as const;

export const DRONE_IMAGE_CONTAINER = {
  space: AUTOASSESS_SPACE,
  externalId: 'DroneImageContainer',
} as const;

export const DRONE_IMAGE_VIEW = {
  space: AUTOASSESS_SPACE,
  externalId: 'DroneImageView',
  version: '2',
} as const;

export interface DroneImage {
  space: string;
  externalId: string;
  /** externalId of the InspectionResult (campaign) this image belongs to. */
  campaignExternalId: string;
  /** 1-indexed frame number matching the line order in rgb.txt. */
  frameId: number;
  /** Unix timestamp in seconds of when the image was captured. */
  timestamp: number;
  /** Camera position in mesh world frame [x, y, z]. */
  position: [number, number, number];
  /** Camera orientation quaternion in mesh world frame [qx, qy, qz, qw]. */
  orientationQuat: [number, number, number, number];
  /** CDF Files API file ID for the RGB image. */
  cdfFileId: number;
  /** AABB min corner of visible surface points [x, y, z] — used for spatial queries. */
  bboxMin: [number, number, number];
  /** AABB max corner of visible surface points [x, y, z] — used for spatial queries. */
  bboxMax: [number, number, number];
  /** Camera intrinsics from sensor config. */
  focalLengthX: number;
  focalLengthY: number;
  principalPointX: number;
  principalPointY: number;
  imageWidth: number;
  imageHeight: number;
  nearPlane: number;
  farPlane: number;
}
