import { describe, expect, it } from 'vitest';

import { angleWithinFov, createRng, rotateDirection, sensorRayDirections } from './math';

describe(createRng.name, () => {
  it('should repeat the same sequence for the same seed', () => {
    const a = createRng(7);
    const b = createRng(7);

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('should give different sequences for different seeds, all in [0, 1)', () => {
    const a = Array.from({ length: 200 }, createRng(1));
    const b = Array.from({ length: 200 }, createRng(2));

    expect(a).not.toEqual(b);
    expect(a.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe(sensorRayDirections.name, () => {
  it('should cover a full circle without duplicating the seam for a 360° sensor', () => {
    const dirs = sensorRayDirections(2 * Math.PI, Math.PI / 2, Math.PI / 18);

    // 36 headings x 10 elevations (-45°..45° in 10° steps).
    expect(dirs.length).toBe(36 * 10);
    expect(dirs.every((d) => Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-9)).toBe(true);
  });

  it('should stay inside a camera field of view', () => {
    const dirs = sensorRayDirections((80 * Math.PI) / 180, (60 * Math.PI) / 180, (5 * Math.PI) / 180);

    expect(dirs.length).toBe(17 * 13);
    expect(Math.max(...dirs.map((d) => Math.abs(Math.atan2(d[1], d[0]))))).toBeCloseTo((40 * Math.PI) / 180);
    expect(Math.max(...dirs.map((d) => Math.asin(d[2])))).toBeCloseTo((30 * Math.PI) / 180);
  });
});

describe(rotateDirection.name, () => {
  it('should turn +x by yaw counter-clockwise and tilt it up by a positive pitch', () => {
    const left = rotateDirection([1, 0, 0], Math.PI / 2, 0);
    const up = rotateDirection([1, 0, 0], 0, Math.PI / 2);

    expect(left.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 1, 0]);
    expect(up.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, 1]);
  });
});

describe(angleWithinFov.name, () => {
  it('should accept a direction inside the frustum and reject one outside', () => {
    const hFov = (80 * Math.PI) / 180;
    const vFov = (60 * Math.PI) / 180;

    expect(angleWithinFov([1, 0.5, 0.2], 0, 0, hFov, vFov)).toBe(true);
    expect(angleWithinFov([1, 1.5, 0], 0, 0, hFov, vFov)).toBe(false);
    expect(angleWithinFov([0, 1, 0], Math.PI / 2, 0, hFov, vFov)).toBe(true);
    expect(angleWithinFov([1, 0, 1], 0, 0, hFov, vFov)).toBe(false);
    expect(angleWithinFov([1, 0, 1], 0, 0.6, hFov, vFov)).toBe(true);
  });
});
