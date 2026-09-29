import { Cognite3DViewer, TreeIndexNodeCollection } from '@cognite/reveal';
import type { Cognite3DViewerOptions, NodeAppearance, NodeCollection } from '@cognite/reveal';
import type { CogniteClient } from '@cognite/sdk';
import { Color } from 'three';
import type { Box3, Object3D, PerspectiveCamera } from 'three';

import type { ColorMode } from '../colorModeStore';

import type { CampaignCadModel } from './CampaignCadModelService';
import { ExternalCameraManager } from './ExternalCameraManager';

/** Background of the viewer canvas — unchanged from the previous three.js viewer. */
export const VIEWER_BACKGROUND = 0x1a1a2e;
/** Flat mesh colour the previous viewer used when a mesh had no camera colours. */
export const FLAT_MESH_COLOUR = 0x88aaff;

/** A campaign mesh rendered by the engine (a CDF CAD model in Reveal). */
export interface CadModelHandle {
  readonly boundingBox: Box3;
  setVisible(visible: boolean): void;
  setColourMode(mode: ColorMode): Promise<void>;
}

/**
 * What the 3D viewer needs from its rendering engine. The viewer owns the camera, the
 * scene graph of overlay layers (elements, NDT, images, tasks, defects, selection, PCDs)
 * and all input handling; the engine renders that graph together with the CAD models.
 */
export interface ViewerEngine {
  /** Element that receives pointer events (the canvas). */
  readonly domElement: HTMLElement;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number): void;
  /** Called once per animation frame after the camera and overlays were updated. */
  render(root: Object3D, camera: PerspectiveCamera): void;
  addCadModel(model: CampaignCadModel): Promise<CadModelHandle>;
  dispose(): void;
}

export type ViewerEngineOptions = {
  container: HTMLElement;
  camera: PerspectiveCamera;
  sdk: CogniteClient;
  /** Reveal sector-loading progress. */
  onLoading?: (itemsLoaded: number, itemsRequested: number) => void;
};

// ---- Narrow views of Reveal, so the engine can be tested without WebGL ----

export interface RevealModelLike {
  visible: boolean;
  getModelBoundingBox(): Box3;
  setDefaultNodeAppearance(appearance: NodeAppearance): void;
  assignStyledNodeCollection(collection: NodeCollection, appearance: NodeAppearance): void;
  removeAllStyledNodeCollections(): void;
}

export interface RevealViewerLike {
  readonly canvas: HTMLCanvasElement;
  addObject3D(object: Object3D): void;
  removeObject3D(object: Object3D): void;
  requestRedraw(): void;
  setBackgroundColor(background: { color?: Color; alpha?: number }): void;
  addCadModel(options: { modelId: number; revisionId: number }): Promise<RevealModelLike>;
  dispose(): void;
}

type CadNode = { name: string; treeIndex: number };

export type RevealEngineDeps = {
  createViewer: (options: Cognite3DViewerOptions) => RevealViewerLike;
  listNodes: (modelId: number, revisionId: number) => Promise<CadNode[]>;
};

function defaultDeps(sdk: CogniteClient): RevealEngineDeps {
  return {
    createViewer: (options) => new Cognite3DViewer(options),
    listNodes: async (modelId, revisionId) => {
      const nodes = await sdk.revisions3D
        .list3DNodes(modelId, revisionId, { limit: 1000 })
        .autoPagingToArray({ limit: Infinity });
      return nodes.map((n) => ({ name: n.name, treeIndex: n.treeIndex }));
    },
  };
}

export function createRevealEngine(
  { container, camera, sdk, onLoading }: ViewerEngineOptions,
  overrides?: Partial<RevealEngineDeps>,
): ViewerEngine {
  const { createViewer, listNodes } = { ...defaultDeps(sdk), ...overrides };
  const viewer = createViewer({
    sdk,
    domElement: container,
    cameraManager: new ExternalCameraManager(camera),
    logMetrics: false,
    loadingIndicatorStyle: { placement: 'bottomRight', opacity: 0 },
    onLoading,
  });
  viewer.setBackgroundColor({ color: new Color(VIEWER_BACKGROUND), alpha: 1 });
  let root: Object3D | null = null;

  return {
    domElement: viewer.canvas,
    setPixelRatio: () => {},
    setSize: () => {},
    render(nextRoot) {
      if (root !== nextRoot) {
        if (root) viewer.removeObject3D(root);
        viewer.addObject3D(nextRoot);
        root = nextRoot;
      }
      viewer.requestRedraw();
    },
    async addCadModel(cad) {
      const model = await viewer.addCadModel({ modelId: cad.modelId, revisionId: cad.revisionId });
      return createCadModelHandle(model, cad, viewer, listNodes);
    },
    dispose() {
      viewer.dispose();
    },
  };
}

function createCadModelHandle(
  model: RevealModelLike,
  cad: CampaignCadModel,
  viewer: RevealViewerLike,
  listNodes: RevealEngineDeps['listNodes'],
): CadModelHandle {
  let segmentCollections: { collection: TreeIndexNodeCollection; colour: Color }[] | null = null;

  const loadSegmentCollections = async () => {
    if (segmentCollections) return segmentCollections;
    const byName = new Map<string, number[]>();
    for (const node of await listNodes(cad.modelId, cad.revisionId)) {
      if (!(node.name in cad.palette)) continue;
      byName.set(node.name, [...(byName.get(node.name) ?? []), node.treeIndex]);
    }
    // One collection per distinct colour (segments are split per texture chunk).
    const byColour = new Map<number, number[]>();
    for (const [name, indices] of byName) {
      const hex = new Color(...cad.palette[name].map((c) => c / 255) as [number, number, number]).getHex();
      byColour.set(hex, [...(byColour.get(hex) ?? []), ...indices]);
    }
    segmentCollections = [...byColour].map(([hex, indices]) => ({
      collection: new TreeIndexNodeCollection(indices),
      colour: new Color(hex),
    }));
    return segmentCollections;
  };

  return {
    boundingBox: model.getModelBoundingBox(),
    setVisible(visible) {
      model.visible = visible;
      viewer.requestRedraw();
    },
    async setColourMode(mode) {
      model.removeAllStyledNodeCollections();
      if (mode === 'colorization') {
        // Camera RGB lives in the texture; without one the old viewer rendered a flat colour.
        model.setDefaultNodeAppearance(cad.hasTexture ? {} : { color: new Color(FLAT_MESH_COLOUR) });
      } else {
        model.setDefaultNodeAppearance({});
        // Untextured models carry segment colours as their material; textured ones need styling.
        if (cad.hasTexture) {
          for (const { collection, colour } of await loadSegmentCollections()) {
            model.assignStyledNodeCollection(collection, { color: colour });
          }
        }
      }
      viewer.requestRedraw();
    },
  };
}
