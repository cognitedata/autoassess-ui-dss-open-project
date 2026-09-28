import { describe, expect, it } from 'vitest';

// Drift guard against the repo's authoritative data model (read-only import, test-only).
import * as root from '../../../src/shared/cdf/dataModel';
import * as local from './cdfModel';

describe('cdfModel mirror', () => {
  it.each([
    'AUTOASSESS_SPACE',
    'VESSEL_VIEW',
    'AREA_VIEW',
    'INSPECTION_PLAN_VIEW',
    'INSPECTION_TASK_VIEW',
    'STRUCTURAL_ELEMENT_VIEW',
    'VESSEL_CONTAINER',
    'AREA_CONTAINER',
    'INSPECTION_PLAN_CONTAINER',
  ] as const)('should match the root data model for %s', (name) => {
    expect(local[name]).toEqual(root[name]);
  });

  it('should build view keys and container property paths like the root app', () => {
    expect(local.getViewKey(local.AREA_VIEW)).toBe(root.getViewKey(root.AREA_VIEW));
    expect(local.getContainerProperty(local.AREA_CONTAINER, 'vessel')).toEqual(
      root.getContainerProperty(root.AREA_CONTAINER, 'vessel'),
    );
  });
});
