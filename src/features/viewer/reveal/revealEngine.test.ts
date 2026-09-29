import type { CogniteClient } from '@cognite/sdk';
import type { Color} from 'three';
import { Box3, Group, PerspectiveCamera, Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignCadModel } from './CampaignCadModelService';
import { axisViewConfig, createRevealEngine, FLAT_MESH_COLOUR, VIEWER_BACKGROUND } from './revealEngine';
import type { RevealModelLike, RevealViewerLike } from './revealEngine';

describe(createRevealEngine.name, () => {
  let viewer: RevealViewerLike;
  let model: RevealModelLike;
  let createViewer: ReturnType<typeof vi.fn>;
  let listNodes: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    model = {
      visible: true,
      getModelBoundingBox: vi.fn(() => new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1))),
      setDefaultNodeAppearance: vi.fn(),
      assignStyledNodeCollection: vi.fn(),
      removeAllStyledNodeCollections: vi.fn(),
    };
    viewer = {
      canvas: document.createElement('canvas'),
      addObject3D: vi.fn(),
      removeObject3D: vi.fn(),
      requestRedraw: vi.fn(),
      setBackgroundColor: vi.fn(),
      addCadModel: vi.fn(() => Promise.resolve(model)),
      dispose: vi.fn(),
    };
    createViewer = vi.fn(() => viewer);
    listNodes = vi.fn(() =>
      Promise.resolve([
        { name: 'seg_ff0000_c0', treeIndex: 1 },
        { name: 'seg_ff0000_c1', treeIndex: 2 },
        { name: 'seg_00ff00_c0', treeIndex: 3 },
      ]),
    );
  });

  function makeEngine() {
    return createRevealEngine(
      { container: document.createElement('div'), camera: new PerspectiveCamera(), sdk: {} as CogniteClient },
      { createViewer, listNodes },
    );
  }

  it('should create the viewer with metrics off and our own camera manager', () => {
    const camera = new PerspectiveCamera();

    createRevealEngine(
      { container: document.createElement('div'), camera, sdk: {} as CogniteClient },
      { createViewer, listNodes },
    );

    const options = createViewer.mock.calls[0][0];
    expect(options.logMetrics).toBe(false);
    expect(options.cameraManager.getCamera()).toBe(camera);
    expect(options.loadingIndicatorStyle.opacity).toBe(0);
  });

  it('should set the old viewer background colour', () => {
    makeEngine();

    const { color } = vi.mocked(viewer.setBackgroundColor).mock.calls[0][0];
    expect(color?.getHex()).toBe(VIEWER_BACKGROUND);
  });

  it('should attach the axis view tool to the created viewer', () => {
    const attachAxisView = vi.fn();

    createRevealEngine(
      { container: document.createElement('div'), camera: new PerspectiveCamera(), sdk: {} as CogniteClient },
      { createViewer, listNodes, attachAxisView },
    );

    expect(attachAxisView).toHaveBeenCalledWith(viewer);
  });

  it('should add the scene root once and request a redraw every render', () => {
    const engine = makeEngine();
    const root = new Group();

    engine.render(root, new PerspectiveCamera());
    engine.render(root, new PerspectiveCamera());

    expect(viewer.addObject3D).toHaveBeenCalledTimes(1);
    expect(viewer.requestRedraw).toHaveBeenCalledTimes(2);
  });

  it('should expose the viewer canvas for pointer events', () => {
    expect(makeEngine().domElement).toBe(viewer.canvas);
  });

  it('should add CAD models by classic model and revision id', async () => {
    const handle = await makeEngine().addCadModel(cadModel({ hasTexture: false }));

    expect(viewer.addCadModel).toHaveBeenCalledWith({ modelId: 5, revisionId: 6 });
    expect(handle.boundingBox.max.toArray()).toEqual([1, 1, 1]);
  });

  it('should toggle model visibility and redraw', async () => {
    const handle = await makeEngine().addCadModel(cadModel({ hasTexture: false }));

    handle.setVisible(false);

    expect(model.visible).toBe(false);
    expect(viewer.requestRedraw).toHaveBeenCalled();
  });

  it('should render an untextured model flat in colorization mode and natively in defects mode', async () => {
    const handle = await makeEngine().addCadModel(cadModel({ hasTexture: false }));

    await handle.setColourMode('colorization');
    const flat = vi.mocked(model.setDefaultNodeAppearance).mock.lastCall?.[0];
    expect((flat?.color as Color).getHex()).toBe(FLAT_MESH_COLOUR);

    await handle.setColourMode('defects');
    expect(vi.mocked(model.setDefaultNodeAppearance).mock.lastCall?.[0]).toEqual({});
    expect(listNodes).not.toHaveBeenCalled();
  });

  it('should show the texture in colorization mode for textured models', async () => {
    const handle = await makeEngine().addCadModel(cadModel({ hasTexture: true }));

    await handle.setColourMode('colorization');

    expect(vi.mocked(model.setDefaultNodeAppearance).mock.lastCall?.[0]).toEqual({});
    expect(model.removeAllStyledNodeCollections).toHaveBeenCalled();
  });

  it('should style segment nodes with their palette colour in defects mode for textured models', async () => {
    const handle = await makeEngine().addCadModel(cadModel({ hasTexture: true }));

    await handle.setColourMode('defects');

    expect(listNodes).toHaveBeenCalledWith(5, 6);
    const styled = vi.mocked(model.assignStyledNodeCollection).mock.calls.map(([collection, appearance]) => ({
      indices: [...collection.getIndexSet().toIndexArray()].sort(),
      colour: (appearance.color as Color).getHex(),
    }));
    expect(styled).toEqual(
      expect.arrayContaining([
        { indices: [1, 2], colour: 0xff0000 },
        { indices: [3], colour: 0x00ff00 },
      ]),
    );
  });

  it('should dispose the viewer', () => {
    makeEngine().dispose();

    expect(viewer.dispose).toHaveBeenCalled();
  });
});

