import { describe, expect, it } from 'vitest';

import { boundsAround, containsPoint, defaultHome, unionBounds } from './bounds';

describe(boundsAround.name, () => {
  it('should return null for no points', () => {
    expect(boundsAround([])).toBeNull();
  });

  it('should box the points and grow by the margin', () => {
    const bounds = boundsAround(
      [
        [0, 1, 2],
        [4, -1, 3],
      ],
      0.5,
    );
    expect(bounds).toEqual({ min: [-0.5, -1.5, 1.5], max: [4.5, 1.5, 3.5] });
  });
});

describe(containsPoint.name, () => {
  const box = { min: [0, 0, 0], max: [1, 1, 1] } as const;

  it('should include points on the boundary', () => {
    expect(containsPoint({ min: [...box.min], max: [...box.max] }, [1, 0, 0.5])).toBe(true);
  });

  it('should exclude points outside on any axis', () => {
    expect(containsPoint({ min: [...box.min], max: [...box.max] }, [0.5, 0.5, 1.01])).toBe(false);
  });
});

describe(unionBounds.name, () => {
  it('should return the other box when one is null', () => {
    const b = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    expect(unionBounds(null, b)).toBe(b);
    expect(unionBounds(b, null)).toBe(b);
  });

  it('should cover both boxes', () => {
    expect(
      unionBounds({ min: [0, 0, 0], max: [1, 1, 1] }, { min: [-1, 0.5, 0], max: [0.5, 2, 3] }),
    ).toEqual({ min: [-1, 0, 0], max: [1, 2, 3] });
  });
});

describe(defaultHome.name, () => {
  it('should start at the low -x end, centred in y', () => {
    expect(defaultHome({ min: [0, -2, 0.1], max: [10, 2, 3] })).toEqual([0, 0, 0.1]);
  });
});
