/**
 * The subset of the AutoAssess CDF data model the sandbox reads. Mirror of the authoritative
 * ../../../src/shared/cdf/dataModel.ts (cdfModel.test.ts fails if the two drift apart).
 * Copied rather than imported so `sandbox/` stays a self-contained Flows app.
 */
export const AUTOASSESS_SPACE = 'autoassess';

export interface ViewRef {
  space: string;
  externalId: string;
  version: string;
}
export interface ContainerRef {
  space: string;
  externalId: string;
}

export const VESSEL_VIEW: ViewRef = { space: AUTOASSESS_SPACE, externalId: 'VesselView', version: '2' };
export const AREA_VIEW: ViewRef = { space: AUTOASSESS_SPACE, externalId: 'AreaView', version: '4' };
export const INSPECTION_PLAN_VIEW: ViewRef = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionPlanView',
  version: '4',
};
export const INSPECTION_TASK_VIEW: ViewRef = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionTaskView',
  version: '1',
};
export const STRUCTURAL_ELEMENT_VIEW: ViewRef = {
  space: AUTOASSESS_SPACE,
  externalId: 'StructuralElementView',
  version: '1',
};

export const VESSEL_CONTAINER: ContainerRef = { space: AUTOASSESS_SPACE, externalId: 'VesselContainer' };
export const AREA_CONTAINER: ContainerRef = { space: AUTOASSESS_SPACE, externalId: 'AreaContainer' };
export const INSPECTION_PLAN_CONTAINER: ContainerRef = {
  space: AUTOASSESS_SPACE,
  externalId: 'InspectionPlanContainer',
};

export function getContainerProperty(container: ContainerRef, property: string): [string, string, string] {
  return [container.space, container.externalId, property];
}

export function getViewKey(view: ViewRef): string {
  return `${view.externalId}/${view.version}`;
}
