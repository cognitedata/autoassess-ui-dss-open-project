import type { Area } from '../features/areas/AreaService';

export function createMockArea(overrides: Partial<Area> = {}): Area {
  return {
    space: 'autoassess',
    externalId: 'area-01581',
    name: 'Ballast Water Tank 01581',
    areaType: 'BWT',
    vesselExternalId: 'vessel-test',
    ...overrides,
  };
}
