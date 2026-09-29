import type { ElementType, InspectionType, TaskKind, Vec3 } from './types';

/**
 * The plan.json format written by `dss plan download` / `client.plans.download(...)`
 * (sdk/src/uidss/services/plan_service.py `_build_plan_json`). This is what a ground station
 * hands to its planner, so it is also what the simulated drone accepts.
 */
export interface PlanJsonTask {
  id: string;
  kind: TaskKind;
  inspectionType: InspectionType;
  targetElement?: { externalId: string; type: ElementType; center: Vec3 };
  position3d?: Vec3;
  normalVector?: Vec3;
  radiusM?: number;
}

export interface PlanJson {
  planExternalId: string;
  name: string | null;
  description: string | null;
  areaExternalId: string;
  areaName: string;
  mapExternalId: string | null;
  downloadedAt: string;
  tasks: PlanJsonTask[];
}

export class PlanJsonError extends Error {
  override name = 'PlanJsonError';
}

/** Validate an untrusted value (from Python) as a PlanJson; throws PlanJsonError with a path. */
export function parsePlanJson(value: unknown): PlanJson {
  const obj = asRecord(value, 'plan');
  const tasksRaw = obj['tasks'];
  if (!Array.isArray(tasksRaw)) throw new PlanJsonError('plan.tasks must be a list');
  return {
    planExternalId: requireString(obj, 'planExternalId', 'plan'),
    name: optionalString(obj, 'name'),
    description: optionalString(obj, 'description'),
    areaExternalId: requireString(obj, 'areaExternalId', 'plan'),
    areaName: optionalString(obj, 'areaName') ?? '',
    mapExternalId: optionalString(obj, 'mapExternalId'),
    downloadedAt: optionalString(obj, 'downloadedAt') ?? '',
    tasks: tasksRaw.map((t, i) => parseTask(t, `plan.tasks[${i}]`)),
  };
}

function parseTask(value: unknown, path: string): PlanJsonTask {
  const obj = asRecord(value, path);
  const kind = obj['kind'];
  if (kind !== 'element' && kind !== 'region') {
    throw new PlanJsonError(`${path}.kind must be "element" or "region"`);
  }
  const inspectionType = obj['inspectionType'];
  if (inspectionType !== 'visual' && inspectionType !== 'ndt_thickness') {
    throw new PlanJsonError(`${path}.inspectionType must be "visual" or "ndt_thickness"`);
  }
  const task: PlanJsonTask = { id: requireString(obj, 'id', path), kind, inspectionType };
  if (obj['targetElement'] !== undefined && obj['targetElement'] !== null) {
    const el = asRecord(obj['targetElement'], `${path}.targetElement`);
    task.targetElement = {
      externalId: requireString(el, 'externalId', `${path}.targetElement`),
      type: (optionalString(el, 'type') ?? 'longitudinal') as ElementType,
      center: parseVec3(el['center'], `${path}.targetElement.center`),
    };
  }
  if (obj['position3d'] != null) task.position3d = parseVec3(obj['position3d'], `${path}.position3d`);
  if (obj['normalVector'] != null) {
    task.normalVector = parseVec3(obj['normalVector'], `${path}.normalVector`);
  }
  if (typeof obj['radiusM'] === 'number') task.radiusM = obj['radiusM'];
  return task;
}

function parseVec3(value: unknown, path: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    throw new PlanJsonError(`${path} must be a list of 3 numbers`);
  }
  return [value[0], value[1], value[2]];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlanJsonError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v === '') throw new PlanJsonError(`${path}.${key} must be a string`);
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}
