import type { Vessel } from '../features/vessels/VesselService';

export function createMockVessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    space: 'autoassess',
    externalId: 'vessel-test',
    name: 'Test Vessel',
    vesselType: 'Bulk Carrier',
    ...overrides,
  };
}
