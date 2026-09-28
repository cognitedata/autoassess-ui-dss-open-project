import { useCogniteSdk } from '@cognite/app-sdk/react';
import { Loader } from '@cognite/aura/components';
import type { CogniteClient } from '@cognite/sdk';
import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Clock,
  DoubleSide,
  Frustum,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointsMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Intersection, Object3D ,
  Points} from 'three';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';

import { useActivePlanStore } from './activePlanStore';
import { useColorModeStore } from './colorModeStore';
import type { ColorMode } from './colorModeStore';
import { DefectDetectionLayer } from './DefectDetectionLayer';
import type { DefectDetection } from './DefectDetectionService';
import type { DroneImage } from './DroneImageService';
import { FirstPersonViewerControls } from './FirstPersonViewerControls';
import { GroundPlaneViewerControls } from './GroundPlaneViewerControls';
import { ImageLayer } from './ImageLayer';
import type { InspectionTask } from './InspectionTaskService';
import type { LayerType } from './LayerType';
import { useLayerVisibilityStore } from './layerVisibilityStore';
import { MeshLayer } from './MeshLayer';
import { NdtMeasurementLayer } from './NdtMeasurementLayer';
import type { NdtMeasurement } from './NdtMeasurementService';
import type { CachedParsedPly } from './parsedGeometryCache';
import { getCachedParsedPly, putCachedParsedPly } from './parsedGeometryCache';
import { applyLabelColors } from './pcdLabelColorizer';
import { usePcdVisibilityStore } from './pcdVisibilityStore';
import { PlanTasksLayer } from './PlanTasksLayer';
import { fetchPlyWithCache, derivePlyKey } from './plyCache';
import type { PlyWorkerResponse } from './plyWorker';
import type { CameraPose } from './cameraParam';
import { CameraSettleDetector, poseFromCamera } from './CameraSettleDetector';
import type { CampaignCadModel } from './reveal/CampaignCadModelService';
import { createRevealEngine } from './reveal/revealEngine';
import type { CadModelHandle, ViewerEngine, ViewerEngineOptions } from './reveal/revealEngine';
import type { SelectionHit } from './selection';
import { SelectionLayer, REGION_CIRCLE_RADIUS_M } from './SelectionLayer';
import { SemanticLayer } from './SemanticLayer';
import type { StructuralElement } from './StructuralElementService';
import { useViewerControlsModeStore } from './viewerControlsModeStore';
import type { ControlsMode } from './viewerControlsModeStore';
import { ViewerLayerManager } from './ViewerLayerManager';
import { useViewerSettingsStore } from './viewerSettingsStore';

interface RaycasterLike {
  setFromCamera(coords: Vector2, camera: PerspectiveCamera): void;
  intersectObjects(objects: Object3D[], recursive?: boolean): Intersection[];
}

export type PlyViewerContextType = {
  createEngine: (options: ViewerEngineOptions) => ViewerEngine;
  createRaycaster: () => RaycasterLike;
  useSdk: () => CogniteClient;
  /** Fresh signed download URL for a file (CDF's signed URLs expire after ~30 s). */
  getDownloadUrl: (sdk: CogniteClient, fileId: number) => Promise<string>;
};

const defaultPlyViewerDeps: PlyViewerContextType = {
  createEngine: (options) => createRevealEngine(options),
  createRaycaster: () => new Raycaster(),
  useSdk: useCogniteSdk,
  getDownloadUrl: async (sdk, fileId) => {
    const [link] = await sdk.files.getDownloadUrls([{ id: fileId }]);
    if (!link?.downloadUrl) throw new Error(`No download URL for file ${fileId}`);
    return link.downloadUrl;
  },
};

export const PlyViewerContext = createContext<PlyViewerContextType>(defaultPlyViewerDeps);

interface ParsedPly {
  geometry: BufferGeometry;
  isMesh: boolean;
  hasFaceColors: boolean;
}

function reconstructGeometry(cached: CachedParsedPly): ParsedPly {
  const geometry = new BufferGeometry();
  for (const [name, { buffer: buf, itemSize, normalized }] of Object.entries(cached.attrs)) {
    geometry.setAttribute(name, new BufferAttribute(new Float32Array(buf), itemSize, normalized));
  }
  if (cached.index) {
    const IndexArray = cached.indexIsUint32 ? Uint32Array : Uint16Array;
    geometry.setIndex(new BufferAttribute(new IndexArray(cached.index), 1));
  }
  return { geometry, isMesh: cached.isMesh, hasFaceColors: cached.hasFaceColors };
}

function parsePlyInWorker(buffer: ArrayBuffer, signal: AbortSignal): Promise<ParsedPly> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }

    const worker = new Worker(new URL('./plyWorker.ts', import.meta.url), { type: 'module' });

    // Terminate worker if the effect is cleaned up before parsing finishes
    const onAbort = () => worker.terminate();
    signal.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (e: MessageEvent<PlyWorkerResponse>) => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }

      const msg = e.data;
      if (!msg.ok) { reject(new Error(msg.error)); return; }
      resolve(reconstructGeometry(msg));
    };

    worker.onerror = (e) => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      reject(new Error(e.message));
    };

    // Transfer ownership of the buffer to the worker (zero-copy)
    worker.postMessage({ buffer }, [buffer]);
  });
}

/**
 * Average the normals of nearby vertices, restricting to those that face the same
 * general direction as the hit face.
 *
 * For unindexed scan meshes, `computeVertexNormals()` produces flat per-face normals,
 * so a single triangle's normal is noisy. Averaging nearby normals gives a stable
 * estimate of the local surface orientation.
 *
 * The angular gate (45°) prevents vertices on a perpendicular surface (e.g. the other
 * wall at a 90° corner) from contaminating the average.
 *
 * Falls back to the face normal when no qualifying vertices are found.
 */
function smoothNormal(mesh: Mesh, hitPoint: Vector3, faceNormal: Vector3, radiusM: number): Vector3 {
  const posAttr = mesh.geometry.getAttribute('position');
  const normalAttr = mesh.geometry.getAttribute('normal');
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);

  if (!posAttr || !normalAttr) {
    return faceNormal.clone().applyNormalMatrix(normalMatrix);
  }

  // Work in local mesh space so distances are correct regardless of world transform
  const localHit = mesh.worldToLocal(hitPoint.clone());

  const acc = new Vector3();
  const r2 = radiusM * radiusM;
  // Only include vertices whose normal is within 45° of the hit face normal.
  // cos(45°) ≈ 0.707 — perpendicular walls (90°) are cleanly excluded.
  const COS_GATE = Math.cos(Math.PI / 4);
  const _faceNor = faceNormal.clone().normalize();
  const _pos = new Vector3();
  const _nor = new Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    _pos.fromBufferAttribute(posAttr as BufferAttribute, i);
    if (_pos.distanceToSquared(localHit) <= r2) {
      _nor.fromBufferAttribute(normalAttr as BufferAttribute, i);
      if (_nor.dot(_faceNor) >= COS_GATE) {
        acc.add(_nor);
      }
    }
  }

  if (acc.lengthSq() < 1e-10) {
    return faceNormal.clone().applyNormalMatrix(normalMatrix);
  }

  return acc.normalize().applyNormalMatrix(normalMatrix);
}

/**
 * Cast a ray from a drone camera pixel into the scene and return the first PLY mesh hit.
 * Uses the same OpenCV→Three.js quaternion convention as flyToImage / ImageLayer.
 */
function castRayFromDroneImage(
  image: DroneImage,
  u: number,
  v: number,
  raycaster: RaycasterLike,
  meshes: Mesh[],
): { position: Vector3; faceNormal: Vector3; mesh: Mesh } | null {
  const OPENCV_TO_THREEJS = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  const vfovDeg = (2 * Math.atan(image.imageHeight / 2 / image.focalLengthY) * 180) / Math.PI;
  const aspect = image.imageWidth / image.imageHeight;
  const droneCam = new PerspectiveCamera(vfovDeg, aspect, 0.01, 1000);
  droneCam.position.set(image.position[0], image.position[1], image.position[2]);
  droneCam.quaternion.copy(
    new Quaternion(
      image.orientationQuat[0],
      image.orientationQuat[1],
      image.orientationQuat[2],
      image.orientationQuat[3],
    ).multiply(OPENCV_TO_THREEJS),
  );
  droneCam.updateMatrixWorld();
  const ndcX = (u / image.imageWidth) * 2 - 1;
  const ndcY = -(v / image.imageHeight) * 2 + 1;
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), droneCam);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0 || !hits[0].face) return null;
  return {
    position: hits[0].point.clone(),
    faceNormal: hits[0].face.normal.clone(),
    mesh: hits[0].object as Mesh,
  };
}