describe(axisViewConfig.name, () => {
  // The scene root is added in the plan frame (task position3d/normalVector use the same
  // x/y/z), so the gizmo faces must be labelled by axis, not by Front/Back/Left/Right.
  it('should label all six faces with their signed plan axis', () => {
    const faces = axisViewConfig().faces;

    expect(faces?.xPositiveFace?.label).toBe('+X');
    expect(faces?.xNegativeFace?.label).toBe('-X');
    expect(faces?.yPositiveFace?.label).toBe('+Y');
    expect(faces?.yNegativeFace?.label).toBe('-Y');
    expect(faces?.zPositiveFace?.label).toBe('+Z');
    expect(faces?.zNegativeFace?.label).toBe('-Z');
  });

  it('should colour both faces of each axis alike, with distinct colours per axis', () => {
    const faces = axisViewConfig().faces;

    const x = faces?.xPositiveFace?.faceColor?.getHex();
    const y = faces?.yPositiveFace?.faceColor?.getHex();
    const z = faces?.zPositiveFace?.faceColor?.getHex();
    expect(faces?.xNegativeFace?.faceColor?.getHex()).toBe(x);
    expect(faces?.yNegativeFace?.faceColor?.getHex()).toBe(y);
    expect(faces?.zNegativeFace?.faceColor?.getHex()).toBe(z);
    expect(new Set([x, y, z]).size).toBe(3);
  });

  it('should use the conventional axis colours: x red, y green, z blue', () => {
    const faces = axisViewConfig().faces;

    const x = faces?.xPositiveFace?.faceColor;
    const y = faces?.yPositiveFace?.faceColor;
    const z = faces?.zPositiveFace?.faceColor;
    expect(x && x.r > x.g && x.r > x.b).toBe(true);
    expect(y && y.g > y.r && y.g > y.b).toBe(true);
    expect(z && z.b > z.r && z.b > z.g).toBe(true);
  });

  it('should use a legible white font on every face', () => {
    const faces = axisViewConfig().faces ?? {};

    const fontColours = Object.values(faces).map((face) => face?.fontColor?.getHex());
    expect(fontColours).toHaveLength(6);
    expect(fontColours).toEqual([0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff]);
  });

  it('should keep the default corner placement and a legible size', () => {
    const config = axisViewConfig();

    expect(config.position).toBeUndefined();
    expect(config.size).toBe(128);
  });
});

function cadModel(overrides: Partial<CampaignCadModel>): CampaignCadModel {
  return {
    key: 'result-1/f1-cad-model',
    campaignExternalId: 'result-1',
    sourceFileId: 11,
    modelId: 5,
    revisionId: 6,
    status: 'Done',
    collisionProxyFileId: 7,
    hasTexture: false,
    palette: { seg_ff0000_c0: [255, 0, 0], seg_ff0000_c1: [255, 0, 0], seg_00ff00_c0: [0, 255, 0] },
    ...overrides,
  };
}
