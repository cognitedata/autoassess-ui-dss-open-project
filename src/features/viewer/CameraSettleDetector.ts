import { Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

import type { CameraPose } from './cameraParam';

/**
 * Tells when the camera has come to rest after moving, so the current view can be written
 * to the URL (`?camera=`) without doing it on every animation frame.
 */
export class CameraSettleDetector {
  private readonly lastPosition = new Vector3();
  private readonly lastQuaternion = new Quaternion();
  private movedAt: number | null = null;

  constructor(private readonly settleMs = 600) {}

  /** Take the camera's current pose as the baseline without reporting it (e.g. after the initial fit). */
  reset(camera: PerspectiveCamera): void {
    this.lastPosition.copy(camera.position);
    this.lastQuaternion.copy(camera.quaternion);
    this.movedAt = null;
  }

  /** Call once per frame. Returns true exactly once when the camera has been still for `settleMs`. */
  update(camera: PerspectiveCamera, now: number): boolean {
    if (!camera.position.equals(this.lastPosition) || !camera.quaternion.equals(this.lastQuaternion)) {
      this.lastPosition.copy(camera.position);
      this.lastQuaternion.copy(camera.quaternion);
      this.movedAt = now;
      return false;
    }
    if (this.movedAt !== null && now - this.movedAt >= this.settleMs) {
      this.movedAt = null;
      return true;
    }
    return false;
  }
}

export function poseFromCamera(camera: PerspectiveCamera): CameraPose {
  const forward = camera.getWorldDirection(new Vector3());
  const target = camera.position.clone().add(forward);
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
  };
}