export interface PlyViewerHandle {
  /** Smoothly move the camera to look at the given world-space position, 1 m away along the optional surface normal. */
  flyTo(position: Vector3, normal?: Vector3): void;
  /** Fly the camera to the drone's exact pose so the 3D view lines up with the captured image. */
  flyToImage(image: DroneImage): void;
  /** Highlight the given drone image sphere (cyan) without moving the camera. */
  selectImage(image: DroneImage): void;
  /** Highlight the given plan task in 3D without moving the camera. */
  selectTask(task: InspectionTask): void;
  /** Fly to the given plan task's 3D position. */
  flyToTask(task: InspectionTask): void;
  /** Highlight or un-highlight a task ring on hover (no camera movement). */
  hoverTask(task: InspectionTask | null): void;
  /** Clear every selection type simultaneously (region ring, element, NDT, task, defect). */
  clearAllSelections(): void;
  /** Clear any plan task selection highlight. */
  clearTaskSelection(): void;
  /** Highlight the given defect ring (cyan) or clear selection when null. */
  selectDefect(defect: DefectDetection | null): void;
  /** Update hover highlight on a defect ring without selecting it. */
  hoverDefect(defect: DefectDetection | null): void;
  /**
   * Highlight a drone image frustum in amber to indicate it is the active
   * suggestion from a surface selection (Stage 2). Pass `null` to clear.
   */
  setActiveFrustumId(externalId: string | null): void;
  /** Cast a ray from the image pixel and show a hover indicator on the 3D mesh surface. */
  hoverImageRay(image: DroneImage, u: number, v: number): void;
  /** Hide the hover indicator shown by hoverImageRay. */
  clearImageRayHover(): void;
  /** Cast a ray from the image pixel and fire onHitSelected with the surface hit. */
  selectImageRay(image: DroneImage, u: number, v: number): void;
  /** Remove any roll from the camera while preserving yaw and pitch (ground-plane mode). */
  resetRoll(): void;
  /** Fly camera to an exact world-space position and lookAt target. */
  flyToExactPose(position: Vector3, target: Vector3): void;
  /** Return the current camera position and lookAt target, or null if not yet initialised. */
  getCurrentCameraPose(): { position: [number, number, number]; target: [number, number, number] } | null;
}

export interface PlyViewerProps {
  /**
   * Per-campaign collision proxies — small decimated PLY meshes that are never drawn but
   * are ray-cast for surface picking, smoothed normals, the hover ring and image rays
   * (Reveal's own picking returns no normals). Grouped and toggled per campaign.
   */
  plyEntries: { key: string; url: string; campaignId: string }[];
  /** Per-campaign CDF CAD models — the rendered meshes, streamed by Reveal. */
  cadModels?: CampaignCadModel[];
  /** Per-file PCD point cloud entries — each is independently togglable via pcdVisibilityStore. */
  pcdUrls?: { key: string; url: string }[];
  elements: StructuralElement[];
  /** NDT thickness measurements to visualize as cyan spheres. */
  ndtMeasurements?: NdtMeasurement[];
  /** Detected defects to visualize as red ring+disc markers. */
  defects?: DefectDetection[];
  /** Drone camera images to visualize as spheres + frustum wireframes. */
  droneImages?: DroneImage[];
  onHitSelected?: (hit: SelectionHit | null) => void;
  /** World-space "up" vector [x, y, z] for this area's ground plane.
   *  Sets camera.up so fly-to animations and the initial view have correct roll. */
  groundPlane?: [number, number, number];
  /** Override the automatic fit-to-model with a fixed starting camera pose. */
  initialCameraPose?: { position: [number, number, number]; target: [number, number, number] };
  /** Called when the camera comes to rest after the user (or a fly-to) moved it — used to keep `?camera=` in the URL. */
  onCameraSettled?: (pose: CameraPose) => void;
}

type DownloadEntry = { loaded: number; total: number; done: boolean; parsing: boolean; fromCache: boolean };

type ProgressState = {
  /** 0–100 if Content-Length was known for all files, null if indeterminate */
  percent: number | null;
  /** All bytes received but geometry not yet parsed */
  parsing: boolean;
  /** Geometry is being reconstructed from the parsed geometry cache (no download needed) */
  loadingFromCache: boolean;
  allDone: boolean;
};

function computeProgress(downloads: Map<string, DownloadEntry>): ProgressState {
  const entries = [...downloads.values()];
  const allDone = entries.length > 0 && entries.every((e) => e.done);
  const parsing = entries.some((e) => e.parsing);
  const loadingFromCache = !allDone && entries.some((e) => e.fromCache && !e.done);
  const networkEntries = entries.filter((e) => !e.fromCache);
  const totalBytes = networkEntries.reduce((s, e) => s + e.total, 0);
  const loadedBytes = networkEntries.reduce((s, e) => s + e.loaded, 0);
  return {
    percent: totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : null,
    parsing,
    loadingFromCache,
    allDone,
  };
}

const EMPTY_PLY_ENTRIES: { key: string; url: string; campaignId: string }[] = [];
const EMPTY_PCD_URLS: { key: string; url: string }[] = [];
const EMPTY_NDT_MEASUREMENTS: NdtMeasurement[] = [];
const EMPTY_DEFECTS: DefectDetection[] = [];
const EMPTY_DRONE_IMAGES: DroneImage[] = [];
const EMPTY_CAD_MODELS: CampaignCadModel[] = [];

