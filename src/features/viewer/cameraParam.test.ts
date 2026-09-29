import { describe, expect, it } from 'vitest';

import { formatCameraParam, parseCameraParam } from './cameraParam';

describe(parseCameraParam.name, () => {
  it('should parse six comma-separated numbers into position and target', () => {
    expect(parseCameraParam('1,2,3,4.5,-5,6e1')).toEqual({
      position: [1, 2, 3],
      target: [4.5, -5, 60],
    });
  });

  it('should return null when the param is missing', () => {
    expect(parseCameraParam(null)).toBeNull();
  });

  it('should return null for the wrong number of values', () => {
    expect(parseCameraParam('1,2,3,4,5')).toBeNull();
  });

  it('should return null when a value is not a finite number', () => {
    expect(parseCameraParam('1,2,3,4,5,abc')).toBeNull();
    expect(parseCameraParam('1,2,3,4,5,Infinity')).toBeNull();
  });

  it('should return null when position equals target', () => {
    expect(parseCameraParam('1,2,3,1,2,3')).toBeNull();
  });
});

describe(formatCameraParam.name, () => {
  it('should round-trip through parseCameraParam', () => {
    const pose = { position: [1.23456, 2, 3] as [number, number, number], target: [4, 5, 6] as [number, number, number] };

    expect(parseCameraParam(formatCameraParam(pose))).toEqual({
      position: [1.2346, 2, 3],
      target: [4, 5, 6],
    });
  });
});
