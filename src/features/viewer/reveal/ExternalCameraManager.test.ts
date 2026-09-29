import { Box3, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalCameraManager } from './ExternalCameraManager';

describe(ExternalCameraManager.name, () => {
  let camera: PerspectiveCamera;
  let now: number;
  let manager: ExternalCameraManager;

  beforeEach(() => {
    camera = new PerspectiveCamera(60, 1, 0.01, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    now = 0;
    manager = new ExternalCameraManager(camera, { stopDelayMs: 100, now: () => now });
  });

  it('should expose the camera it was given', () => {
    expect(manager.getCamera()).toBe(camera);
  });

  it('should report a target one unit in front of the camera', () => {
    const state = manager.getCameraState();

    expect(state.position.toArray()).toEqual([0, 0, 10]);
    expect(state.target.x).toBeCloseTo(0);
    expect(state.target.z).toBeCloseTo(9);
    expect(state.rotation).toBeInstanceOf(Quaternion);
  });

  it('should apply position and target from setCameraState', () => {
    manager.setCameraState({ position: new Vector3(5, 0, 0), target: new Vector3(0, 0, 0) });

    expect(camera.position.toArray()).toEqual([5, 0, 0]);
    const forward = camera.getWorldDirection(new Vector3());
    expect(forward.x).toBeCloseTo(-1);
  });

  it('should emit cameraChange from update when the camera moved', () => {
    const onChange = vi.fn();
    manager.on('cameraChange', onChange);
    manager.update(0.016, new Box3());
    onChange.mockClear();

    camera.position.x += 1;
    manager.update(0.016, new Box3());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as Vector3).x).toBe(1);
  });

  it('should not emit cameraChange when nothing moved', () => {
    const onChange = vi.fn();
    manager.update(0.016, new Box3());
    manager.on('cameraChange', onChange);

    manager.update(0.016, new Box3());

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should emit cameraStop once the camera has been still for the stop delay', () => {
    const onStop = vi.fn();
    manager.on('cameraStop', onStop);
    manager.update(0.016, new Box3());
    camera.position.x += 1;
    manager.update(0.016, new Box3());

    now = 50;
    manager.update(0.016, new Box3());
    expect(onStop).not.toHaveBeenCalled();

    now = 150;
    manager.update(0.016, new Box3());
    expect(onStop).toHaveBeenCalledTimes(1);

    now = 400;
    manager.update(0.016, new Box3());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('should stop notifying listeners after off and dispose', () => {
    const onChange = vi.fn();
    manager.on('cameraChange', onChange);
    manager.off('cameraChange', onChange);
    camera.position.x += 1;
    manager.update(0.016, new Box3());
    expect(onChange).not.toHaveBeenCalled();

    const other = vi.fn();
    manager.on('cameraChange', other);
    manager.dispose();
    camera.position.x += 1;
    manager.update(0.016, new Box3());
    expect(other).not.toHaveBeenCalled();
  });

  it('should frame a bounding box when asked to fit', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));

    manager.fitCameraToBoundingBox(box);

    const forward = camera.getWorldDirection(new Vector3());
    const toCentre = new Vector3().sub(camera.position).normalize();
    expect(forward.dot(toCentre)).toBeCloseTo(1);
    expect(camera.position.length()).toBeGreaterThan(2);
  });
});
