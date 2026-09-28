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
import type { NdtMeasurement } from './NdtMeasurementService';

const NDT_COLOR = new Color(0xff4081); // rose/magenta
const SPHERE_RADIUS = 0.1; // metres — 10 cm
const SPHERE_OPACITY = 0.5;
const SPHERE_SELECTED_OPACITY = 1.0;

export class NdtMeasurementLayer implements IViewerLayer {
  readonly group = new Group();
  readonly layerType: LayerType = 'NDT_MEASUREMENTS';
  private _hitMeshes: Mesh[] = [];
  private _sphereMeshes: Mesh[] = [];
  private _selectedExternalId: string | null = null;

  update(measurements: NdtMeasurement[]): void {
    this.dispose();

    for (const m of measurements) {
      const pos = new Vector3(...m.position3d);

      // Visible semi-transparent sphere
      const sphereGeo = new SphereGeometry(SPHERE_RADIUS, 16, 12);
      const sphereMat = new MeshBasicMaterial({
        color: NDT_COLOR,
        transparent: true,
        opacity: SPHERE_OPACITY,
        depthWrite: false,
      });
      const sphere = new Mesh(sphereGeo, sphereMat);
      sphere.position.copy(pos);
      sphere.userData = { externalId: m.externalId, campaignExternalId: m.campaignExternalId };
      this.group.add(sphere);
      this._sphereMeshes.push(sphere);

      // Invisible low-poly sphere for raycasting (hit detection)
      const hitGeo = new SphereGeometry(SPHERE_RADIUS, 8, 6);
      const hitMat = new MeshBasicMaterial({ visible: false });
      const hitMesh = new Mesh(hitGeo, hitMat);
      hitMesh.position.copy(pos);
      hitMesh.userData = { externalId: m.externalId, campaignExternalId: m.campaignExternalId };
      this.group.add(hitMesh);
      this._hitMeshes.push(hitMesh);
    }

    // Restore selection highlight if the previously selected measurement is still present.
    this.setSelectedMeasurementId(this._selectedExternalId);
  }

  /** Number of visible sphere objects currently in the layer — useful for tests. */
  get count(): number {
    return this._sphereMeshes.length;
  }

  getHitMeshes(): Mesh[] {
    return this._hitMeshes;
  }

  /**
   * Highlights the selected measurement sphere by making it fully opaque.
   * All other spheres revert to the default translucent opacity.
   * Pass `null` to clear the selection.
   */
  setSelectedMeasurementId(externalId: string | null): void {
    this._selectedExternalId = externalId;
    for (const sphere of this._sphereMeshes) {
      const mat = sphere.material as MeshBasicMaterial;
      mat.opacity =
        externalId !== null && sphere.userData['externalId'] === externalId
          ? SPHERE_SELECTED_OPACITY
          : SPHERE_OPACITY;
    }
  }

  /**
   * Shows or hides individual spheres based on their campaign's NDT layer visibility.
   * Also updates hit mesh visibility so hidden spheres cannot be raycast.
   * Called whenever the layer visibility store changes.
   */
  syncCampaignVisibility(isVisible: (campaignId: string) => boolean): void {
    for (const sphere of this._sphereMeshes) {
      const { campaignExternalId } = sphere.userData as { campaignExternalId: string };
      sphere.visible = isVisible(campaignExternalId);
    }
    for (const hitMesh of this._hitMeshes) {
      const { campaignExternalId } = hitMesh.userData as { campaignExternalId: string };
      hitMesh.visible = isVisible(campaignExternalId);
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
