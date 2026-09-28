import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { IViewerLayer } from './IViewerLayer';
import type { LayerType } from './LayerType';
import type { ElementType, StructuralElement } from './StructuralElementService';

export const ELEMENT_COLORS: Record<ElementType, Color> = {
  manhole:      new Color(0xff6b35),  // orange
  longitudinal: new Color(0x4ecdc4),  // teal
  wall:         new Color(0xffe66d),  // yellow
  compartment:  new Color(0xa8e6cf),  // green
};

/** Highlight colour for elements that are part of the active inspection plan draft. */
const PLAN_TASK_HIGHLIGHT_COLOR = new Color(0xff9000); // amber
/** Colour for the single selected plan task element (overrides amber). */
const PLAN_TASK_SELECTED_COLOR = new Color(0x00aaff); // cyan

const SPHERE_RADIUS = 0.1; // metres — 10 cm
const SPHERE_OPACITY = 0.5;
const SPHERE_SELECTED_OPACITY = 1.0;

export class SemanticLayer implements IViewerLayer {
  readonly group = new Group();
  readonly layerType: LayerType = 'SEMANTIC_SEG';
  private _hitMeshes: Mesh[] = [];
  private _sphereMeshes: Mesh[] = [];
  private _selectedExternalId: string | null = null;
  private _activePlanIds: ReadonlySet<string> = new Set();
  private _selectedPlanTaskElementId: string | null = null;

  update(elements: StructuralElement[]): void {
    this.dispose();

    for (const el of elements) {
      const color = ELEMENT_COLORS[el.elementType] ?? new Color(0xffffff);
      const pos = new Vector3(...el.center);

      // Visible semi-transparent sphere
      const sphereGeo = new SphereGeometry(SPHERE_RADIUS, 16, 12);
      const sphereMat = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: SPHERE_OPACITY,
        depthWrite: false,
      });
      const sphere = new Mesh(sphereGeo, sphereMat);
      sphere.position.copy(pos);
      sphere.userData = { externalId: el.externalId, elementType: el.elementType };
      this.group.add(sphere);
      this._sphereMeshes.push(sphere);

      // Invisible low-poly sphere for raycasting (hit detection)
      const hitGeo = new SphereGeometry(SPHERE_RADIUS, 8, 6);
      const hitMat = new MeshBasicMaterial({ visible: false });
      const hitMesh = new Mesh(hitGeo, hitMat);
      hitMesh.position.copy(pos);
      hitMesh.userData = { externalId: el.externalId, elementType: el.elementType };
      this.group.add(hitMesh);
      this._hitMeshes.push(hitMesh);
    }

    // Restore selection highlight if the previously selected element is still present.
    this.setSelectedElementId(this._selectedExternalId);
  }

  /** Number of visible sphere objects currently in the layer — useful for tests. */
  get count(): number {
    return this._sphereMeshes.length;
  }

  getHitMeshes(): Mesh[] {
    return this._hitMeshes;
  }

  /**
   * Updates sphere colours to highlight elements whose externalIds are in `ids`.
   * Elements not in the set revert to their default class colour.
   * The selected plan task element (if any) keeps its cyan colour regardless.
   * Called by PlyViewer whenever the activePlanStore task list changes.
   */
  setActivePlanElementIds(ids: ReadonlySet<string>): void {
    this._activePlanIds = ids;
    this._applyColors();
  }

  /**
   * Highlights one element sphere with the selected-task colour (cyan).
   * All other plan-task spheres remain amber. Pass `null` to clear.
   */
  setSelectedPlanTaskElementId(id: string | null): void {
    this._selectedPlanTaskElementId = id;
    this._applyColors();
  }

  private _applyColors(): void {
    for (const sphere of this._sphereMeshes) {
      const { externalId, elementType } = sphere.userData as {
        externalId: string;
        elementType: ElementType;
      };
      const mat = sphere.material as MeshBasicMaterial;
      if (externalId === this._selectedPlanTaskElementId) {
        mat.color.copy(PLAN_TASK_SELECTED_COLOR);
      } else if (this._activePlanIds.has(externalId)) {
        mat.color.copy(PLAN_TASK_HIGHLIGHT_COLOR);
      } else {
        mat.color.copy(ELEMENT_COLORS[elementType] ?? new Color(0xffffff));
      }
    }
  }

  /**
   * Highlights the selected element by making its sphere fully opaque.
   * All other spheres revert to the default translucent opacity.
   * Pass `null` to clear the selection.
   */
  setSelectedElementId(externalId: string | null): void {
    this._selectedExternalId = externalId;
    for (const sphere of this._sphereMeshes) {
      const mat = sphere.material as MeshBasicMaterial;
      mat.opacity =
        externalId !== null && sphere.userData['externalId'] === externalId
          ? SPHERE_SELECTED_OPACITY
          : SPHERE_OPACITY;
    }
  }

  private dispose(): void {
    this._hitMeshes = [];
    this._sphereMeshes = [];
    for (const child of [...this.group.children]) {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      this.group.remove(child);
    }
  }
}
