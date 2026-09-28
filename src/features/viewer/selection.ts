import type { Vector3 } from 'three';
import type { StructuralElement } from './StructuralElementService';
import type { NdtMeasurement } from './NdtMeasurementService';
import type { InspectionTask } from './InspectionTaskService';
import type { DefectDetection } from './DefectDetectionService';
import type { DroneImage } from './DroneImageService';

export type SelectionHit =
  | { kind: 'element'; element: StructuralElement }
  | { kind: 'region'; position: Vector3; normal: Vector3 }
  | { kind: 'ndt'; measurement: NdtMeasurement }
  | { kind: 'task'; task: InspectionTask }
  | { kind: 'defect'; defect: DefectDetection }
  | { kind: 'image'; image: DroneImage };