/** Returns true when the keyboard event originated from a text-entry element. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export const PlyViewer = forwardRef<PlyViewerHandle, PlyViewerProps>(function PlyViewer(
  { plyEntries = EMPTY_PLY_ENTRIES, cadModels = EMPTY_CAD_MODELS, pcdUrls = EMPTY_PCD_URLS, elements, ndtMeasurements = EMPTY_NDT_MEASUREMENTS, defects = EMPTY_DEFECTS, droneImages = EMPTY_DRONE_IMAGES, onHitSelected, groundPlane, initialCameraPose, onCameraSettled }: PlyViewerProps,
  ref,
) {
  const { createEngine, createRaycaster, useSdk, getDownloadUrl } = useContext(PlyViewerContext);
  const sdk = useSdk();
  const onCameraSettledRef = useRef(onCameraSettled);
  onCameraSettledRef.current = onCameraSettled;
  const containerRef = useRef<HTMLDivElement>(null);
  const semanticLayerRef = useRef<SemanticLayer | null>(null);
  const ndtLayerRef = useRef<NdtMeasurementLayer | null>(null);
  const planTasksLayerRef = useRef<PlanTasksLayer | null>(null);
  const defectLayerRef = useRef<DefectDetectionLayer | null>(null);
  const selectionLayerRef = useRef<SelectionLayer | null>(null);
  const loadedObjectsRef = useRef<Mesh[]>([]);
  /** Per-campaign CAD model handles (the rendered meshes). */
  const cadHandlesRef = useRef<Map<string, CadModelHandle>>(new Map());
  /** Per-key map of loaded PCD Points objects — used by pcdVisibilityStore subscription. */
  const pcdObjectsRef = useRef<Map<string, Points>>(new Map());
  /** Per-campaign Three.js Groups (children of meshLayer) — used for per-campaign MESH visibility. */
  const campaignMeshGroupsRef = useRef<Map<string, Group>>(new Map());
  const elementsRef = useRef<StructuralElement[]>(elements);
  const ndtMeasurementsRef = useRef<NdtMeasurement[]>(ndtMeasurements);
  const defectsRef = useRef<DefectDetection[]>(defects);
  const droneImagesRef = useRef<DroneImage[]>(droneImages);
  const imageLayerRef = useRef<ImageLayer | null>(null);
  // Refs shared between useEffect and useImperativeHandle for camera fly-to.
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<FirstPersonViewerControls | GroundPlaneViewerControls | null>(null);
  interface FlyState { cameraPos: Vector3; lookAt?: Vector3; targetQuat?: Quaternion }
  const flyStateRef = useRef<FlyState | null>(null);
  // Shared raycaster — created in useEffect, exposed to useImperativeHandle for image ray picking.
  const raycasterRef = useRef<RaycasterLike | null>(null);
  // Hover indicator sphere for image ray picking — shown in 3D at the surface hit point.
  const hoverDotRef = useRef<Mesh | null>(null);
  // Ground-plane state — used by the ground-plane effect to re-orient the camera.
  const cameraFittedRef = useRef(false);
  const userHasInteractedRef = useRef(false);
  const sceneCenterRef = useRef<Vector3 | null>(null);
  // When a custom initialCameraPose is set, stores that target so the ground-plane
  // effect looks at the right point rather than the bounding-box centre.
  const initialTargetRef = useRef<Vector3 | null>(null);

  // Raw per-file progress lives in a ref (no need to re-render on every XHR tick)
  const downloadsRef = useRef<Map<string, DownloadEntry>>(new Map());
  // Only entries whose layer toggle is already on are downloaded up front — hidden
  // campaigns/point clouds are fetched lazily once their toggle turns on (see
  // triggerPlyLoad/triggerPcdLoad in the effect below).
  const visibleLoadUrls = [
    ...plyEntries
      .filter((e) => useLayerVisibilityStore.getState().visibility[e.campaignId]?.['MESH'] === true)
      .map((e) => e.url),
    ...pcdUrls
      .filter((e) => usePcdVisibilityStore.getState().isPcdVisible(e.key))
      .map((e) => e.url),
  ].filter(Boolean);
  const [progressState, setProgressState] = useState<ProgressState>({
    percent: null,
    parsing: false,
    loadingFromCache: false,
    allDone: visibleLoadUrls.length === 0,
  });
  // Set when the WebGL context is lost (typically a GPU/renderer OOM from loading too
  // much raw mesh/point-cloud data at once) — shows a visible error instead of the
  // browser's native blank/"sad" canvas with no console output.
  const [rendererCrashed, setRendererCrashed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abortController = new AbortController();
    const { signal } = abortController;

    // Reset progress for this set of URLs (PLY + PCD). Entries can briefly carry an
    // unresolved (empty) url — ViewerPage renders as soon as the file-entry query
    // resolves, without waiting for the separate download-URL query — so empty
    // urls are filtered out here rather than being treated as real downloads.
    // Only campaigns/point clouds whose layer toggle is already on are seeded here —
    // hidden ones are added to `downloads` lazily when their toggle turns on.
    const initialLoadUrls = [
      ...plyEntries
        .filter((e) => useLayerVisibilityStore.getState().visibility[e.campaignId]?.['MESH'] === true)
        .map((e) => e.url),
      ...pcdUrls
        .filter((e) => usePcdVisibilityStore.getState().isPcdVisible(e.key))
        .map((e) => e.url),
    ].filter(Boolean);
    campaignMeshGroupsRef.current = new Map();
    const downloads = new Map<string, DownloadEntry>(
      initialLoadUrls.map((url) => [url, { loaded: 0, total: 0, done: false, parsing: false, fromCache: false }]),
    );
    downloadsRef.current = downloads;
    setProgressState({ percent: null, parsing: false, loadingFromCache: false, allDone: initialLoadUrls.length === 0 });
    setRendererCrashed(false);


    // A lost WebGL context (typically the GPU process crashing from a memory-hungry
    // parse/render) otherwise leaves the canvas blank with no console output at all —
    // this surfaces it as a visible error state and a real log line.
    const onContextLost = (event: Event) => {
      event.preventDefault();
      console.error(
        '[PlyViewer] WebGL context lost — the GPU likely ran out of memory rendering the ' +
          'currently visible layers. Hide some layers or reload the page.',
      );
      setRendererCrashed(true);
    };
    // Root of every overlay object (layers, PCDs, rings); rendered by the engine with the CAD models.
    const scene = new Group();

    const camera = new PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 1000);
    camera.position.set(0, 5, 10);
    cameraRef.current = camera;

    // Reveal sector-loading progress for the initial load of the visible CAD models.
    let initialCadLoadDone = false;
    const onCadLoading = (loaded: number, requested: number) => {
      if (initialCadLoadDone || signal.aborted || requested === 0) return;
      const done = loaded >= requested;
      downloads.set('cad-sectors', { loaded, total: requested, done, parsing: false, fromCache: false });
      if (done) initialCadLoadDone = true;
      setProgressState(computeProgress(downloads));
    };
    const engine = createEngine({ container, camera, sdk, onLoading: onCadLoading });
    engine.setPixelRatio(window.devicePixelRatio);
    engine.setSize(container.clientWidth, container.clientHeight);
    const renderer = engine;
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const groundNormalVec = groundPlane
      ? new Vector3(...groundPlane).normalize()
      : new Vector3(0, 1, 0);

    camera.up.copy(groundNormalVec);

    const controlsModeRef = { current: useViewerControlsModeStore.getState().mode as ControlsMode };

    const makeControls = (mode: ControlsMode) => {
      const c = mode === 'free'
        ? new FirstPersonViewerControls(camera, renderer.domElement)
        : new GroundPlaneViewerControls(camera, renderer.domElement, groundNormalVec);
      c.onNavigate = () => { flyStateRef.current = null; };
      const s = useViewerSettingsStore.getState();
      c.rotateSpeed = s.mouseRotateSpeed;
      c.panSpeed    = s.mousePanSpeed;
      c.scrollSpeed = s.mouseScrollSpeed;
      return c;
    };

    let controls = makeControls(controlsModeRef.current);
    controlsRef.current = controls;

    // Keep control speeds live via settings store subscription.
    const unsubscribeSettings = useViewerSettingsStore.subscribe((s) => {
      moveSpeedRef.current      = s.moveSpeed;
      keyRotateSpeedRef.current = s.keyRotateSpeed;
      controls.rotateSpeed      = s.mouseRotateSpeed;
      controls.panSpeed         = s.mousePanSpeed;
      controls.scrollSpeed      = s.mouseScrollSpeed;
    });

    // Swap controls when the navigation mode changes.
    const unsubscribeControlsMode = useViewerControlsModeStore.subscribe((s) => {
      controls.dispose();
      controls = makeControls(s.mode);
      controlsModeRef.current = s.mode;
      controlsRef.current = controls;
    });

    let userHasInteracted = false;
    const onUserInput = () => { userHasInteracted = true; userHasInteractedRef.current = true; };
    renderer.domElement.addEventListener('pointerdown', onUserInput);
    window.addEventListener('keydown', onUserInput, { once: true });

    // WASD keyboard navigation — move camera + orbit target together so
    // OrbitControls doesn't fight the displacement.
    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => { if (!isTypingTarget(e)) keys.add(e.code); };
    const onKeyUp = (e: KeyboardEvent) => { if (!isTypingTarget(e)) keys.delete(e.code); };
    const onWindowBlur = () => keys.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    const moveSpeedRef = { current: useViewerSettingsStore.getState().moveSpeed };
    const keyRotateSpeedRef = { current: useViewerSettingsStore.getState().keyRotateSpeed };
    // Reusable vectors — allocated once to avoid per-frame GC pressure
    const _dir = new Vector3();
    const _right = new Vector3();
    const _cameraUp = new Vector3();
    const _displacement = new Vector3();
    // Reusable fly-to and key-rotate helpers — allocated once to avoid per-frame GC pressure
    const _flyMatrix = new Matrix4();
    const _flyTargetQ = new Quaternion();
    const _keyRotQ = new Quaternion();

    loadedObjectsRef.current = [];
    pcdObjectsRef.current = new Map();

    const semanticLayer = new SemanticLayer();
    semanticLayerRef.current = semanticLayer;
    const ndtLayer = new NdtMeasurementLayer();
    ndtLayerRef.current = ndtLayer;
    const planTasksLayer = new PlanTasksLayer();
    planTasksLayerRef.current = planTasksLayer;
    const defectLayer = new DefectDetectionLayer();
    defectLayerRef.current = defectLayer;
    const meshLayer = new MeshLayer();
    const layerManager = new ViewerLayerManager();
    layerManager.register('mesh', meshLayer);
    layerManager.register('semantic', semanticLayer);
    layerManager.register('ndt', ndtLayer);
    layerManager.getLayers().forEach((l) => scene.add(l.group));
    scene.add(planTasksLayer.group);
    scene.add(defectLayer.group);

    // Build a type→group map for the visibility subscription
    const layerGroupMap = new Map<LayerType, Group>();
    layerManager.getLayers().forEach((l) => layerGroupMap.set(l.layerType, l.group));

    // Sync initial visibility (store may already be initialised from a prior render)
    layerGroupMap.forEach((group, layerType) => {
      group.visible = useLayerVisibilityStore.getState().isEffectivelyVisible(layerType);
    });
    const initState = useLayerVisibilityStore.getState();
    ndtLayer.syncCampaignVisibility(
      (id) => initState.visibility[id]?.['NDT_MEASUREMENTS'] === true,
    );

    // Lazily fetch+parse a campaign's PLY mesh / a PCD file the first time its layer
    // toggle turns on. Assigned to their real implementation further down (once
    // loadOnePly / fetchPlyWithCache are in scope) — declared here so the visibility
    // subscriptions registered below can call whatever implementation is current when
    // a toggle fires later.
    let triggerPlyLoad: (url: string, campaignId: string, key: string) => void = () => {};
    let triggerPcdLoad: (key: string, url: string) => void = () => {};
    let triggerCadLoad: (cad: CampaignCadModel) => void = () => {};

    // Subscribe to future visibility changes — imperatively updates Three.js without
    // triggering a React re-render on the canvas.
    const unsubscribeVisibility = useLayerVisibilityStore.subscribe((state) => {
      layerGroupMap.forEach((group, layerType) => {
        group.visible = state.isEffectivelyVisible(layerType);
      });
      // Per-campaign mesh group visibility — each campaign's meshes are shown/hidden
      // based on whether that campaign's MESH toggle is enabled.
      campaignMeshGroupsRef.current.forEach((group, campaignId) => {
        group.visible = state.visibility[campaignId]?.['MESH'] === true;
      });
      cadHandlesRef.current.forEach((handle, campaignId) => {
        handle.setVisible(state.isEffectivelyVisible('MESH') && state.visibility[campaignId]?.['MESH'] === true);
      });
      cadModels.forEach((cad) => {
        if (state.visibility[cad.campaignExternalId]?.['MESH'] === true) triggerCadLoad(cad);
      });
      // Fetch+parse a campaign's PLY mesh the first time its MESH toggle turns on —
      // avoids downloading every campaign's raw mesh up front (see triggerPlyLoad).
      plyEntries.forEach(({ url, campaignId, key }) => {
        if (url && state.visibility[campaignId]?.['MESH'] === true) triggerPlyLoad(url, campaignId, key);
      });
      // Per-campaign NDT sphere visibility — individual spheres are shown/hidden based
      // on whether their campaign's NDT_MEASUREMENTS toggle is enabled.
      ndtLayerRef.current?.syncCampaignVisibility(
        (campaignId) => state.visibility[campaignId]?.['NDT_MEASUREMENTS'] === true,
      );
    });

    // Subscribe to color mode changes — restyles the CAD models (camera texture / flat
    // colour for "colorization", segment colours for "defects") without reloading them.
    const unsubscribeColorMode = useColorModeStore.subscribe((state) => {
      const mode = state.getColorMode('MESH');
      cadHandlesRef.current.forEach((handle) => {
        handle.setColourMode(mode).catch((error: unknown) => {
          console.error('Failed to apply colour mode to CAD model', error);
        });
      });
    });

    // Subscribe to PCD visibility changes — shows/hides individual PCD point clouds,
    // and fetches+parses a PCD file the first time it's toggled visible (see triggerPcdLoad).
    const unsubscribePcdVisibility = usePcdVisibilityStore.subscribe((state) => {
      pcdObjectsRef.current.forEach((points, key) => {
        points.visible = state.isPcdVisible(key);
      });
      pcdUrls.forEach(({ key, url }) => {
        if (url && state.isPcdVisible(key)) triggerPcdLoad(key, url);
      });
    });

    // Sync initial plan task highlights (store may already have tasks if plan is active)
    const applyPlanHighlights = (tasks: ReturnType<typeof useActivePlanStore.getState>['activePlanTasks']) => {
      const elementIds = new Set(
        tasks
          .filter((t) => t.taskKind === 'element' && t.targetElementExternalId)
          .map((t) => t.targetElementExternalId!),
      );
      semanticLayer.setActivePlanElementIds(elementIds);
      planTasksLayer.update(tasks, elementsRef.current);
      // Clear any task selection when the task list changes (plan switched or tasks added/removed)
      semanticLayer.setSelectedPlanTaskElementId(null);
      planTasksLayer.setSelectedTaskId(null);
    };
    applyPlanHighlights(useActivePlanStore.getState().activePlanTasks);

    // Subscribe to activePlanStore changes to update element highlights without re-renders.
    const unsubscribePlan = useActivePlanStore.subscribe((state) => {
      applyPlanHighlights(state.activePlanTasks);
    });

    const selectionLayer = new SelectionLayer();
    selectionLayerRef.current = selectionLayer;
    scene.add(selectionLayer.group);

    const imageLayer = new ImageLayer();
    imageLayerRef.current = imageLayer;
    imageLayer.update(droneImagesRef.current);
    imageLayer.group.visible = useLayerVisibilityStore.getState().isEffectivelyVisible('IMAGES');
    scene.add(imageLayer.group);
    layerGroupMap.set('IMAGES', imageLayer.group);

    // Armed per effect run once this run's camera has its start pose (see fitCameraOnce).
    const settleDetector = new CameraSettleDetector();
    let settleArmed = false;
    const clock = new Clock();
    let animFrameId: number;
    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (keys.size > 0) {
        const step = moveSpeedRef.current * delta;
        _displacement.set(0, 0, 0);

        if (controlsModeRef.current === 'ground-plane') {
          // Movement projected onto the ground plane: WASD always slides along the floor
          // regardless of where the camera is looking.
          camera.getWorldDirection(_dir);
          _dir.addScaledVector(groundNormalVec, -_dir.dot(groundNormalVec));
          if (_dir.lengthSq() > 1e-10) _dir.normalize();

          _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
          _right.addScaledVector(groundNormalVec, -_right.dot(groundNormalVec));
          if (_right.lengthSq() > 1e-10) _right.normalize();

          if (keys.has('KeyW') || keys.has('ArrowUp'))    _displacement.addScaledVector(_dir, step);
          if (keys.has('KeyS') || keys.has('ArrowDown'))  _displacement.addScaledVector(_dir, -step);
          if (keys.has('KeyA') || keys.has('ArrowLeft'))  _displacement.addScaledVector(_right, -step);
          if (keys.has('KeyD') || keys.has('ArrowRight')) _displacement.addScaledVector(_right, step);
          if (keys.has('KeyR')) _displacement.addScaledVector(groundNormalVec, step);
          if (keys.has('KeyF')) _displacement.addScaledVector(groundNormalVec, -step);
        } else {
          // Free mode: all movement is camera-relative.
          camera.getWorldDirection(_dir);
          _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
          _cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

          if (keys.has('KeyW') || keys.has('ArrowUp'))    _displacement.addScaledVector(_dir, step);
          if (keys.has('KeyS') || keys.has('ArrowDown'))  _displacement.addScaledVector(_dir, -step);
          if (keys.has('KeyA') || keys.has('ArrowLeft'))  _displacement.addScaledVector(_right, -step);
          if (keys.has('KeyD') || keys.has('ArrowRight')) _displacement.addScaledVector(_right, step);
          if (keys.has('KeyR')) _displacement.addScaledVector(_cameraUp, step);
          if (keys.has('KeyF')) _displacement.addScaledVector(_cameraUp, -step);
        }

        if (_displacement.lengthSq() > 0) {
          camera.position.add(_displacement);
          flyStateRef.current = null;
        }

        if (controlsModeRef.current === 'ground-plane') {
          // Ground-plane mode: yaw around the world ground normal (premultiply = world-space);
          // roll around camera-local Z (multiply = local-space). Pitch is mouse-only.
          if (keys.has('KeyQ') || keys.has('KeyE')) {
            _keyRotQ.setFromAxisAngle(groundNormalVec, (keys.has('KeyQ') ? 1 : -1) * keyRotateSpeedRef.current * delta);
            camera.quaternion.premultiply(_keyRotQ);
            flyStateRef.current = null;
          }
          if (keys.has('KeyZ') || keys.has('KeyX')) {
            _keyRotQ.setFromAxisAngle(_cameraUp.set(0, 0, 1), (keys.has('KeyZ') ? 1 : -1) * keyRotateSpeedRef.current * delta);
            camera.quaternion.multiply(_keyRotQ);
            flyStateRef.current = null;
          }
        } else {
          // Free mode: camera-local rotations on all axes (multiply = local-space).
          //   Q/E  yaw   around local Y  (0, 1, 0)
          //   T/G  pitch around local X  (1, 0, 0)
          //   Z/X  roll  around local Z  (0, 0, 1)
          if (keys.has('KeyQ') || keys.has('KeyE') ||
              keys.has('KeyT') || keys.has('KeyG') ||
              keys.has('KeyZ') || keys.has('KeyX')) {
            if (keys.has('KeyQ') || keys.has('KeyE')) {
              _keyRotQ.setFromAxisAngle(_cameraUp.set(0, 1, 0), (keys.has('KeyQ') ? 1 : -1) * keyRotateSpeedRef.current * delta);
              camera.quaternion.multiply(_keyRotQ);
            }
            if (keys.has('KeyT') || keys.has('KeyG')) {
              _keyRotQ.setFromAxisAngle(_cameraUp.set(1, 0, 0), (keys.has('KeyT') ? 1 : -1) * keyRotateSpeedRef.current * delta);
              camera.quaternion.multiply(_keyRotQ);
            }
            if (keys.has('KeyZ') || keys.has('KeyX')) {
              _keyRotQ.setFromAxisAngle(_cameraUp.set(0, 0, 1), (keys.has('KeyZ') ? 1 : -1) * keyRotateSpeedRef.current * delta);
              camera.quaternion.multiply(_keyRotQ);
            }
            flyStateRef.current = null;
          }
        }
      }

      // Camera fly-to: lerp position and slerp orientation each frame.
      if (flyStateRef.current) {
        const { cameraPos, lookAt, targetQuat } = flyStateRef.current;

        camera.position.lerp(cameraPos, 0.07);

        if (targetQuat) {
          camera.quaternion.slerp(targetQuat, 0.1);
        } else if (lookAt) {
          _flyMatrix.lookAt(camera.position, lookAt, camera.up);
          _flyTargetQ.setFromRotationMatrix(_flyMatrix);
          camera.quaternion.slerp(_flyTargetQ, 0.1);
        }

        if (camera.position.distanceTo(cameraPos) < 0.02) {
          camera.position.copy(cameraPos);
          if (targetQuat) {
            camera.quaternion.copy(targetQuat);
          } else if (lookAt) {
            camera.lookAt(lookAt);
          }
          flyStateRef.current = null;
        }
      }

      if (settleArmed && settleDetector.update(camera, performance.now())) {
        onCameraSettledRef.current?.(poseFromCamera(camera));
      }

      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      engine.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);

    const combinedBox = new Box3();
    let cameraFitted = false;

    const updateProgress = () => setProgressState(computeProgress(downloads));

    // Fit camera on the first content that arrives (a CAD model or a collision proxy) so the
    // user sees content immediately. Skip repositioning if the user has already started
    // navigating — moving the camera under them is worse than leaving them to navigate.
    const fitCameraOnce = (box: Box3) => {
      combinedBox.union(box);
      if (cameraFitted) return;
      cameraFitted = true;
      cameraFittedRef.current = true;
      const center = combinedBox.getCenter(new Vector3());
      sceneCenterRef.current = center.clone();
      const size = combinedBox.getSize(new Vector3()).length();
      camera.near = size * 0.001;
      camera.far = size * 10;
      camera.updateProjectionMatrix();
      semanticLayer.update(elements);

      if (!userHasInteracted) {
        if (initialCameraPose) {
          camera.position.set(...initialCameraPose.position);
          const target = new Vector3(...initialCameraPose.target);
          initialTargetRef.current = target;
          camera.lookAt(target);
        } else {
          camera.position.copy(center).add(new Vector3(0, size * 0.3, size * 0.6));
          camera.lookAt(center);
        }
      }
      // The start pose is not a user change: don't write it to the URL.
      settleDetector.reset(camera);
      settleArmed = true;
    };

    const campaignGroupFor = (campaignId: string) => {
      let campaignGroup = campaignMeshGroupsRef.current.get(campaignId);
      if (!campaignGroup) {
        campaignGroup = new Group();
        campaignGroup.visible = useLayerVisibilityStore.getState().visibility[campaignId]?.['MESH'] === true;
        meshLayer.group.add(campaignGroup);
        campaignMeshGroupsRef.current.set(campaignId, campaignGroup);
      }
      return campaignGroup;
    };

    // The collision proxy is never drawn (Reveal renders the CAD model); three.js ray-casts
    // invisible meshes, so picking, smoothed normals and image rays keep working on it.
    const addProxyToScene = (geometry: BufferGeometry, campaignId: string) => {
      const proxy = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
      proxy.visible = false;
      proxy.userData.campaignId = campaignId;
      campaignGroupFor(campaignId).add(proxy);
      loadedObjectsRef.current.push(proxy);
      proxy.updateMatrixWorld();
      fitCameraOnce(new Box3().setFromObject(proxy));
    };

    // Layers are downloaded lazily (when toggled on), possibly long after the page fetched the
    // signed URLs, which CDF expires after ~30 s — so fetch a fresh one right before
    // downloading. The browser caches are keyed by the URL path, so cache hits are unaffected.
    const freshUrl = async (key: string, url: string): Promise<string> => {
      const fileId = Number(key);
      if (!Number.isSafeInteger(fileId) || fileId <= 0) return url;
      try {
        return await getDownloadUrl(sdk, fileId);
      } catch {
        return url;
      }
    };

    const loadOnePly = async (url: string, campaignId: string, key: string) => {
      if (signal.aborted) return;
      const stableKey = derivePlyKey(url);

      const cached = await getCachedParsedPly(stableKey);
      if (cached !== null) {
        if (signal.aborted) return;
        downloads.set(url, { loaded: 0, total: 0, done: false, parsing: false, fromCache: true });
        updateProgress();
        // Yield so React can render "Loading from cache…" before reconstructing geometry.
        // Without this yield, React 18 batches both updateProgress() calls into one render.
        await Promise.resolve();
        if (signal.aborted) return;
        const { geometry } = reconstructGeometry(cached);
        addProxyToScene(geometry, campaignId);
        downloads.set(url, { loaded: 0, total: 0, done: true, parsing: false, fromCache: true });
        updateProgress();
        return;
      }

      const buffer = await fetchPlyWithCache(await freshUrl(key, url), (loaded, total) => {
        if (signal.aborted) return;
        downloads.set(url, { loaded, total, done: false, parsing: false, fromCache: false });
        updateProgress();
      }, signal);

      if (signal.aborted) return;

      // Mark as parsing so the UI shows "Parsing model…" while the worker runs
      const prev = downloads.get(url) ?? { loaded: 0, total: 0, done: false, parsing: false, fromCache: false };
      downloads.set(url, { loaded: prev.total || prev.loaded, total: prev.total || prev.loaded, done: false, parsing: true, fromCache: false });
      updateProgress();

      // Parse in a worker — keeps the main thread free so controls remain responsive
      const { geometry, isMesh, hasFaceColors } = await parsePlyInWorker(buffer, signal);
      if (signal.aborted) return;

      // Persist the parsed geometry so subsequent loads skip download and parse.
      // Fire-and-forget — geometry renders immediately while IDB write happens in the background.
      const cachePayload: CachedParsedPly = {
        attrs: Object.fromEntries(
          Object.entries(geometry.attributes).map(([name, attr]) => [
            name,
            { buffer: (attr.array as Float32Array).buffer as ArrayBuffer, itemSize: attr.itemSize, normalized: attr.normalized },
          ]),
        ),
        index: geometry.index ? (geometry.index.array as Uint16Array | Uint32Array).buffer as ArrayBuffer : null,
        indexIsUint32: geometry.index ? !(geometry.index.array instanceof Uint16Array) : false,
        isMesh,
        hasFaceColors,
      };
      putCachedParsedPly(stableKey, cachePayload).catch(() => undefined);

      addProxyToScene(geometry, campaignId);
      downloads.set(url, { loaded: prev.total || prev.loaded, total: prev.total || prev.loaded, done: true, parsing: false, fromCache: false });
      updateProgress();
    };

    // Fetch + parse a campaign's PLY mesh at most once. Called immediately below for
    // campaigns whose MESH toggle is already on, and later — via triggerPlyLoad — from
    // the visibility subscription the first time a hidden campaign's toggle turns on.
    // This is what keeps an area with several heavy campaigns from downloading and
    // parsing every one of their raw meshes at once (see the CDF investigation this
    // fixes: 3 campaigns x ~270MB ASCII PLY loaded concurrently exhausted GPU memory).
    const startedPlyUrls = new Set<string>();
    triggerPlyLoad = (url: string, campaignId: string, key: string) => {
      if (startedPlyUrls.has(url)) return;
      startedPlyUrls.add(url);
      downloads.set(url, downloads.get(url) ?? { loaded: 0, total: 0, done: false, parsing: false, fromCache: false });
      updateProgress();
      loadOnePly(url, campaignId, key).catch((error: unknown) => {
        if (signal.aborted) return;
        console.error(`Failed to load PLY mesh: ${url}`, error);
        const prev = downloads.get(url) ?? { loaded: 0, total: 0, done: false, parsing: false, fromCache: false };
        downloads.set(url, { ...prev, done: true, parsing: false });
        updateProgress();
      });
    };

    plyEntries.forEach(({ url, campaignId, key }) => {
      if (!url) return; // URL not resolved yet — the effect reruns once it is.
      if (useLayerVisibilityStore.getState().visibility[campaignId]?.['MESH'] === true) {
        triggerPlyLoad(url, campaignId, key);
      }
    });

    // Add a campaign's CAD model the first time its MESH toggle is on (mirrors the lazy PLY /
    // PCD loading: nothing is streamed for campaigns nobody has asked to see).
    const startedCadCampaigns = new Set<string>();
    triggerCadLoad = (cad: CampaignCadModel) => {
      if (startedCadCampaigns.has(cad.campaignExternalId)) return;
      startedCadCampaigns.add(cad.campaignExternalId);
      engine
        .addCadModel(cad)
        .then(async (handle) => {
          if (signal.aborted) return;
          cadHandlesRef.current.set(cad.campaignExternalId, handle);
          const visible = useLayerVisibilityStore.getState();
          handle.setVisible(
            visible.isEffectivelyVisible('MESH') &&
              visible.visibility[cad.campaignExternalId]?.['MESH'] === true,
          );
          await handle.setColourMode(useColorModeStore.getState().getColorMode('MESH'));
          fitCameraOnce(handle.boundingBox);
        })
        .catch((error: unknown) => {
          if (signal.aborted) return;
          console.error(`Failed to load CAD model for campaign ${cad.campaignExternalId}`, error);
        });
    };

    cadModels.forEach((cad) => {
      if (useLayerVisibilityStore.getState().visibility[cad.campaignExternalId]?.['MESH'] === true) {
        triggerCadLoad(cad);
      }
    });

    // Load PCD files — each is added directly to the scene and toggled independently
    // via pcdVisibilityStore (not grouped into meshLayer).
    const pcdLoader = new PCDLoader();

    // Fetch + parse a PCD file at most once. Called immediately below for point clouds
    // already toggled visible, and later — via triggerPcdLoad — from the PCD visibility
    // subscription the first time a hidden one turns on. Mirrors triggerPlyLoad above,
    // for the same reason: don't download raw point-cloud data nobody has asked to see.
    const startedPcdUrls = new Set<string>();
    triggerPcdLoad = (key: string, url: string) => {
      if (startedPcdUrls.has(url)) return;
      startedPcdUrls.add(url);
      downloads.set(url, downloads.get(url) ?? { loaded: 0, total: 0, done: false, parsing: false, fromCache: false });
      updateProgress();

      freshUrl(key, url)
        .then((downloadUrl) => fetchPlyWithCache(downloadUrl, (loaded, total) => {
          if (signal.aborted) return;
          downloads.set(url, { loaded, total, done: false, parsing: false, fromCache: false });
          updateProgress();
        }, signal))
        .then((buffer) => {
          if (signal.aborted) return;

          const prev = downloads.get(url) ?? { loaded: 0, total: 0, done: false, parsing: false, fromCache: false };
          downloads.set(url, { loaded: prev.total || prev.loaded, total: prev.total || prev.loaded, done: false, parsing: true, fromCache: false });
          updateProgress();

          // PCDLoader.parse is synchronous
          const points = pcdLoader.parse(buffer);
          // Override vertex colours with semantic label colours when the PCD has a label field.
          applyLabelColors(buffer, points.geometry);
          const hasColor = points.geometry.hasAttribute('color');

          // Pre-build dual materials for instant color mode toggling
          const colorMat = new PointsMaterial({
            size: 0.02,
            vertexColors: hasColor,
            color: hasColor ? 0xffffff : 0x88aaff,
          });
          const semanticsMat = new PointsMaterial({ size: 0.02, vertexColors: false, color: 0x88aaff });
          const pcdMaterials: Record<ColorMode, PointsMaterial> = { colorization: colorMat, defects: semanticsMat };
          points.userData.materials = pcdMaterials;

          const initMode = useColorModeStore.getState().getColorMode('POINT_CLOUD');
          points.material = pcdMaterials[initMode];
          points.visible = usePcdVisibilityStore.getState().isPcdVisible(key);

          pcdObjectsRef.current.set(key, points);
          scene.add(points);
          fitCameraOnce(new Box3().setFromObject(points));

          downloads.set(url, { loaded: prev.total || prev.loaded, total: prev.total || prev.loaded, done: true, parsing: false, fromCache: false });
          updateProgress();
        })
        .catch((error: unknown) => {
          if (signal.aborted) return;
          console.error(`Failed to load PCD: ${url}`, error);
          const prev = downloads.get(url) ?? { loaded: 0, total: 0, done: false, parsing: false, fromCache: false };
          downloads.set(url, { ...prev, done: true, parsing: false });
          updateProgress();
        });
    };

    pcdUrls.forEach(({ key, url }) => {
      if (!url) return; // URL not resolved yet — the effect reruns once it is.
      if (usePcdVisibilityStore.getState().isPcdVisible(key)) {
        triggerPcdLoad(key, url);
      }
    });

    const raycaster = createRaycaster();
    raycasterRef.current = raycaster;
    const ndcCoords = new Vector2();

    // Hover ring: shown at the 3D surface hit by an image ray — same radius as the selection ring.
    const hoverDot = new Mesh(
      new RingGeometry(REGION_CIRCLE_RADIUS_M * 0.85, REGION_CIRCLE_RADIUS_M, 48),
      new MeshBasicMaterial({ color: 0xffd700, depthTest: false, side: DoubleSide }),
    );
    hoverDot.visible = false;
    hoverDot.renderOrder = 998;
    scene.add(hoverDot);
    hoverDotRef.current = hoverDot;

    // Helper: apply/clear plan task selection highlights in all relevant layers.
    const applyTaskSelection = (task: InspectionTask | null) => {
      planTasksLayer.setSelectedTaskId(task?.externalId ?? null);
      if (task?.taskKind === 'element' && task.targetElementExternalId) {
        semanticLayer.setSelectedPlanTaskElementId(task.targetElementExternalId);
      } else {
        semanticLayer.setSelectedPlanTaskElementId(null);
      }
      selectionLayerRef.current?.clear();
    };

    // Helper: reset every layer to unselected before applying a new selection.
    const clearAllSelections = () => {
      selectionLayer.clear();
      semanticLayer.setSelectedElementId(null);
      semanticLayer.setSelectedPlanTaskElementId(null);
      ndtLayerRef.current?.setSelectedMeasurementId(null);
      planTasksLayer.setSelectedTaskId(null);
      defectLayer.setSelectedId(null);
      imageLayerRef.current?.clearHighlights();
    };

    // Cursor feedback: pointer when hovering over a plan task or defect hit mesh.
    // Also shows the gold hover ring on the PLY mesh surface under the cursor.
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        if (hoverDotRef.current) hoverDotRef.current.visible = false;
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      ndcCoords.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndcCoords, camera);
      const planHits = raycaster.intersectObjects(planTasksLayer.getHitMeshes(), false);
      const defectHits = raycaster.intersectObjects(defectLayer.getHitMeshes(), false);
      renderer.domElement.style.cursor = planHits.length > 0 || defectHits.length > 0 ? 'pointer' : '';
      defectLayer.setHoveredId(
        defectHits.length > 0 ? (defectLayer.externalIdForMesh(defectHits[0].object as Mesh) ?? null) : null,
      );
      // Gold ring: only when not hovering a clickable overlay (double-click on those selects them, not the mesh)
      if (planHits.length === 0 && defectHits.length === 0 && hoverDotRef.current) {
        const meshObjects = meshLayer.group.visible
          ? loadedObjectsRef.current.filter(
              (o): o is Mesh =>
                o instanceof Mesh &&
                (campaignMeshGroupsRef.current.get(o.userData.campaignId as string)?.visible ?? true),
            )
          : [];
        const meshHits = raycaster.intersectObjects(meshObjects, false);
        if (meshHits.length > 0 && meshHits[0].face) {
          const hit = meshHits[0];
          const worldNormal = smoothNormal(hit.object as Mesh, hit.point, hit.face!.normal, REGION_CIRCLE_RADIUS_M);
          hoverDotRef.current.position.copy(hit.point);
          hoverDotRef.current.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), worldNormal);
          hoverDotRef.current.visible = true;
        } else {
          hoverDotRef.current.visible = false;
        }
      } else if (hoverDotRef.current) {
        hoverDotRef.current.visible = false;
      }
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    const onPointerLeave = () => {
      if (hoverDotRef.current) hoverDotRef.current.visible = false;
    };
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    // Single click: plan task or defect selection
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndcCoords.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndcCoords, camera);

      // No occlusion check: rings render with depthTest:false so they're always visible,
      // and the cursor already changes without checking occlusion — clicks should match.

      const planTaskHitCandidates = planTasksLayer.getHitMeshes();
      if (planTaskHitCandidates.length > 0) {
        const planTaskHits = raycaster.intersectObjects(planTaskHitCandidates, false);
        if (planTaskHits.length > 0) {
          const { taskExternalId } = planTaskHits[0].object.userData as { taskExternalId: string };
          const matched = useActivePlanStore.getState().activePlanTasks
            .find((t) => t.externalId === taskExternalId);
          if (matched) {
            clearAllSelections();
            applyTaskSelection(matched);
            onHitSelected?.({ kind: 'task', task: matched });
            return;
          }
        }
      }

      const defectHitCandidates = defectLayer.getHitMeshes();
      if (defectHitCandidates.length > 0) {
        const defectHits = raycaster.intersectObjects(defectHitCandidates, false);
        if (defectHits.length > 0) {
          const externalId = defectLayer.externalIdForMesh(defectHits[0].object as Mesh);
          const matched = defectsRef.current.find((d) => d.externalId === externalId);
          if (matched) {
            clearAllSelections();
            defectLayer.setSelectedId(matched.externalId);
            onHitSelected?.({ kind: 'defect', defect: matched });
          }
        }
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    const onDoubleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndcCoords.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndcCoords, camera);

      // Compute PLY mesh hits once — reused for occlusion testing and surface selection
      // (skip Points — no meaningful surface normal; skip hidden campaign meshes)
      const meshObjects = meshLayer.group.visible
        ? loadedObjectsRef.current.filter((o): o is Mesh =>
            o instanceof Mesh &&
            (campaignMeshGroupsRef.current.get(o.userData.campaignId as string)?.visible ?? true),
          )
        : [];
      const meshHits = raycaster.intersectObjects(meshObjects, false);

      // Priority 1: semantic element hit meshes — only if semantic layer is visible and not occluded by PLY mesh
      const elementHits = semanticLayer.group.visible
        ? raycaster.intersectObjects(semanticLayer.getHitMeshes(), false)
        : [];
      if (elementHits.length > 0) {
        const nearestElement = elementHits[0];
        const isOccluded = meshHits.length > 0 && meshHits[0].distance < nearestElement.distance;
        if (!isOccluded) {
          const { externalId } = nearestElement.object.userData as { externalId: string };
          const matched = elementsRef.current.find((el) => el.externalId === externalId);
          if (matched) {
            clearAllSelections();
            selectionLayerRef.current?.setElementHit(matched);
            semanticLayer.setSelectedElementId(externalId);
            onHitSelected?.({ kind: 'element', element: matched });
            return;
          }
        }
      }

      // Priority 1.5: NDT measurement hit meshes — only visible campaign spheres
      const ndtHitCandidates = ndtLayerRef.current?.group.visible
        ? ndtLayerRef.current.getHitMeshes().filter((m) => m.visible)
        : [];
      const ndtHits = ndtHitCandidates.length > 0
        ? raycaster.intersectObjects(ndtHitCandidates, false)
        : [];
      if (ndtHits.length > 0) {
        const nearestNdt = ndtHits[0];
        const isOccluded = meshHits.length > 0 && meshHits[0].distance < nearestNdt.distance;
        if (!isOccluded) {
          const { externalId } = nearestNdt.object.userData as { externalId: string };
          const matched = ndtMeasurementsRef.current.find((m) => m.externalId === externalId);
          if (matched) {
            clearAllSelections();
            ndtLayerRef.current?.setSelectedMeasurementId(externalId);
            onHitSelected?.({ kind: 'ndt', measurement: matched });
            return;
          }
        }
      }

      // Priority 1.8: drone image spheres — only if IMAGES layer is visible
      const imageHitCandidates = imageLayerRef.current?.group.visible
        ? imageLayerRef.current.getHitMeshes()
        : [];
      const imageHits = imageHitCandidates.length > 0
        ? raycaster.intersectObjects(imageHitCandidates, false)
        : [];
      if (imageHits.length > 0) {
        const nearestImage = imageHits[0];
        const isOccluded = meshHits.length > 0 && meshHits[0].distance < nearestImage.distance;
        if (!isOccluded) {
          const { externalId } = nearestImage.object.userData as { externalId: string };
          const matched = droneImagesRef.current.find((img) => img.externalId === externalId);
          if (matched) {
            clearAllSelections();
            imageLayerRef.current?.setSelectedImageId(externalId);
            onHitSelected?.({ kind: 'image', image: matched });
            return;
          }
        }
      }

      // Priority 2: PLY mesh surface
      if (meshHits.length > 0 && meshHits[0].face) {
        const hit = meshHits[0];
        const worldNormal = smoothNormal(
          hit.object as Mesh,
          hit.point,
          hit.face!.normal,
          REGION_CIRCLE_RADIUS_M,
        );
        clearAllSelections();
        selectionLayerRef.current?.setRegionHit(hit.point, worldNormal);
        onHitSelected?.({ kind: 'region', position: hit.point.clone(), normal: worldNormal });
      }
    };

    renderer.domElement.addEventListener('dblclick', onDoubleClick);

    return () => {
      unsubscribeVisibility();
      unsubscribeColorMode();
      unsubscribePcdVisibility();
      unsubscribePlan();
      unsubscribeSettings();
      unsubscribeControlsMode();
      abortController.abort();
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('keydown', onUserInput);
      renderer.domElement.removeEventListener('pointerdown', onUserInput);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      cadHandlesRef.current = new Map();
      engine.dispose();
      semanticLayerRef.current = null;
      ndtLayerRef.current = null;
      planTasksLayerRef.current = null;
      defectLayerRef.current = null;
      selectionLayerRef.current = null;
      imageLayerRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      flyStateRef.current = null;
      raycasterRef.current = null;
      hoverDotRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- plyEntries/pcdUrls/cadModels are stable per mount; createEngine/createRaycaster/sdk are stable context refs; elements handled below
  }, [plyEntries, pcdUrls, cadModels]);

  useImperativeHandle(ref, () => ({
    clearAllSelections() {
      selectionLayerRef.current?.clear();
      semanticLayerRef.current?.setSelectedElementId(null);
      semanticLayerRef.current?.setSelectedPlanTaskElementId(null);
      ndtLayerRef.current?.setSelectedMeasurementId(null);
      planTasksLayerRef.current?.setSelectedTaskId(null);
      defectLayerRef.current?.setSelectedId(null);
      imageLayerRef.current?.clearHighlights();
    },

    setActiveFrustumId(externalId: string | null) {
      imageLayerRef.current?.setActiveFrustumId(externalId);
    },

    flyTo(position: Vector3, normal?: Vector3) {
      const cam = cameraRef.current;
      if (!cam) return;

      let approachDir: Vector3;
      if (normal && normal.lengthSq() > 0.0001) {
        approachDir = normal.clone().normalize();
      } else {
        approachDir = cam.position.clone().sub(position);
        if (approachDir.lengthSq() < 0.0001) approachDir.set(0, 0, 1);
        approachDir.normalize();
      }

      flyStateRef.current = {
        cameraPos: position.clone().addScaledVector(approachDir, 1.0),
        lookAt: position.clone(),
      };
    },

    flyToImage(image: DroneImage) {
      // OpenCV convention (+Z forward) → Three.js convention (-Z forward): 180° around local X
      const OPENCV_TO_THREEJS = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
      const pos = new Vector3(image.position[0], image.position[1], image.position[2]);
      const quat = new Quaternion(
        image.orientationQuat[0],
        image.orientationQuat[1],
        image.orientationQuat[2],
        image.orientationQuat[3],
      ).multiply(OPENCV_TO_THREEJS);
      flyStateRef.current = { cameraPos: pos, targetQuat: quat };
    },

    selectImage(image: DroneImage) {
      imageLayerRef.current?.clearHighlights();
      imageLayerRef.current?.setSelectedImageId(image.externalId);
    },

    selectTask(task: InspectionTask) {
      planTasksLayerRef.current?.setSelectedTaskId(task.externalId);
      if (task.taskKind === 'element' && task.targetElementExternalId) {
        semanticLayerRef.current?.setSelectedPlanTaskElementId(task.targetElementExternalId);
      } else {
        semanticLayerRef.current?.setSelectedPlanTaskElementId(null);
      }
      selectionLayerRef.current?.clear();
    },

    flyToTask(task: InspectionTask) {
      if (task.taskKind === 'region') {
        const pos = new Vector3(...(task.position3d ?? [0, 0, 0]));
        const normal = task.normalVector ? new Vector3(...task.normalVector) : undefined;
        this.flyTo(pos, normal);
      } else {
        const el = elementsRef.current.find((e) => e.externalId === task.targetElementExternalId);
        if (el) this.flyTo(new Vector3(...el.center));
      }
    },

    hoverTask(task: InspectionTask | null) {
      planTasksLayerRef.current?.setHoveredTaskId(task?.externalId ?? null);
    },

    clearTaskSelection() {
      planTasksLayerRef.current?.setSelectedTaskId(null);
      semanticLayerRef.current?.setSelectedPlanTaskElementId(null);
    },

    selectDefect(defect: DefectDetection | null) {
      defectLayerRef.current?.setSelectedId(defect?.externalId ?? null);
    },

    hoverDefect(defect: DefectDetection | null) {
      defectLayerRef.current?.setHoveredId(defect?.externalId ?? null);
    },

    hoverImageRay(image: DroneImage, u: number, v: number) {
      const rc = raycasterRef.current;
      if (!rc) return;
      const meshes = loadedObjectsRef.current.filter((o): o is Mesh => o instanceof Mesh);
      const result = castRayFromDroneImage(image, u, v, rc, meshes);
      if (result && hoverDotRef.current) {
        const worldNormal = smoothNormal(result.mesh, result.position, result.faceNormal, REGION_CIRCLE_RADIUS_M);
        hoverDotRef.current.position.copy(result.position);
        hoverDotRef.current.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), worldNormal);
        hoverDotRef.current.visible = true;
      } else if (hoverDotRef.current) {
        hoverDotRef.current.visible = false;
      }
    },

    clearImageRayHover() {
      if (hoverDotRef.current) hoverDotRef.current.visible = false;
    },

    selectImageRay(image: DroneImage, u: number, v: number) {
      const rc = raycasterRef.current;
      if (!rc) return;
      const meshes = loadedObjectsRef.current.filter((o): o is Mesh => o instanceof Mesh);
      const result = castRayFromDroneImage(image, u, v, rc, meshes);
      if (!result) return;
      if (hoverDotRef.current) hoverDotRef.current.visible = false;
      const worldNormal = smoothNormal(result.mesh, result.position, result.faceNormal, REGION_CIRCLE_RADIUS_M);
      selectionLayerRef.current?.setRegionHit(result.position, worldNormal);
      onHitSelected?.({ kind: 'region', position: result.position, normal: worldNormal });
      // Fly close to the surface only when the point is outside the current view frustum.
      const cam = cameraRef.current;
      if (cam) {
        const frustum = new Frustum();
        frustum.setFromProjectionMatrix(
          new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
        );
        if (!frustum.containsPoint(result.position)) {
          this.flyTo(result.position, worldNormal);
        }
      }
    },

    resetRoll() {
      const cam = cameraRef.current;
      if (!cam) return;
      const normal = groundPlane
        ? new Vector3(...groundPlane).normalize()
        : new Vector3(0, 1, 0);
      const forward = new Vector3();
      cam.getWorldDirection(forward);
      const m = new Matrix4();
      m.lookAt(cam.position, cam.position.clone().add(forward), normal);
      cam.quaternion.setFromRotationMatrix(m);
    },

    flyToExactPose(position: Vector3, target: Vector3) {
      if (!cameraRef.current) return;
      flyStateRef.current = {
        cameraPos: position.clone(),
        lookAt: target.clone(),
      };
    },

    getCurrentCameraPose() {
      const cam = cameraRef.current;
      if (!cam) return null;
      const forward = new Vector3();
      cam.getWorldDirection(forward);
      const target = cam.position.clone().add(forward);
      return {
        position: [cam.position.x, cam.position.y, cam.position.z] as [number, number, number],
        target: [target.x, target.y, target.z] as [number, number, number],
      };
    },
  }));

  useEffect(() => {
    elementsRef.current = elements;
    semanticLayerRef.current?.update(elements);
  }, [elements]);

  useEffect(() => {
    ndtMeasurementsRef.current = ndtMeasurements;
    ndtLayerRef.current?.update(ndtMeasurements);
    // Sync per-campaign visibility after a data change (e.g. initial load after store init).
    ndtLayerRef.current?.syncCampaignVisibility(
      (id) => useLayerVisibilityStore.getState().visibility[id]?.['NDT_MEASUREMENTS'] === true,
    );
  }, [ndtMeasurements]);

  useEffect(() => {
    defectsRef.current = defects;
    defectLayerRef.current?.update(defects);
  }, [defects]);

  useEffect(() => {
    droneImagesRef.current = droneImages;
    imageLayerRef.current?.update(droneImages);
  }, [droneImages]);

  useEffect(() => {
    if (!groundPlane) return;
    const cam = cameraRef.current;
    if (!cam) return;
    cam.up.set(groundPlane[0], groundPlane[1], groundPlane[2]).normalize();
    // Re-orient if fit-to-scene has run but the user hasn't navigated away yet.
    // Prefer the custom initial target over the bounding-box centre so that a
    // saved pose is preserved when the ground plane is applied after load.
    const lookAtTarget = initialTargetRef.current ?? sceneCenterRef.current;
    if (cameraFittedRef.current && !userHasInteractedRef.current && lookAtTarget) {
      cam.lookAt(lookAtTarget);
    }
  }, [groundPlane]);

  const { percent, parsing, loadingFromCache, allDone } = progressState;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        data-testid="ply-viewer-container"
      />
      {!allDone && !rendererCrashed && (
        <div
          className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 text-white backdrop-blur-sm"
          data-testid="ply-viewer-loading"
        >
          <Loader role="status" size={16} />
          {loadingFromCache ? (
            <span className="text-xs text-white/80">Loading from cache…</span>
          ) : parsing ? (
            <span className="text-xs text-white/80">Parsing model…</span>
          ) : percent !== null ? (
            <>
              <div className="w-24 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-1 rounded-full bg-white transition-all duration-200"
                  style={{ width: `${percent}%` }}
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <span className="text-xs text-white/80">{percent}%</span>
            </>
          ) : (
            <span className="text-xs text-white/80">Downloading…</span>
          )}
        </div>
      )}
      {rendererCrashed && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center text-white"
          data-testid="ply-viewer-crashed"
        >
          <div className="max-w-sm">
            <p className="mb-1 font-medium">3D renderer crashed</p>
            <p className="text-sm text-white/70">
              The GPU likely ran out of memory rendering the visible layers. Hide some
              layers or reload the page.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
