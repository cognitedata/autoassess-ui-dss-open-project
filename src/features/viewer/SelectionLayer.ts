import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import type { StructuralElement } from './StructuralElementService';

export const REGION_CIRCLE_RADIUS_M = 0.3;
/** Lift the circle this far above the surface to prevent z-fighting with the mesh. */
const SURFACE_LIFT_M = 0.008;

export class SelectionLayer {
  readonly group = new Group();

  setRegionHit(position: Vector3, normal: Vector3, radiusM = REGION_CIRCLE_RADIUS_M): void {
    this.clearGroup();
    const inner = radiusM * 0.85;
    const n = normal.clone().normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
    // Lift slightly above the surface so the circle never z-fights with the mesh
    const liftedPos = position.clone().addScaledVector(n, SURFACE_LIFT_M);

    const ring = new Mesh(
      new RingGeometry(inner, radiusM, 64),
      new MeshBasicMaterial({ color: 0x00aaff, side: DoubleSide, depthTest: false }),
    );
    ring.renderOrder = 1;
    ring.position.copy(liftedPos);
    ring.quaternion.copy(q);
    this.group.add(ring);

    const disc = new Mesh(
      new CircleGeometry(inner, 64),
      new MeshBasicMaterial({ color: 0x0066cc, transparent: true, opacity: 0.25, side: DoubleSide, depthTest: false }),
    );
    disc.renderOrder = 1;
    disc.position.copy(liftedPos);
    disc.quaternion.copy(q);
    this.group.add(disc);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setElementHit(_element: StructuralElement): void {
    // The element is already represented by a semi-transparent sphere in SemanticLayer;
    // no additional selection overlay is needed.
    this.clearGroup();
  }

  clear(): void {
    this.clearGroup();
  }

  private clearGroup(): void {
    for (const child of [...this.group.children]) {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
    this.group.clear();
  }
}
