import type {
  Area,
  InspectionPlan,
  InspectionTask,
  StructuralElement,
  Vec3,
  Vessel,
} from '../domain/types';
import { BWT3P_ELEMENT_ROWS } from './bwt3pElements';

/**
 * Bundled demo data so the sandbox works standalone (no Fusion, no CDF). Shapes match what the
 * live CDF source produces. ExternalIds are prefixed "demo-" so they can never be confused with
 * real CDF data.
 */
const SPACE = 'autoassess';
const VESSEL = 'demo-vessel';
const BWT = 'demo-area-bwt3p';
const HOLD = 'demo-area-hold2';

export const DEMO_VESSELS: Vessel[] = [
  { space: SPACE, externalId: VESSEL, name: 'Demo Vessel (sandbox)', vesselType: 'bulk_carrier' },
];

export const DEMO_AREAS: Omit<Area, 'bounds'>[] = [
  { space: SPACE, externalId: BWT, name: 'BWT 3P', areaType: 'BWT', vesselExternalId: VESSEL },
  { space: SPACE, externalId: HOLD, name: 'Cargo Hold 2', areaType: 'Hold', vesselExternalId: VESSEL },
];

const HOLD2_ELEMENTS: ReadonlyArray<readonly [number, StructuralElement['elementType'], Vec3]> = [
  [1001, 'manhole', [0.5, 0, 0.3]],
  [3001, 'wall', [4, -3, 2]],
  [3002, 'wall', [4, 3, 2]],
  [2001, 'longitudinal', [2, -2.5, 3.5]],
  [2002, 'longitudinal', [6, 2.5, 3.5]],
  [4001, 'compartment', [7.5, 0, 4]],
];

export const DEMO_ELEMENTS: StructuralElement[] = [
  ...BWT3P_ELEMENT_ROWS.map(([label, elementType, center]) => element(BWT, label, elementType, center)),
  ...HOLD2_ELEMENTS.map(([label, elementType, center]) => element(HOLD, label, elementType, center)),
];

export const DEMO_PLANS: InspectionPlan[] = [
  plan('demo-plan-followup', BWT, 'Ready', '2026-09-24T09:00:00Z', 'Tank 3 follow-up', 'Re-check corroded longitudinals'),
  plan('demo-plan-ndt-sweep', BWT, 'Ready', '2026-09-20T14:30:00Z', 'NDT sweep – port side', 'UT thickness along the port shell'),
  plan('demo-plan-draft', BWT, 'Draft', '2026-09-25T16:10:00Z', 'Draft – needs review', 'Work in progress: has problems on purpose'),
  plan('demo-plan-hold2', HOLD, 'Complete', '2026-08-30T08:00:00Z', 'Hold 2 visual', null),
];

export const DEMO_TASKS: InspectionTask[] = [
  // Tank 3 follow-up: element + region tasks, all valid.
  elementTask('demo-plan-followup', 1, BWT, 2011, 'visual'),
  elementTask('demo-plan-followup', 2, BWT, 2027, 'visual'),
  elementTask('demo-plan-followup', 3, BWT, 2070, 'ndt_thickness'),
  elementTask('demo-plan-followup', 4, BWT, 2116, 'visual'),
  elementTask('demo-plan-followup', 5, BWT, 4004, 'visual'),
  regionTask('demo-plan-followup', 6, [2.2, 1.09, 0.92], [0, -1, 0], 'ndt_thickness'),
  regionTask('demo-plan-followup', 7, [8.86, -0.62, 1.3], [0, 1, 0], 'visual'),
  regionTask('demo-plan-followup', 8, [5.1, 0.4, 2.6], [0, 0, -1], 'ndt_thickness'),
  // NDT sweep: region tasks along the port side, facing inboard.
  ...[1.0, 3.0, 5.0, 7.0, 9.0, 11.0].map((x, i) =>
    regionTask('demo-plan-ndt-sweep', i + 1, [x, -1.8, 1.2], [0, 1, 0], 'ndt_thickness'),
  ),
  // Draft: deliberately broken for the verification example.
  {
    ...taskBase('demo-plan-draft', 1, 'element', 'visual'),
    targetElement: null, // element was deleted -> no pose
  },
  regionTask('demo-plan-draft', 2, [14.5, 0.2, 1.0], [0, -1, 0], 'visual'), // outside the tank
  { ...regionTask('demo-plan-draft', 3, [6.0, 0.5, 1.5], [0, 0, 0], 'ndt_thickness'), normalVector: null },
  elementTask('demo-plan-draft', 4, BWT, 3004, 'visual'),
  // Hold 2 (Complete).
  elementTask('demo-plan-hold2', 1, HOLD, 3001, 'visual'),
  elementTask('demo-plan-hold2', 2, HOLD, 3002, 'visual'),
  elementTask('demo-plan-hold2', 3, HOLD, 4001, 'visual'),
];

function element(area: string, label: number, elementType: StructuralElement['elementType'], center: Vec3): StructuralElement {
  return { space: SPACE, externalId: `${area}-elem-${label}`, areaExternalId: area, elementType, label, center };
}

function plan(
  externalId: string,
  area: string,
  status: InspectionPlan['status'],
  created: string,
  name: string,
  description: string | null,
): InspectionPlan {
  return {
    space: SPACE,
    externalId,
    areaExternalId: area,
    status,
    createdTime: Date.parse(created),
    lastUpdatedTime: Date.parse(created), // demo plans were never edited after creation
    name,
    description,
    mapExternalId: `demo-campaign-${area}`,
  };
}

function taskBase(
  planId: string,
  n: number,
  kind: InspectionTask['kind'],
  inspectionType: InspectionTask['inspectionType'],
): InspectionTask {
  return {
    space: SPACE,
    externalId: `${planId}-task-${n}`,
    planExternalId: planId,
    kind,
    inspectionType,
    targetElement: null,
    position3d: null,
    normalVector: null,
    radiusM: null,
  };
}

function elementTask(
  planId: string,
  n: number,
  area: string,
  label: number,
  inspectionType: InspectionTask['inspectionType'],
): InspectionTask {
  const el = DEMO_ELEMENTS.find((e) => e.externalId === `${area}-elem-${label}`);
  if (!el) throw new Error(`demo fixture: unknown element ${area}/${label}`);
  return {
    ...taskBase(planId, n, 'element', inspectionType),
    targetElement: { externalId: el.externalId, elementType: el.elementType, center: el.center },
  };
}

function regionTask(
  planId: string,
  n: number,
  position3d: Vec3,
  normalVector: Vec3,
  inspectionType: InspectionTask['inspectionType'],
): InspectionTask {
  return { ...taskBase(planId, n, 'region', inspectionType), position3d, normalVector, radiusM: 0.3 };
}
