/**
 * Sandbox domain types. Shapes mirror the real `uidss` SDK (sdk/src/uidss/models.py) and the
 * CDF data model in ../../src/shared/cdf/dataModel.ts, in camelCase for the JS side.
 */
export type Vec3 = [number, number, number];

export type PlanStatus = 'Draft' | 'Ready' | 'Active' | 'Complete';
export type TaskKind = 'element' | 'region';
export type InspectionType = 'visual' | 'ndt_thickness';
export type ElementType = 'manhole' | 'longitudinal' | 'wall' | 'compartment';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface Vessel {
  space: string;
  externalId: string;
  name: string;
  vesselType: string;
}

export interface Area {
  space: string;
  externalId: string;
  name: string;
  areaType: string;
  vesselExternalId: string;
  /** Geofence for the simulator: box around the area's structural elements (null if none). */
  bounds: Bounds | null;
}

export interface InspectionPlan {
  space: string;
  externalId: string;
  areaExternalId: string;
  status: PlanStatus;
  /** Unix epoch milliseconds. */
  createdTime: number;
  name: string | null;
  description: string | null;
  mapExternalId: string | null;
}

export interface ElementTarget {
  externalId: string;
  elementType: ElementType;
  center: Vec3;
}

export interface InspectionTask {
  space: string;
  externalId: string;
  planExternalId: string;
  kind: TaskKind;
  inspectionType: InspectionType;
  targetElement: ElementTarget | null;
  position3d: Vec3 | null;
  normalVector: Vec3 | null;
  radiusM: number | null;
}

export interface StructuralElement {
  space: string;
  externalId: string;
  areaExternalId: string;
  elementType: ElementType;
  label: number;
  center: Vec3;
}

export type DataSourceMode = 'demo' | 'live';

/**
 * Everything the Python side can read, loaded up front. Python calls into the SDK are
 * synchronous (like the real SDK), so the worker cannot await CDF mid-script; the snapshot
 * is fetched before the run instead.
 */
export interface SandboxSnapshot {
  mode: DataSourceMode;
  /** Human-readable origin, e.g. "Demo fixtures" or "CDF project autoassess-dev". */
  sourceLabel: string;
  loadedAt: string;
  vessels: Vessel[];
  areas: Area[];
  plans: InspectionPlan[];
  tasks: InspectionTask[];
  elements: StructuralElement[];
}
