import { PerspectiveCamera } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import { CameraSettleDetector, poseFromCamera } from './CameraSettleDetector';

describe(CameraSettleDetector.name, () => {
  let camera: PerspectiveCamera;
  let detector: CameraSettleDetector;

  beforeEach(() => {
    camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);
    detector = new CameraSettleDetector(500);
    detector.reset(camera);
  });

  it('should not report while the camera has not moved', () => {
    expect(detector.update(camera, 0)).toBe(false);
    expect(detector.update(camera, 2000)).toBe(false);
  });

  it('should report once the camera has been still for the settle time after moving', () => {
    camera.position.x = 1;
    expect(detector.update(camera, 100)).toBe(false);
    expect(detector.update(camera, 400)).toBe(false);
    expect(detector.update(camera, 700)).toBe(true);
  });

  it('should report only once per movement', () => {
    camera.position.x = 1;
    detector.update(camera, 100);
    detector.update(camera, 700);

    expect(detector.update(camera, 1500)).toBe(false);
  });

  it('should restart the settle timer while the camera keeps moving', () => {
    camera.position.x = 1;
    detector.update(camera, 100);
    camera.position.x = 2;
    detector.update(camera, 500);

    expect(detector.update(camera, 700)).toBe(false);
    expect(detector.update(camera, 1100)).toBe(true);
  });

  it('should treat a rotation as movement', () => {
    camera.rotation.y = 0.5;
    camera.updateMatrixWorld();
    detector.update(camera, 100);

    expect(detector.update(camera, 700)).toBe(true);
  });

  it('should not report a pose that was set as the baseline with reset', () => {
    camera.position.x = 5;
    detector.reset(camera);

    expect(detector.update(camera, 100)).toBe(false);
    expect(detector.update(camera, 1000)).toBe(false);
  });
});

describe(poseFromCamera.name, () => {
  it('should return the position and a target one unit along the view direction', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(1, 2, 3);
    camera.lookAt(1, 2, 0);

    const pose = poseFromCamera(camera);

    expect(pose.position).toEqual([1, 2, 3]);
    expect(pose.target[0]).toBeCloseTo(1);
    expect(pose.target[1]).toBeCloseTo(2);
    expect(pose.target[2]).toBeCloseTo(2);
  });
});
