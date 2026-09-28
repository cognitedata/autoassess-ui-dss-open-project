import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { CameraHelper } from 'three';
import type { IViewerLayer } from './IViewerLayer';
import type { LayerType } from './LayerType';
import type { DroneImage } from './DroneImageService';

// OpenCV camera convention (+Z forward) → Three.js convention (-Z forward).
// 180° rotation around the camera-local X axis.
const OPENCV_TO_THREEJS = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);

// Fixed near/far for the frustum wireframe — chosen for visual clarity, not sensor range.
const FRUSTUM_DISPLAY_NEAR = 0.05; // metres
const FRUSTUM_DISPLAY_FAR  = 0.35; // metres (near + 30 cm)

const SPHERE_RADIUS           = 0.12;
const SPHERE_OPACITY_DEFAULT  = 0.7;
const SPHERE_OPACITY_SELECTED = 1.0;

const COLOR_DEFAULT  = new Color(0x88ccff); // light blue
const COLOR_SELECTED = new Color(0x00aaff); // cyan
const COLOR_ACTIVE   = new Color(0xff9000); // amber — Stage 2 frustum highlight

interface ImageObjects {
  sphere:  Mesh;
  hitMesh: Mesh;
  camera:  PerspectiveCamera;
  helper:  CameraHelper;
}

export class ImageLayer implements IViewerLayer {
  readonly group    = new Group();
  readonly layerType: LayerType = 'IMAGES';

  private _objects: Map<string, ImageObjects> = new Map();
  private _selectedId: string | null = null;
  private _activeId:   string | null = null;

  update(images: DroneImage[]): void {
    this._disposeAll();

    for (const img of images) {
      const pos  = new Vector3(img.position[0], img.position[1], img.position[2]);
      const quat = new Quaternion(
        img.orientationQuat[0],
        img.orientationQuat[1],
        img.orientationQuat[2],
        img.orientationQuat[3],
      );
      // T_BS is applied at upload time; pose is already in camera frame.
      // OpenCV (+Z forward) → Three.js (-Z forward)
      quat.multiply(OPENCV_TO_THREEJS);

      // Visible sphere at camera position
      const sphereGeo = new SphereGeometry(SPHERE_RADIUS, 16, 12);
      const sphereMat = new MeshBasicMaterial({
        color: COLOR_DEFAULT.clone(),
        transparent: true,
        opacity: SPHERE_OPACITY_DEFAULT,
        depthWrite: false,
      });
      const sphere = new Mesh(sphereGeo, sphereMat);
      sphere.position.copy(pos);
      sphere.userData = { externalId: img.externalId };
      this.group.add(sphere);

      // Invisible low-poly sphere for raycasting
      const hitGeo = new SphereGeometry(SPHERE_RADIUS, 8, 6);
      const hitMat = new MeshBasicMaterial({ visible: false });
      const hitMesh = new Mesh(hitGeo, hitMat);
      hitMesh.position.copy(pos);
      hitMesh.userData = { externalId: img.externalId };
      this.group.add(hitMesh);

      // Dummy PerspectiveCamera at the drone pose — used only for the frustum helper
      const vfovDeg = (2 * Math.atan(img.imageHeight / 2 / img.focalLengthY) * 180) / Math.PI;
      const aspect  = img.imageWidth / img.imageHeight;
      const dummyCam = new PerspectiveCamera(vfovDeg, aspect, FRUSTUM_DISPLAY_NEAR, FRUSTUM_DISPLAY_FAR);
      dummyCam.position.copy(pos);
      dummyCam.quaternion.copy(quat);
      dummyCam.updateMatrixWorld();
      this.group.add(dummyCam);

      // CameraHelper renders the frustum wireframe
      const helper = new CameraHelper(dummyCam);
      const c = COLOR_DEFAULT.clone();
      helper.setColors(c, c, c, c, c);
      this.group.add(helper);

      this._objects.set(img.externalId, { sphere, hitMesh, camera: dummyCam, helper });
    }

    // Restore highlight state
    this.setSelectedImageId(this._selectedId);
    this.setActiveFrustumId(this._activeId);
  }

  /** Number of drone images currently in the layer — useful for tests. */
  get count(): number {
    return this._objects.size;
  }

  getHitMeshes(): Mesh[] {
    return [...this._objects.values()].map((o) => o.hitMesh);
  }

  /**
   * Highlights the selected image sphere + frustum (cyan, full opacity).
   * All others revert to default style.
   * Pass `null` to clear.
   */
  setSelectedImageId(externalId: string | null): void {
    this._selectedId = externalId;
    for (const [id, obj] of this._objects) {
      const isSelected = id === externalId;
      const mat = obj.sphere.material as MeshBasicMaterial;
      mat.opacity = isSelected ? SPHERE_OPACITY_SELECTED : SPHERE_OPACITY_DEFAULT;
      const c = isSelected ? COLOR_SELECTED.clone() : COLOR_DEFAULT.clone();
      mat.color.copy(c);
      obj.helper.setColors(c, c, c, c, c);
    }
  }

  /**
   * Highlights a frustum in amber to indicate it is the active image suggestion
   * from a surface selection (Stage 2). Does not change sphere highlight.
   * Pass `null` to clear.
   */
  setActiveFrustumId(externalId: string | null): void {
    this._activeId = externalId;
    for (const [id, obj] of this._objects) {
      // Skip if this image is the directly selected one — selection takes priority
      if (id === this._selectedId) continue;
      const isActive = id === externalId;
      const c = isActive ? COLOR_ACTIVE.clone() : COLOR_DEFAULT.clone();
      const mat = obj.sphere.material as MeshBasicMaterial;
      mat.color.copy(c);
      obj.helper.setColors(c, c, c, c, c);
    }
  }

  /** Clears all selection and active-frustum state. */
  clearHighlights(): void {
    this._selectedId = null;
    this._activeId   = null;
    for (const [, obj] of this._objects) {
      const mat = obj.sphere.material as MeshBasicMaterial;
      mat.opacity = SPHERE_OPACITY_DEFAULT;
      const c = COLOR_DEFAULT.clone();
      mat.color.copy(c);
      obj.helper.setColors(c, c, c, c, c);
    }
  }

  private _disposeAll(): void {
    this._objects.clear();
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
