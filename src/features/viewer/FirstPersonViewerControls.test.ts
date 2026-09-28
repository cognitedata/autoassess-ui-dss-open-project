import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { FirstPersonViewerControls } from './FirstPersonViewerControls';

// Helpers to fire synthetic pointer/wheel events on a DOM element
function pointerDown(el: HTMLElement, button: number, x = 0, y = 0) {
  el.dispatchEvent(new PointerEvent('pointerdown', { button, clientX: x, clientY: y, bubbles: true }));
}

function pointerMove(_el: HTMLElement, x: number, y: number) {
  // pointermove is listened on window, not the element
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
}

function pointerUp(_el: HTMLElement, button: number) {
  window.dispatchEvent(new PointerEvent('pointerup', { button, bubbles: true }));
}

function wheel(el: HTMLElement, deltaY: number) {
  el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }));
}

describe(FirstPersonViewerControls.name, () => {
  let camera: PerspectiveCamera;
  let domElement: HTMLElement;
  let controls: FirstPersonViewerControls;

  beforeEach(() => {
    camera = new PerspectiveCamera(60, 1, 0.01, 1000);
    camera.position.set(0, 0, 5);
    // Camera starts looking toward -Z (default Three.js orientation)

    domElement = document.createElement('div');
    document.body.appendChild(domElement);

    controls = new FirstPersonViewerControls(camera, domElement);
  });

  // ── Rotation (left button) ─────────────────────────────────────────────────

  it('left-drag rightward increases yaw (rotates camera left)', () => {
    const yawBefore = new Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;

    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 150, 100); // dx = +50, dy = 0

    const yawAfter = new Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
    // Dragging right should decrease yaw (camera turns left in world space)
    expect(yawAfter).toBeLessThan(yawBefore);
  });

  it('left-drag downward decreases pitch (camera tilts down)', () => {
    const pitchBefore = new Euler().setFromQuaternion(camera.quaternion, 'YXZ').x;

    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 100, 150); // dx = 0, dy = +50

    const pitchAfter = new Euler().setFromQuaternion(camera.quaternion, 'YXZ').x;
    expect(pitchAfter).toBeLessThan(pitchBefore);
  });

  it('rotation does not change camera position', () => {
    const posBefore = camera.position.clone();

    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 200, 200);

    expect(camera.position.distanceTo(posBefore)).toBeLessThan(1e-6);
  });

  it('rotation allows full pitch range past 90 degrees', () => {
    // Drag exactly 200° downward. With the old ±89° clamp this was impossible;
    // the camera would be stuck at -89° (forward.z < 0 always).
    // With unclamped pitch the camera goes past straight-down and looks backward (forward.z > 0).
    const dragPx = Math.round((200 * Math.PI / 180) / controls.rotateSpeed);

    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 100, 100 + dragPx);

    const forward = new Vector3();
    camera.getWorldDirection(forward);
    // At 200° of pitch the camera is looking backward — a z > 0 component that is
    // impossible with ±89° clamping (which keeps z ≤ 0 at all times).
    expect(forward.z).toBeGreaterThan(0.5);
  });

  it('rotation from a tilted camera does not snap', () => {
    // Pitch camera 45° down first
    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 100, 100 + Math.round(Math.PI / 4 / 0.003)); // ~45° down
    pointerUp(domElement, 0);

    const quatBefore = camera.quaternion.clone();

    // Small yaw drag — quaternion should change continuously, not jump
    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 110, 100); // 10px rightward = small yaw
    pointerUp(domElement, 0);

    const quatAfter = camera.quaternion.clone();
    // Dot product of two unit quaternions ≈ 1 means small rotation (continuous)
    const dot = Math.abs(quatBefore.dot(quatAfter));
    // 10px × rotateSpeed=0.003 = 0.03 rad yaw ≈ cos(0.015) ≈ 0.99989 — well above 0.998
    // A "snap" (large discontinuous jump) would give dot < 0.99
    expect(dot).toBeGreaterThan(0.998);
  });

  it('left-drag rotation stops after pointerup', () => {
    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 150, 100); // some rotation

    const quatAfterDrag = camera.quaternion.clone();

    pointerUp(domElement, 0);
    pointerMove(domElement, 300, 100); // move again — should have no effect

    expect(camera.quaternion.x).toBeCloseTo(quatAfterDrag.x, 10);
    expect(camera.quaternion.y).toBeCloseTo(quatAfterDrag.y, 10);
  });

  // ── Pan (right button) ─────────────────────────────────────────────────────

  it('right-drag moves camera position', () => {
    const posBefore = camera.position.clone();

    pointerDown(domElement, 2, 100, 100);
    pointerMove(domElement, 150, 100); // dx = +50

    expect(camera.position.distanceTo(posBefore)).toBeGreaterThan(0);
  });

  it('right-drag does not change camera orientation', () => {
    const quatBefore = camera.quaternion.clone();

    pointerDown(domElement, 2, 100, 100);
    pointerMove(domElement, 200, 200);

    expect(camera.quaternion.x).toBeCloseTo(quatBefore.x, 10);
    expect(camera.quaternion.y).toBeCloseTo(quatBefore.y, 10);
    expect(camera.quaternion.z).toBeCloseTo(quatBefore.z, 10);
    expect(camera.quaternion.w).toBeCloseTo(quatBefore.w, 10);
  });

  it('right-drag rightward moves camera in the negative X direction (screen right = world right)', () => {
    // Camera at origin looking -Z; right vector = +X
    camera.position.set(0, 0, 0);

    pointerDown(domElement, 2, 100, 100);
    pointerMove(domElement, 200, 100); // dx = +100 (drag right)

    // Panning right should move camera in +X (world right for default orientation)
    expect(camera.position.x).toBeGreaterThan(0);
  });

  it('pan moves along camera axes when camera is tilted 90 degrees', () => {
    // Rotate camera to look straight down (-Y direction): -90° around X.
    // Camera up in world space becomes (0, 0, -1) — pointing world -Z.
    camera.position.set(0, 5, 0);
    camera.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

    // Pan "up" on screen (drag upward, dy = -50).
    // Camera-local pan: moves along camera up = (0, 0, -1) in world space → z decreases.
    // World-horizontal pan (old code): would move along world +Y → y increases.
    pointerDown(domElement, 2, 100, 100);
    pointerMove(domElement, 100, 50); // dy = -50 (drag up)
    pointerUp(domElement, 2);

    expect(camera.position.z).toBeLessThan(0);           // moved in camera-up direction (-Z)
    expect(Math.abs(camera.position.y - 5)).toBeLessThan(0.01); // no world-Y movement
  });

  it('pan stops after pointerup', () => {
    pointerDown(domElement, 2, 100, 100);
    pointerMove(domElement, 200, 100);

    const posAfterDrag = camera.position.clone();

    pointerUp(domElement, 2);
    pointerMove(domElement, 400, 100);

    expect(camera.position.distanceTo(posAfterDrag)).toBeLessThan(1e-6);
  });

  // ── Scroll dolly ──────────────────────────────────────────────────────────

  it('scroll forward (negative deltaY) moves camera in its forward direction', () => {
    // Default camera looks toward -Z; forward = (0, 0, -1)
    const posBefore = camera.position.clone();

    wheel(domElement, -100); // scroll up / forward

    const displacement = new Vector3().subVectors(camera.position, posBefore);
    // Should have moved in -Z direction
    expect(displacement.z).toBeLessThan(0);
  });

  it('scroll backward (positive deltaY) moves camera in its backward direction', () => {
    const posBefore = camera.position.clone();

    wheel(domElement, 100); // scroll down / backward

    const displacement = new Vector3().subVectors(camera.position, posBefore);
    expect(displacement.z).toBeGreaterThan(0);
  });

  // ── Dispose ────────────────────────────────────────────────────────────────

  it('after dispose, pointer events no longer affect the camera', () => {
    controls.dispose();

    const quatBefore = camera.quaternion.clone();
    const posBefore = camera.position.clone();

    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 300, 300);
    wheel(domElement, 100);

    expect(camera.quaternion.x).toBeCloseTo(quatBefore.x, 10);
    expect(camera.position.distanceTo(posBefore)).toBeLessThan(1e-6);
  });

  it('after dispose, cleanup of domElement from document does not throw', () => {
    expect(() => {
      controls.dispose();
      document.body.removeChild(domElement);
    }).not.toThrow();
  });

  // ── onNavigate callback ────────────────────────────────────────────────────

  it('onNavigate is called when the user drag-rotates', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;

    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 150, 100);

    expect(onNavigate).toHaveBeenCalled();
  });

  it('onNavigate is called when the user drag-pans', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;

    pointerDown(domElement, 2, 100, 100);
    pointerMove(domElement, 150, 100);

    expect(onNavigate).toHaveBeenCalled();
  });

  it('onNavigate is called on scroll wheel', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;

    wheel(domElement, -100);

    expect(onNavigate).toHaveBeenCalled();
  });

  it('onNavigate is NOT called on pointerdown without drag', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;

    pointerDown(domElement, 0, 100, 100);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('onNavigate is not called after dispose', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;

    controls.dispose();

    pointerDown(domElement, 0, 100, 100);
    pointerMove(domElement, 200, 200);
    wheel(domElement, -100);

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
