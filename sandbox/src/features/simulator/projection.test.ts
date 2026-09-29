import { describe, expect, it } from 'vitest';

import { flyAllTasks } from '../../__mocks__/missions';
import { emptyMap, plannerResult } from '../../__mocks__/planner';
import { createProjection, missionViewBounds, SIDE_VIEW, TOP_VIEW } from './projection';

describe(createProjection.name, () => {
  const bounds = { min: [0, 0, 0] as [number, number, number], max: [10, 2, 4] as [number, number, number] };

  it('should fit the wider axis to the canvas and centre the other', () => {
    const proj = createProjection(bounds, TOP_VIEW, 120, 120, 10);

    expect(proj.scale).toBe(10);
    expect(proj.toCanvas([0, 0, 0])).toEqual([10, 70]);
    expect(proj.toCanvas([10, 2, 0])).toEqual([110, 50]);
  });

  it('should put +z up in the side view', () => {
    const proj = createProjection(bounds, SIDE_VIEW, 100, 40, 0);

    const [, low] = proj.toCanvas([0, 0, 0]);
    const [, high] = proj.toCanvas([0, 0, 4]);
    expect(high).toBeLessThan(low);
  });

  it('should not divide by zero for flat bounds', () => {
    const proj = createProjection({ min: [0, 0, 0], max: [0, 0, 0] }, TOP_VIEW, 100, 100);

    expect(Number.isFinite(proj.toCanvas([0, 0, 0])[0])).toBe(true);
  });
});

describe(missionViewBounds.name, () => {
  it('should include the area bounds and every task and home point', () => {
    const mission = flyAllTasks(
      {
        planExternalId: 'p',
        name: null,
        description: null,
        areaExternalId: 'a',
        areaName: 'A',
        mapExternalId: null,
        downloadedAt: '',
        tasks: [{ id: 't', kind: 'region', inspectionType: 'visual', position3d: [5, 0, 0], normalVector: [0, 1, 0] }],
      },
      null,
      { home: [-2, 0, 0], standoffM: 0.8 },
    );

    const b = missionViewBounds(mission);

    expect(b.min[0]).toBe(-2.5);
    expect(b.max[0]).toBe(5.5);
    expect(b.max[1]).toBeCloseTo(1.3);
  });

  it('should include the planner map when a SimGbPlanner flew', () => {
    const mission = flyAllTasks({ ...EMPTY_PLAN }, null, { home: [0, 0, 0] });
    const map = { ...emptyMap([4, 3, 3]), origin: [-1, -1, -1] as [number, number, number] };

    const b = missionViewBounds({ ...mission, planner: plannerResult({ map }) });

    expect(b.min).toEqual([-1, -1, -1]);
    expect(b.max).toEqual([3, 2, 2]);
  });
});

const EMPTY_PLAN = {
  planExternalId: 'p',
  name: null,
  description: null,
  areaExternalId: 'a',
  areaName: 'A',
  mapExternalId: null,
  downloadedAt: '',
  tasks: [],
};
