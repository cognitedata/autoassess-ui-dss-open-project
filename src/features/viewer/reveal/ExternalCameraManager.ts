import type {
  CameraChangeDelegate,
  CameraManager,
  CameraManagerEventType,
  CameraState,
  CameraStopDelegate,
} from '@cognite/reveal';
import { Quaternion, Vector3 } from 'three';
import type { Box3, PerspectiveCamera } from 'three';

type Options = {
  /** Idle time after the last movement before `cameraStop` fires (Reveal loads detail then). */
  stopDelayMs?: number;
  now?: () => number;
};

/**
 * A Reveal CameraManager that does not own any input handling.
 *
 * The viewer drives its own PerspectiveCamera (first-person / ground-plane controls,
 * keyboard, fly-to animations). Reveal calls `update()` every frame; this manager only
 * detects that the camera moved and emits `cameraChange` / a debounced `cameraStop`,
 * which Reveal uses to schedule sector loading and redraws.
 */
export class ExternalCameraManager implements CameraManager {
  private readonly changeListeners = new Set<CameraChangeDelegate>();
  private readonly stopListeners = new Set<CameraStopDelegate>();
  private readonly lastPosition = new Vector3(Number.NaN, 0, 0);
  private readonly lastQuaternion = new Quaternion();
  private lastMoveAt: number | null = null;
  private readonly stopDelayMs: number;
  private readonly now: () => number;

  constructor(
    private readonly camera: PerspectiveCamera,
    { stopDelayMs = 150, now = () => performance.now() }: Options = {},
  ) {
    this.stopDelayMs = stopDelayMs;
    this.now = now;
  }

  getCamera(): PerspectiveCamera {
    return this.camera;
  }

  setCameraState(state: CameraState): void {
    if (state.position) this.camera.position.copy(state.position);
    if (state.rotation) this.camera.quaternion.copy(state.rotation);
    else if (state.target) this.camera.lookAt(state.target);
    this.camera.updateMatrixWorld();
  }

  getCameraState(): Required<CameraState> {
    const forward = this.camera.getWorldDirection(new Vector3());
    return {
      position: this.camera.position.clone(),
      target: this.camera.position.clone().add(forward),
      rotation: this.camera.quaternion.clone(),
    };
  }

  activate(): void {}

  deactivate(): void {}

  on(event: 'cameraChange', callback: CameraChangeDelegate): void;
  on(event: 'cameraStop', callback: CameraStopDelegate): void;
  on(event: CameraManagerEventType, callback: CameraChangeDelegate | CameraStopDelegate): void {
    if (event === 'cameraChange') this.changeListeners.add(callback as CameraChangeDelegate);
    else this.stopListeners.add(callback as CameraStopDelegate);
  }

  off(event: 'cameraChange', callback: CameraChangeDelegate): void;
  off(event: 'cameraStop', callback: CameraStopDelegate): void;
  off(event: CameraManagerEventType, callback: CameraChangeDelegate | CameraStopDelegate): void {
    if (event === 'cameraChange') this.changeListeners.delete(callback as CameraChangeDelegate);
    else this.stopListeners.delete(callback as CameraStopDelegate);
  }

  fitCameraToBoundingBox(boundingBox: Box3): void {
    const centre = boundingBox.getCenter(new Vector3());
    const size = boundingBox.getSize(new Vector3()).length();
    this.camera.position.copy(centre).add(new Vector3(0, size * 0.3, size * 0.6));
    this.camera.lookAt(centre);
    this.camera.updateMatrixWorld();
  }

  update(_deltaTime: number, _boundingBox: Box3): void {
    const moved =
      !this.camera.position.equals(this.lastPosition) ||
      !this.camera.quaternion.equals(this.lastQuaternion);
    if (moved) {
      this.lastPosition.copy(this.camera.position);
      this.lastQuaternion.copy(this.camera.quaternion);
      this.lastMoveAt = this.now();
      const { position, target } = this.getCameraState();
      this.changeListeners.forEach((listener) => listener(position, target));
      return;
    }
    if (this.lastMoveAt !== null && this.now() - this.lastMoveAt >= this.stopDelayMs) {
      this.lastMoveAt = null;
      this.stopListeners.forEach((listener) => listener());
    }
  }

  dispose(): void {
    this.changeListeners.clear();
    this.stopListeners.clear();
  }
}
