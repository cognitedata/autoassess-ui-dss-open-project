import type { CogniteClient } from '@cognite/sdk';
import type { Color} from 'three';
import { Box3, Group, PerspectiveCamera, Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignCadModel } from './CampaignCadModelService';
import { createRevealEngine, FLAT_MESH_COLOUR, VIEWER_BACKGROUND } from './revealEngine';
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

function cadModel(overrides: Partial<CampaignCadModel>): CampaignCadModel {
  return {
    campaignExternalId: 'result-1',
    modelId: 5,
    revisionId: 6,
    status: 'Done',
    collisionProxyFileId: 7,
    hasTexture: false,
    palette: { seg_ff0000_c0: [255, 0, 0], seg_ff0000_c1: [255, 0, 0], seg_00ff00_c0: [0, 255, 0] },
    ...overrides,
  };
}
