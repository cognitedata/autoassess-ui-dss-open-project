export type LayerType =
  | 'POINT_CLOUD'
  | 'MESH'
  | 'SEMANTIC_SEG'
  | 'IMAGES'
  | 'DEFECT_DETECTIONS'
  | 'NDT_MEASUREMENTS'
  | 'CHANGE_DETECTION';

export const ALL_LAYER_TYPES: readonly LayerType[] = [
  'POINT_CLOUD',
  'MESH',
  'SEMANTIC_SEG',
  'IMAGES',
  'DEFECT_DETECTIONS',
  'NDT_MEASUREMENTS',
  'CHANGE_DETECTION',
] as const;
