import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { DefectDetection } from './DefectDetectionService';

const SURFACE_LIFT_M = 0.008;
const RING_RADIUS = 0.08; // metres
const RING_INNER_RATIO = 0.75;
const HIT_RADIUS = 0.12; // slightly larger than ring for easy clicking
const DISC_OPACITY = 0.2;

const DEFECT_COLOR = new Color(0xe03030); // red
const DEFECT_HOVER_COLOR = new Color(0xff6060); // light red
const DEFECT_SELECTED_COLOR = new Color(0x00aaff); // cyan — matches task selection

const UP = new Vector3(0, 1, 0);

interface DefectMeshEntry {
  hitMesh: Mesh;
  ringMeshes: Mesh[];
}

/**
 * Renders persistent 3D ring+disc markers for all detected defects in the viewer.
 * Mirrors the PlanTasksLayer pattern — managed directly by PlyViewer.
 */
export class DefectDetectionLayer {
  readonly group = new Group();
  private _entries: Map<string, DefectMeshEntry> = new Map();
  private _selectedId: string | null = null;
  private _hoveredId: string | null = null;

  update(defects: DefectDetection[]): void {
    this._dispose();

    for (const defect of defects) {
      this._addDefect(defect);
    }

    this._applyColors();
  }

  setSelectedId(id: string | null): void {
    this._selectedId = id;
    this._applyColors();
  }

  setHoveredId(id: string | null): void {
    this._hoveredId = id;
    this._applyColors();
  }

  getHitMeshes(): Mesh[] {
    return [...this._entries.values()].map((e) => e.hitMesh);
  }

  externalIdForMesh(mesh: Mesh): string | undefined {
    return mesh.userData['defectExternalId'] as string | undefined;
  }

  private _applyColors(): void {
    for (const [id, { ringMeshes }] of this._entries) {
      const isSelected = id === this._selectedId;
      const isHovered = id === this._hoveredId;
      const visible = isSelected || isHovered;
      const color = isSelected ? DEFECT_SELECTED_COLOR : isHovered ? DEFECT_HOVER_COLOR : DEFECT_COLOR;
      for (const mesh of ringMeshes) {
        mesh.visible = visible;
        (mesh.material as MeshBasicMaterial).color.copy(color);
      }
    }
  }

  private _addDefect(defect: DefectDetection): void {
    const [cx = 0, cy = 0, cz = 0] = defect.boundingBox3d;
    const pos = new Vector3(cx, cy, cz);

    const n = defect.normal3d
      ? new Vector3(...defect.normal3d).normalize()
      : UP.clone();

    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
    const liftedPos = pos.clone().addScaledVector(n, SURFACE_LIFT_M);
    const inner = RING_RADIUS * RING_INNER_RATIO;

    const ring = new Mesh(
      new RingGeometry(inner, RING_RADIUS, 64),
      new MeshBasicMaterial({ color: DEFECT_COLOR.clone(), side: DoubleSide, depthTest: false }),
    );
    ring.renderOrder = 1;
    ring.position.copy(liftedPos);
    ring.quaternion.copy(q);
    this.group.add(ring);

    const disc = new Mesh(
      new CircleGeometry(inner, 64),
      new MeshBasicMaterial({
        color: DEFECT_COLOR.clone(),
        transparent: true,
        opacity: DISC_OPACITY,
        side: DoubleSide,
        depthTest: false,
      }),
    );
    disc.renderOrder = 1;
    disc.position.copy(liftedPos);
    disc.quaternion.copy(q);
    this.group.add(disc);

    const hitMesh = new Mesh(
      new SphereGeometry(HIT_RADIUS, 8, 6),
      new MeshBasicMaterial({ visible: false }),
    );
    hitMesh.position.copy(pos);
    hitMesh.userData = { defectExternalId: defect.externalId };
    this.group.add(hitMesh);

    this._entries.set(defect.externalId, { hitMesh, ringMeshes: [ring, disc] });
  }

  private _dispose(): void {
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
    this._entries.clear();
  }
}
