import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { InspectionTask } from './InspectionTaskService';
import type { StructuralElement } from './StructuralElementService';

/** Same as SelectionLayer.SURFACE_LIFT_M — lifts rings above the mesh to avoid z-fighting. */
const SURFACE_LIFT_M = 0.008;

const TASK_COLOR = new Color(0xff9000); // amber — matches PLAN_TASK_HIGHLIGHT_COLOR
const TASK_SELECTED_COLOR = new Color(0x00aaff); // cyan
const TASK_HOVER_COLOR = new Color(0xffd700); // gold — hover without selection
const DISC_OPACITY = 0.2;
const ELEMENT_HIT_RADIUS = 0.1; // metres

// Normal arrow on NDT regions, all relative to the region radius.
const ARROW_SHAFT_LENGTH_FACTOR = 1.2;
const ARROW_HEAD_LENGTH_FACTOR = 0.5;
const ARROW_SHAFT_RADIUS_FACTOR = 0.05;

interface TaskMeshEntry {
  hitMesh: Mesh;
  /** Visible ring and disc meshes (only for region tasks). */
  ringMeshes: Mesh[];
}

// InspectionTask uses optional fields rather than a discriminated union, so Extract<...,'region'>
// returns never. These local aliases cast the required fields to non-optional.
type RegionTask = InspectionTask & { position3d: [number, number, number]; normalVector: [number, number, number]; radiusM: number };
type ElementTask = InspectionTask & { targetElementExternalId: string };

/**
 * Renders persistent 3D markers for all tasks in the active inspection plan.
 * Region tasks appear as ring+disc overlays (mirroring SelectionLayer geometry).
 * Element tasks provide only an invisible hit mesh for raycasting (SemanticLayer
 * handles their visible representation via amber spheres).
 *
 * Managed directly by PlyViewer — not registered with LayerPanel or LayerType.
 */
export class PlanTasksLayer {
  readonly group = new Group();
  private _taskMeshes: Map<string, TaskMeshEntry> = new Map();
  private _selectedTaskId: string | null = null;
  private _hoveredTaskId: string | null = null;

  update(tasks: InspectionTask[], elements: StructuralElement[]): void {
    this._dispose();

    for (const task of tasks) {
      if (task.taskKind === 'region') {
        this._addRegionTask(task as RegionTask);
      } else {
        this._addElementTask(task as ElementTask, elements);
      }
    }

    this._applyRingColors();
  }

  setSelectedTaskId(id: string | null): void {
    this._selectedTaskId = id;
    this._applyRingColors();
  }

  setHoveredTaskId(id: string | null): void {
    this._hoveredTaskId = id;
    this._applyRingColors();
  }

  private _applyRingColors(): void {
    for (const [taskId, { ringMeshes }] of this._taskMeshes) {
      const color =
        taskId === this._selectedTaskId ? TASK_SELECTED_COLOR :
        taskId === this._hoveredTaskId ? TASK_HOVER_COLOR :
        TASK_COLOR;
      for (const mesh of ringMeshes) {
        (mesh.material as MeshBasicMaterial).color.copy(color);
      }
    }
  }

  getHitMeshes(): Mesh[] {
    return [...this._taskMeshes.values()].map((e) => e.hitMesh);
  }

  private _addRegionTask(task: RegionTask): void {
    const { position3d, normalVector, radiusM } = task;
    const pos = new Vector3(...position3d);
    const n = new Vector3(...normalVector).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
    const liftedPos = pos.clone().addScaledVector(n, SURFACE_LIFT_M);
    const inner = radiusM * 0.85;

    const ring = new Mesh(
      new RingGeometry(inner, radiusM, 64),
      new MeshBasicMaterial({ color: TASK_COLOR.clone(), side: DoubleSide, depthTest: false }),
    );
    ring.renderOrder = 1;
    ring.position.copy(liftedPos);
    ring.quaternion.copy(q);
    this.group.add(ring);

    const disc = new Mesh(
      new CircleGeometry(inner, 64),
      new MeshBasicMaterial({
        color: TASK_COLOR.clone(),
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

    const ringMeshes: Mesh[] = [ring, disc];

    // NDT thickness is measured along the surface normal, so show the probe
    // direction as an arrow (shaft + head) out of the region centre.
    if (task.inspectionType === 'ndt_thickness') {
      const shaftLength = radiusM * ARROW_SHAFT_LENGTH_FACTOR;
      const headLength = radiusM * ARROW_HEAD_LENGTH_FACTOR;
      const shaftRadius = Math.max(radiusM * ARROW_SHAFT_RADIUS_FACTOR, 0.004);
      // Cylinder and cone geometries extend along +Y; rotate +Y onto the normal.
      const qArrow = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), n);

      const shaft = new Mesh(
        new CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12),
        new MeshBasicMaterial({ color: TASK_COLOR.clone(), depthTest: false }),
      );
      shaft.renderOrder = 1;
      shaft.position.copy(pos).addScaledVector(n, SURFACE_LIFT_M + shaftLength / 2);
      shaft.quaternion.copy(qArrow);
      this.group.add(shaft);

      const head = new Mesh(
        new ConeGeometry(shaftRadius * 3, headLength, 16),
        new MeshBasicMaterial({ color: TASK_COLOR.clone(), depthTest: false }),
      );
      head.renderOrder = 1;
      head.position.copy(pos).addScaledVector(n, SURFACE_LIFT_M + shaftLength + headLength / 2);
      head.quaternion.copy(qArrow);
      this.group.add(head);

      ringMeshes.push(shaft, head);
    }

    const hitMesh = new Mesh(
      new SphereGeometry(radiusM, 8, 6),
      new MeshBasicMaterial({ visible: false }),
    );
    hitMesh.position.copy(pos);
    hitMesh.userData = { taskExternalId: task.externalId };
    this.group.add(hitMesh);

    this._taskMeshes.set(task.externalId, { hitMesh, ringMeshes });
  }

  private _addElementTask(
    task: ElementTask,
    elements: StructuralElement[],
  ): void {
    const el = elements.find((e) => e.externalId === task.targetElementExternalId);
    if (!el) return;

    const hitMesh = new Mesh(
      new SphereGeometry(ELEMENT_HIT_RADIUS, 8, 6),
      new MeshBasicMaterial({ visible: false }),
    );
    hitMesh.position.set(...el.center);
    hitMesh.userData = { taskExternalId: task.externalId };
    this.group.add(hitMesh);

    this._taskMeshes.set(task.externalId, { hitMesh, ringMeshes: [] });
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
    this._taskMeshes.clear();
  }
}
