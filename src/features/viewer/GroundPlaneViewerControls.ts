import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

// Reusable objects — allocated once per module to avoid per-event GC pressure
const _forward = new Vector3();
const _right = new Vector3();
const _panRight = new Vector3();
const _panForward = new Vector3();
const _yawQ = new Quaternion();
const _pitchQ = new Quaternion();

const MAX_PITCH = (85 * Math.PI) / 180; // rad

/**
 * Ground-plane-stabilised camera controls for navigating along a known floor surface.
 *
 * - Left-button drag: yaw around the ground normal (world-space) + pitch around camera right
 *   Pitch is clamped to ±85° so the horizon stays recoverable.
 * - Right/middle-button drag: pan along the ground plane (no drift perpendicular to floor)
 * - Scroll wheel: dolly forward/backward along view axis
 *
 * All mutations happen directly in event handlers; no update() loop is needed.
 */
export class GroundPlaneViewerControls {
  rotateSpeed = 0.003; // rad/px
  panSpeed = 0.005;    // world units/px
  scrollSpeed = 0.01;  // world units per wheel unit
  /** Called whenever the user actively moves the camera (drag or scroll). Use to abort programmatic fly-to animations. */
  onNavigate: (() => void) | null = null;

  private _camera: PerspectiveCamera;
  private _domElement: HTMLElement;
  private _groundNormal: Vector3;

  private _dragging: 'rotate' | 'pan' | null = null;
  private _prevX = 0;
  private _prevY = 0;

  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: (e: PointerEvent) => void;
  private _onPointerUp: (e: PointerEvent) => void;
  private _onWheel: (e: WheelEvent) => void;

  constructor(camera: PerspectiveCamera, domElement: HTMLElement, groundNormal: Vector3) {
    this._camera = camera;
    this._domElement = domElement;
    this._groundNormal = groundNormal.clone().normalize();

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
    // Yaw: rotate around the ground normal in world space (premultiply = world-space).
    // This keeps the horizon level regardless of camera tilt.
    _yawQ.setFromAxisAngle(this._groundNormal, -dx * this.rotateSpeed);
    this._camera.quaternion.premultiply(_yawQ);

    // Pitch: clamp by reading the current pitch from the post-yaw camera direction.
    // Computing it fresh each frame keeps the clamp correct after any external
    // orientation change (e.g. reset roll, Z/X keyboard roll).
    this._camera.getWorldDirection(_forward);
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, _forward.dot(this._groundNormal))));
    const pitchDelta = -dy * this.rotateSpeed;
    const newPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, currentPitch + pitchDelta));
    const clampedDelta = newPitch - currentPitch;
    if (Math.abs(clampedDelta) > 1e-10) {
      _right.set(1, 0, 0).applyQuaternion(this._camera.quaternion);
      _pitchQ.setFromAxisAngle(_right, clampedDelta);
      this._camera.quaternion.premultiply(_pitchQ);
    }
  }

  private _applyPan(dx: number, dy: number): void {
    // Pan along the ground plane: project camera right and camera forward onto
    // the ground plane so movement never drifts toward or away from the floor.
    _right.set(1, 0, 0).applyQuaternion(this._camera.quaternion);
    _panRight.copy(_right).addScaledVector(this._groundNormal, -_right.dot(this._groundNormal));
    if (_panRight.lengthSq() > 1e-10) _panRight.normalize();

    this._camera.getWorldDirection(_forward);
    _panForward.copy(_forward).addScaledVector(this._groundNormal, -_forward.dot(this._groundNormal));
    if (_panForward.lengthSq() > 1e-10) _panForward.normalize();

    this._camera.position.addScaledVector(_panRight, dx * this.panSpeed);
    this._camera.position.addScaledVector(_panForward, -dy * this.panSpeed);
  }
}
