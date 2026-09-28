import { describe, expect, it } from 'vitest';

import { createGrid, gridBox, voxelCenter, voxelIndex, voxelOf, worldBox } from './grid';

describe(createGrid.name, () => {
  it('should use the base resolution when the box is small enough', () => {
    const grid = createGrid({ min: [0, 0, 0], max: [3, 2, 1.5] }, 0.15, 300_000);

    expect(grid.resolution).toBe(0.15);
    expect(grid.dims).toEqual([20, 14, 10]);
    expect(grid.origin).toEqual([0, 0, 0]);
  });

  it('should coarsen the resolution so a huge box stays under the voxel cap', () => {
    const grid = createGrid({ min: [0, 0, 0], max: [100, 40, 20] }, 0.15, 300_000);

    expect(grid.dims[0] * grid.dims[1] * grid.dims[2]).toBeLessThanOrEqual(300_000);
    expect(grid.resolution).toBeGreaterThan(0.15);
  });
});

describe(voxelOf.name, () => {
  it('should map points to voxels and back to voxel centres', () => {
    const grid = createGrid({ min: [-1, -1, 0], max: [1, 1, 1] }, 0.25, 1e6);

    const v = voxelOf(grid, [0.1, -0.9, 0.6]);

    expect(v).toEqual([4, 0, 2]);
    expect(voxelCenter(grid, voxelIndex(grid, 4, 0, 2))).toEqual([0.125, -0.875, 0.625]);
    expect(voxelOf(grid, [5, 0, 0])).toBeNull();
    expect(gridBox(grid)).toEqual({ min: [-1, -1, 0], max: [1, 1, 1] });
  });
});

describe(worldBox.name, () => {
  it('should keep area bounds that are big enough', () => {
    const box = worldBox({ min: [0, -2, 0], max: [10, 2, 3] }, []);

    expect(box).toEqual({ min: [0, -2, 0], max: [10, 2, 3] });
  });

  it('should grow a flat area to the minimum size around its centre', () => {
    const box = worldBox({ min: [0, 0, 1], max: [6, 0.5, 1.2] }, []);

    expect(box.max[1] - box.min[1]).toBeCloseTo(2);
    expect(box.max[2] - box.min[2]).toBeCloseTo(2);
    expect((box.min[2] + box.max[2]) / 2).toBeCloseTo(1.1);
  });

  it('should fall back to a box around the given points when the area has no bounds', () => {
    const box = worldBox(null, [[0, 0, 0], [4, 1, 1]]);

    expect(box.min).toEqual([-1, -1, -1]);
    expect(box.max).toEqual([5, 2, 2]);
  });
});
