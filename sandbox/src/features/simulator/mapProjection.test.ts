import { describe, expect, it } from 'vitest';

import { emptyMap, setVoxel } from '../../__mocks__/planner';
import { cellKindAt, projectPlannerMap } from './mapProjection';
import { SIDE_VIEW, TOP_VIEW } from './projection';

describe(projectPlannerMap.name, () => {
  it('should size the grid to the view axes', () => {
    const top = projectPlannerMap(emptyMap(), TOP_VIEW);
    const side = projectPlannerMap(emptyMap(), SIDE_VIEW);

    expect([top.cols, top.rows, top.resolution]).toEqual([4, 3, 1]);
    expect([side.cols, side.rows]).toEqual([4, 3]);
    expect(top.origin).toEqual([0, 0]);
  });

  it('should keep the earliest time a column was seen, per kind', () => {
    const map = emptyMap([4, 3, 5]);
    setVoxel(map, [1, 2, 1], 1, 8);
    setVoxel(map, [1, 2, 3], 1, 5);
    const top = projectPlannerMap(map, TOP_VIEW);
    const index = 1 + top.cols * 2;

    expect(top.freeAt[index]).toBe(5);
    expect(top.occupiedAt[index]).toBe(-1);
    expect(top.inspectedAt[index]).toBe(-1);
  });

  it('should take the minimum over the depth axis', () => {
    const map = emptyMap([4, 3, 5]);
    setVoxel(map, [2, 1, 1], 2, 9);
    setVoxel(map, [2, 1, 2], 2, 4, 6);
    setVoxel(map, [2, 1, 3], 2, 7, 3);
    const top = projectPlannerMap(map, TOP_VIEW);

    expect(top.occupiedAt[2 + top.cols * 1]).toBe(4);
    expect(top.inspectedAt[2 + top.cols * 1]).toBe(3);
  });

  it('should leave out the boundary layers along the depth axis (floor and ceiling in the top view)', () => {
    const map = emptyMap();
    setVoxel(map, [0, 0, 0], 2, 1, 1);
    setVoxel(map, [0, 0, 2], 2, 1);
    const top = projectPlannerMap(map, TOP_VIEW);
    const side = projectPlannerMap(map, SIDE_VIEW);

    expect(top.occupiedAt[0]).toBe(-1);
    expect(top.inspectedAt[0]).toBe(-1);
    // In the side view (depth = y) the floor voxel at j = 0 is a boundary layer too...
    expect(side.occupiedAt[0]).toBe(-1);
  });

  it('should show the side walls in the top view (they are not along the depth axis)', () => {
    const map = emptyMap();
    setVoxel(map, [2, 0, 1], 2, 2);
    const top = projectPlannerMap(map, TOP_VIEW);

    expect(top.occupiedAt[2]).toBe(2);
  });
});

describe(cellKindAt.name, () => {
  it('should report unknown, free, occupied and inspected by time, structure over free space', () => {
    const map = emptyMap([4, 3, 5]);
    setVoxel(map, [1, 1, 1], 1, 1);
    setVoxel(map, [1, 1, 2], 2, 3, 6);
    const top = projectPlannerMap(map, TOP_VIEW);
    const index = 1 + top.cols * 1;

    expect(cellKindAt(top, index, 0.5)).toBe('unknown');
    expect(cellKindAt(top, index, 1)).toBe('free');
    expect(cellKindAt(top, index, 4)).toBe('occupied');
    expect(cellKindAt(top, index, 6)).toBe('inspected');
  });
});
