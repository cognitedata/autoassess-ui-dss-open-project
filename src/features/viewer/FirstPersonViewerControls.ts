import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

// Reusable objects — allocated once per module to avoid per-event GC pressure
const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _yawQ = new Quaternion();
const _pitchQ = new Quaternion();

/**
 * First-person camera controls for navigating confined 3D spaces.
 *
 * - Left-button drag: rotate camera in place (pitch + yaw)
 * - Right-button drag: pan camera (slide position, preserve orientation)
 * - Scroll wheel: dolly forward/backward along view axis
 *
 * All mutations happen directly in event handlers; no update() loop is needed.
 */
export class FirstPersonViewerControls {
  rotateSpeed = 0.003; // rad/px
  panSpeed = 0.005;    // world units/px
  scrollSpeed = 0.01;  // world units per wheel unit
  /** Called whenever the user actively moves the camera (drag or scroll). Use to abort programmatic fly-to animations. */
  onNavigate: (() => void) | null = null;

  private _camera: PerspectiveCamera;
  private _domElement: HTMLElement;

  private _dragging: 'rotate' | 'pan' | null = null;
  private _prevX = 0;
  private _prevY = 0;

  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: (e: PointerEvent) => void;
  private _onPointerUp: (e: PointerEvent) => void;
  private _onWheel: (e: WheelEvent) => void;

  constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
    this._camera = camera;
    this._domElement = domElement;

    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);

    domElement.addEventListener('pointerdown', this._onPointerDown);
    // Move and up are on window so drags that leave the element still work
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: true });
  }

  dispose(): void {
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this._domElement.removeEventListener('wheel', this._onWheel);
    this._dragging = null;
  }

  private _handlePointerDown(e: PointerEvent): void {
    if (e.button === 0) {
      this._dragging = 'rotate';
    } else if (e.button === 1 || e.button === 2) {
      this._dragging = 'pan';
    } else {
      return;
    }
    this._prevX = e.clientX;
    this._prevY = e.clientY;
  }

  private _handlePointerMove(e: PointerEvent): void {
    if (!this._dragging) return;

    const dx = e.clientX - this._prevX;
    const dy = e.clientY - this._prevY;
    this._prevX = e.clientX;
    this._prevY = e.clientY;

    if (this._dragging === 'rotate') {
      this._applyRotation(dx, dy);
    } else {
      this._applyPan(dx, dy);
    }
    this.onNavigate?.();
  }

  private _handlePointerUp(e: PointerEvent): void {
    // Only clear the drag when the initiating button is released
    if (
      (this._dragging === 'rotate' && e.button === 0) ||
      (this._dragging === 'pan' && (e.button === 1 || e.button === 2))
    ) {
      this._dragging = null;
    }
  }

  private _handleWheel(e: WheelEvent): void {
    this._camera.getWorldDirection(_forward);
    this._camera.position.addScaledVector(_forward, -e.deltaY * this.scrollSpeed);
    this.onNavigate?.();
  }

  private _applyRotation(dx: number, dy: number): void {
    // Yaw around camera local Y (multiply = local-space, always turns head left/right)
    _yawQ.setFromAxisAngle(_up.set(0, 1, 0), -dx * this.rotateSpeed);
    this._camera.quaternion.multiply(_yawQ);
    // Pitch around camera local X (multiply = local-space, always tilts head up/down)
    _pitchQ.setFromAxisAngle(_right.set(1, 0, 0), -dy * this.rotateSpeed);
    this._camera.quaternion.multiply(_pitchQ);
  }

  private _applyPan(dx: number, dy: number): void {
    // True camera-local axes — pan tracks what you see on screen regardless of tilt
    _right.set(1, 0, 0).applyQuaternion(this._camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this._camera.quaternion);
    this._camera.position.addScaledVector(_right, dx * this.panSpeed);
    this._camera.position.addScaledVector(_up, -dy * this.panSpeed);
  }
}
