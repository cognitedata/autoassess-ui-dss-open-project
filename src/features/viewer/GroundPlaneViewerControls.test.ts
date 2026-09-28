import { PerspectiveCamera, Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroundPlaneViewerControls } from './GroundPlaneViewerControls';

// Simulate pointer/wheel events on a target element
function pointerDown(el: HTMLElement, button: number, x: number, y: number) {
  el.dispatchEvent(new PointerEvent('pointerdown', { button, clientX: x, clientY: y, bubbles: true }));
}
function pointerMove(dx: number, dy: number, startX = 100, startY = 100) {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: startX + dx, clientY: startY + dy }));
}
function pointerUp(button: number) {
  window.dispatchEvent(new PointerEvent('pointerup', { button }));
}
function wheel(el: HTMLElement, deltaY: number) {
  el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }));
}

describe(GroundPlaneViewerControls.name, () => {
  let camera: PerspectiveCamera;
  let domElement: HTMLElement;
  let groundNormal: Vector3;
  let controls: GroundPlaneViewerControls;

  beforeEach(() => {
    camera = new PerspectiveCamera(60, 1, 0.01, 1000);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);
    domElement = document.createElement('div');
    groundNormal = new Vector3(0, 1, 0);
    controls = new GroundPlaneViewerControls(camera, domElement, groundNormal);
  });

  afterEach(() => {
    controls.dispose();
  });

  // ── Yaw (left-drag horizontal) ────────────────────────────────────────────

  it('left-drag horizontal rotates camera around the ground normal (world-space yaw)', () => {
    const beforeQ = camera.quaternion.clone();
    pointerDown(domElement, 0, 100, 100);
    pointerMove(50, 0); // pure horizontal drag

    // After horizontal drag, camera should have rotated around world Y
    // The quaternion should differ from its initial value
    expect(camera.quaternion.equals(beforeQ)).toBe(false);
  });

  it('horizontal drag does not change camera position', () => {
    const beforePos = camera.position.clone();
    pointerDown(domElement, 0, 100, 100);
    pointerMove(50, 0);
    expect(camera.position.distanceTo(beforePos)).toBeLessThan(1e-6);
  });

  // ── Pitch (left-drag vertical) ────────────────────────────────────────────

  it('left-drag vertical tilts camera up/down (pitch)', () => {
    const beforeQ = camera.quaternion.clone();
    pointerDown(domElement, 0, 100, 100);
    pointerMove(0, 50); // pure vertical drag
    expect(camera.quaternion.equals(beforeQ)).toBe(false);
  });

  it('pitch is clamped so camera cannot look more than 85° from horizontal', () => {
    controls.rotateSpeed = 0.1; // large speed to hit the clamp quickly
    pointerDown(domElement, 0, 100, 100);
    // Very large downward drag — should be clamped
    pointerMove(0, 10000);
    pointerUp(0);

    // The camera's forward vector projected onto ground plane should have non-negligible length
    // (i.e., camera is not pointing straight up/down)
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const verticalComponent = Math.abs(forward.dot(groundNormal));
    // sin(85°) ≈ 0.9962; the clamped result should sit at or below that value, not at 1.0
    expect(verticalComponent).toBeLessThanOrEqual(0.997);
    expect(verticalComponent).toBeGreaterThan(0.99); // confirms the clamp engaged (not just horizontal)
  });

  // ── Pan (right-drag) ──────────────────────────────────────────────────────

  it('right-drag translates camera position', () => {
    const beforePos = camera.position.clone();
    pointerDown(domElement, 2, 100, 100);
    pointerMove(50, 0);
    expect(camera.position.distanceTo(beforePos)).toBeGreaterThan(0);
  });

  it('right-drag pan stays on the ground plane (no movement along normal)', () => {
    const normalComponent = (pos: Vector3) => pos.dot(groundNormal);
    const before = normalComponent(camera.position.clone());
    pointerDown(domElement, 2, 100, 100);
    pointerMove(50, 50);
    const after = normalComponent(camera.position);
    expect(Math.abs(after - before)).toBeLessThan(1e-5);
  });

  it('middle-drag also pans', () => {
    const beforePos = camera.position.clone();
    pointerDown(domElement, 1, 100, 100);
    pointerMove(50, 0);
    expect(camera.position.distanceTo(beforePos)).toBeGreaterThan(0);
  });

  // ── Dolly (scroll) ────────────────────────────────────────────────────────

  it('scroll wheel moves camera along view direction', () => {
    const beforePos = camera.position.clone();
    wheel(domElement, 100);
    expect(camera.position.distanceTo(beforePos)).toBeGreaterThan(0);
  });

  // ── onNavigate callback ───────────────────────────────────────────────────

  it('fires onNavigate on left-drag', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;
    pointerDown(domElement, 0, 100, 100);
    pointerMove(10, 0);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('fires onNavigate on right-drag', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;
    pointerDown(domElement, 2, 100, 100);
    pointerMove(10, 0);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('fires onNavigate on scroll', () => {
    const onNavigate = vi.fn();
    controls.onNavigate = onNavigate;
    wheel(domElement, 100);
    expect(onNavigate).toHaveBeenCalled();
  });

  // ── dispose ───────────────────────────────────────────────────────────────

  it('dispose stops responding to events', () => {
    controls.dispose();
    const beforeQ = camera.quaternion.clone();
    pointerDown(domElement, 0, 100, 100);
    pointerMove(50, 0);
    expect(camera.quaternion.equals(beforeQ)).toBe(true);
  });

  // ── Non-Y-up ground normal ────────────────────────────────────────────────

  it('works with a non-standard ground normal (Z-up)', () => {
    controls.dispose();
    const zUpNormal = new Vector3(0, 0, 1);
    const zUpControls = new GroundPlaneViewerControls(camera, domElement, zUpNormal);
    const beforeQ = camera.quaternion.clone();
    pointerDown(domElement, 0, 100, 100);
    pointerMove(50, 0);
    expect(camera.quaternion.equals(beforeQ)).toBe(false);
    zUpControls.dispose();
  });
});
