import type { StructuralElement } from '../features/viewer/StructuralElementService';

export function createMockStructuralElement(
  overrides: Partial<StructuralElement> = {},
): StructuralElement {
  return {
    space: 'autoassess',
    externalId: 'element-2-11',
    elementType: 'longitudinal',
    label: 2011,
    center: [4.17074, 0.237193, 0.844808],
    areaExternalId: 'area-01581',
    ...overrides,
  };
}
