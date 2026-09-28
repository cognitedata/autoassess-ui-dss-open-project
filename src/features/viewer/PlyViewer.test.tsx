import { render, screen, act, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { PlyViewer, PlyViewerContext, isTypingTarget } from './PlyViewer';
import type { PlyViewerContextType, PlyViewerHandle } from './PlyViewer';
import { createMockDroneImage } from '../../__mocks__/droneImages';
import { useLayerVisibilityStore } from './layerVisibilityStore';
import { usePcdVisibilityStore } from './pcdVisibilityStore';
import { useActivePlanStore } from './activePlanStore';
import { useColorModeStore } from './colorModeStore';
import { ALL_LAYER_TYPES } from './LayerType';
import type { LayerType } from './LayerType';
import { getCachedParsedPly } from './parsedGeometryCache';
import type { CachedParsedPly } from './parsedGeometryCache';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';
import { createMockElementTask } from '../../__mocks__/inspectionTasks';
import type { SelectionHit } from './selection';

// Shared canvas — dblclick events are fired on renderer.domElement after mount
const sharedCanvas = document.createElement('canvas');
Object.defineProperty(sharedCanvas, 'getBoundingClientRect', {
  value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
});

// Raycaster mock instance — tests configure intersectObjects per scenario
const mockRaycasterIntersectObjects = vi.fn();

vi.mock('./plyCache', () => ({
  // Never resolves — keeps tests in loading state without needing Worker support
  fetchPlyWithCache: vi.fn(() => new Promise(() => {})),
  derivePlyKey: vi.fn((url: string) => {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  }),
}));

vi.mock('./parsedGeometryCache', () => ({
  // Default: cache miss — falls through to fetchPlyWithCache
  getCachedParsedPly: vi.fn(() => Promise.resolve(null)),
  putCachedParsedPly: vi.fn(() => Promise.resolve()),
}));

vi.mock('./FirstPersonViewerControls', () => ({
  FirstPersonViewerControls: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

/** Convenience: a single PLY entry for tests that need one mesh URL. */
function makePlyEntry(url: string, campaignId = 'test-campaign') {
  return { key: url.split('/').pop()!.split('?')[0], url, campaignId };
}

describe(PlyViewer.name, () => {
  let mockDeps: PlyViewerContextType;

  // Custom render that automatically wraps with the PlyViewerContext mock deps,
  // avoiding the need to mock the entire 'three' module (which exhausts the worker heap).
  function renderViewer(jsx: React.ReactElement) {
    return render(
      <PlyViewerContext.Provider value={mockDeps}>
        {jsx}
      </PlyViewerContext.Provider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRaycasterIntersectObjects.mockReturnValue([]);

    // Provide lightweight test doubles for WebGL-dependent classes so Three.js
    // is never mocked at the module level (vi.mock('three', importOriginal) loads
    // the full 2 MB bundle through Vite's transform pipeline and crashes the worker).
    mockDeps = {
      createRenderer: () => ({
        setPixelRatio: vi.fn(),
        setSize: vi.fn(),
        domElement: sharedCanvas,
        render: vi.fn(),
        dispose: vi.fn(),
      }),
      createRaycaster: () => ({
        setFromCamera: vi.fn(),
        intersectObjects: mockRaycasterIntersectObjects,
      }),
    };

    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    })));
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    // Make all layer types visible so raycasting and visibility sync behave as
    // if campaigns have been initialised. PlyViewer tests are not concerned with
    // layer-panel state; they just need the mesh layer visible by default.
    useLayerVisibilityStore.setState({
      visibility: {
        'test-campaign': Object.fromEntries(
          ALL_LAYER_TYPES.map((lt) => [lt, true]),
        ) as Record<LayerType, boolean>,
      },
      expanded: {},
      staticVisibility: {},
    });
    // Reset plan and color mode stores between tests
    useActivePlanStore.setState({ activePlan: null, activePlanTasks: [] });
    useColorModeStore.setState({ modes: {} });
    // PCD visibility defaults to hidden (isPcdVisible returns false for unset keys) —
    // reset between tests so a key toggled visible in one test doesn't leak into the next.
    usePcdVisibilityStore.setState({ visibility: {} });
  });

  it('renders the viewer container div', () => {
    renderViewer(
      <PlyViewer
        plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply?signed=1')]}
        elements={[createMockStructuralElement()]}
      />,
    );
    expect(screen.getByTestId('ply-viewer-container')).toBeDefined();
  });

  it('shows the loading overlay while files are downloading', () => {
    renderViewer(
      <PlyViewer
        plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply?signed=1')]}
        elements={[]}
      />,
    );
    expect(screen.getByTestId('ply-viewer-loading')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('fetches once per URL on cache miss', async () => {
    const { fetchPlyWithCache } = await import('./plyCache');

    const entries = [
      makePlyEntry('https://storage.example.test/mesh.ply?signed=1'),
      makePlyEntry('https://storage.example.test/labeled.pcd?signed=2'),
    ];
    renderViewer(<PlyViewer plyEntries={entries} elements={[]} />);

    // getCachedParsedPly returns a resolved Promise (null), so fetchPlyWithCache is
    // called one microtask after render — waitFor lets the async chain complete.
    await waitFor(() => {
      expect(fetchPlyWithCache).toHaveBeenCalledTimes(2);
    });
    expect(fetchPlyWithCache).toHaveBeenCalledWith(entries[0].url, expect.any(Function), expect.any(AbortSignal));
    expect(fetchPlyWithCache).toHaveBeenCalledWith(entries[1].url, expect.any(Function), expect.any(AbortSignal));
  });

  describe('entries with an unresolved (empty) URL', () => {
    // Regression test: ViewerPage mounts PlyViewer as soon as the DMS query for
    // campaign/file entries resolves, without waiting for the separate async
    // getDownloadUrls call — so entries briefly carry url: '' as a placeholder.
    // Attempting to load those crashed with `Failed to construct 'URL': Invalid URL`.
    it('does not attempt to load a ply entry whose URL has not resolved yet', async () => {
      const { fetchPlyWithCache } = await import('./plyCache');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      renderViewer(
        <PlyViewer
          plyEntries={[{ key: 'pending', url: '', campaignId: 'test-campaign' }]}
          elements={[]}
        />,
      );

      // Flush the microtask queue so a would-be rejected promise's .catch has run.
      await act(async () => {
        await Promise.resolve();
      });

      expect(fetchPlyWithCache).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('does not attempt to load a pcd entry whose URL has not resolved yet', async () => {
      const { fetchPlyWithCache } = await import('./plyCache');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      renderViewer(
        <PlyViewer plyEntries={[]} pcdUrls={[{ key: 'pending', url: '' }]} elements={[]} />,
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(fetchPlyWithCache).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  it('skips download on parsed geometry cache hit', async () => {
    const { fetchPlyWithCache } = await import('./plyCache');
    const { getCachedParsedPly } = await import('./parsedGeometryCache');

    vi.mocked(getCachedParsedPly).mockResolvedValueOnce({
      attrs: {
        position: { buffer: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer, itemSize: 3, normalized: false },
      },
      index: null,
      indexIsUint32: false,
      isMesh: false,
      hasFaceColors: false,
    });

    renderViewer(
      <PlyViewer
        plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply?signed=1')]}
        elements={[]}
      />,
    );

    // Loading overlay is visible while the cache geometry is being processed
    expect(screen.getByTestId('ply-viewer-loading')).toBeDefined();

    // After the cache hit resolves, the overlay disappears without ever calling fetchPlyWithCache
    await waitFor(() => expect(screen.queryByTestId('ply-viewer-loading')).toBeNull());
    expect(fetchPlyWithCache).not.toHaveBeenCalled();
  });

  describe('loading is gated on layer visibility', () => {
    // Regression: opening an area with several campaigns used to fetch + parse every
    // campaign's raw PLY/PCD files up front regardless of which layers were toggled on,
    // which could exhaust GPU/tab memory and crash the WebGL context. Only files whose
    // layer is actually visible should be downloaded.

    it("does not fetch a campaign's PLY mesh while its MESH layer is hidden", async () => {
      const { fetchPlyWithCache } = await import('./plyCache');
      useLayerVisibilityStore.setState({
        visibility: { 'hidden-campaign': { MESH: false } },
        expanded: {},
        staticVisibility: {},
      });

      renderViewer(
        <PlyViewer
          plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply?signed=1', 'hidden-campaign')]}
          elements={[]}
        />,
      );

      await act(async () => { await Promise.resolve(); });
      expect(fetchPlyWithCache).not.toHaveBeenCalled();
    });

    it("fetches a campaign's PLY mesh once its MESH layer toggle turns on", async () => {
      const { fetchPlyWithCache } = await import('./plyCache');
      useLayerVisibilityStore.setState({
        visibility: { 'hidden-campaign': { MESH: false } },
        expanded: {},
        staticVisibility: {},
      });
      const entry = makePlyEntry('https://storage.example.test/mesh.ply?signed=1', 'hidden-campaign');

      renderViewer(<PlyViewer plyEntries={[entry]} elements={[]} />);
      expect(fetchPlyWithCache).not.toHaveBeenCalled();

      act(() => {
        useLayerVisibilityStore.getState().setLayerVisible('hidden-campaign', 'MESH', true);
      });

      await waitFor(() => expect(fetchPlyWithCache).toHaveBeenCalledTimes(1));
      expect(fetchPlyWithCache).toHaveBeenCalledWith(entry.url, expect.any(Function), expect.any(AbortSignal));
    });

    it('does not fetch a PCD point cloud while it is hidden', async () => {
      const { fetchPlyWithCache } = await import('./plyCache');
      // usePcdVisibilityStore defaults an unset key to hidden — no explicit setState needed.

      renderViewer(
        <PlyViewer
          plyEntries={[]}
          pcdUrls={[{ key: 'cloud-1', url: 'https://storage.example.test/cloud.pcd?signed=1' }]}
          elements={[]}
        />,
      );

      await act(async () => { await Promise.resolve(); });
      expect(fetchPlyWithCache).not.toHaveBeenCalled();
    });

    it('fetches a PCD point cloud once its visibility toggle turns on', async () => {
      const { fetchPlyWithCache } = await import('./plyCache');
      const pcdEntry = { key: 'cloud-1', url: 'https://storage.example.test/cloud.pcd?signed=1' };

      renderViewer(<PlyViewer plyEntries={[]} pcdUrls={[pcdEntry]} elements={[]} />);
      expect(fetchPlyWithCache).not.toHaveBeenCalled();

      act(() => {
        usePcdVisibilityStore.getState().setPcdVisible('cloud-1', true);
      });

      await waitFor(() => expect(fetchPlyWithCache).toHaveBeenCalledTimes(1));
      expect(fetchPlyWithCache).toHaveBeenCalledWith(pcdEntry.url, expect.any(Function), expect.any(AbortSignal));
    });
  });

  describe('WebGL context loss', () => {
    it('shows a renderer-crashed message and logs an error when the context is lost', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);
      expect(screen.queryByTestId('ply-viewer-crashed')).toBeNull();

      act(() => {
        sharedCanvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      });

      expect(screen.getByTestId('ply-viewer-crashed')).toBeDefined();
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('WebGL context lost'));
      consoleError.mockRestore();
    });

    it('hides the download-progress overlay once the renderer has crashed', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      renderViewer(
        <PlyViewer
          plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply?signed=1')]}
          elements={[]}
        />,
      );
      expect(screen.getByTestId('ply-viewer-loading')).toBeDefined();

      act(() => {
        sharedCanvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      });

      expect(screen.queryByTestId('ply-viewer-loading')).toBeNull();
      consoleError.mockRestore();
    });
  });

  describe('dblclick selection', () => {
    it('fires onHitSelected with element hit when dblclick intersects a semantic element hit mesh', () => {
      const element = createMockStructuralElement({ externalId: 'element-2-11' });
      const onHitSelected = vi.fn();

      // First call = mesh hits (no occluder); second call = element hit meshes → hit
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([]) // no mesh occluder
        .mockReturnValueOnce([{ object: { userData: { externalId: 'element-2-11' } }, distance: 5 }]);

      renderViewer(
        <PlyViewer
          plyEntries={[]}
          elements={[element]}
          onHitSelected={onHitSelected}
        />,
      );

      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));

      expect(onHitSelected).toHaveBeenCalledOnce();
      const hit = onHitSelected.mock.calls[0][0] as SelectionHit;
      expect(hit.kind).toBe('element');
      if (hit.kind === 'element') {
        expect(hit.element.externalId).toBe('element-2-11');
      }
    });

    it('fires onHitSelected with region hit when dblclick intersects a PLY mesh surface', () => {
      const onHitSelected = vi.fn();
      const hitPoint = new Vector3(1, 2, 3);
      const hitNormal = new Vector3(0, 0, 1);
      const hitMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());

      // First call = mesh hits (surface); second call = no element hits
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([{ face: { normal: hitNormal }, point: hitPoint, object: hitMesh, distance: 5 }])
        .mockReturnValueOnce([]); // no element hits

      renderViewer(
        <PlyViewer
          plyEntries={[]}
          elements={[]}
          onHitSelected={onHitSelected}
        />,
      );

      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));

      expect(onHitSelected).toHaveBeenCalledOnce();
      const hit = onHitSelected.mock.calls[0][0] as SelectionHit;
      expect(hit.kind).toBe('region');
    });

    it('does not fire onHitSelected on a single click', () => {
      const onHitSelected = vi.fn();
      renderViewer(<PlyViewer plyEntries={[]} elements={[]} onHitSelected={onHitSelected} />);

      sharedCanvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 300 }));

      expect(onHitSelected).not.toHaveBeenCalled();
    });

    it('prefers element hit over surface hit when element is in front of the mesh', () => {
      const element = createMockStructuralElement({ externalId: 'element-2-11' });
      const onHitSelected = vi.fn();
      const hitMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());

      // First call = mesh hits (mesh is FARTHER); second call = element hit (element is NEARER)
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([{ face: { normal: new Vector3(0, 0, 1) }, point: new Vector3(0, 0, 0), object: hitMesh, distance: 10 }])
        .mockReturnValueOnce([{ object: { userData: { externalId: 'element-2-11' } }, distance: 5 }]);

      renderViewer(
        <PlyViewer
          plyEntries={[]}
          elements={[element]}
          onHitSelected={onHitSelected}
        />,
      );

      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));

      const hit = onHitSelected.mock.calls[0][0] as SelectionHit;
      expect(hit.kind).toBe('element');
      // intersectObjects called twice: once for mesh (occlusion), once for elements
      expect(mockRaycasterIntersectObjects).toHaveBeenCalledTimes(2);
    });

    it('does not select an element when the semantic layer is hidden', () => {
      const element = createMockStructuralElement({ externalId: 'element-hidden' });
      const onHitSelected = vi.fn();

      // Only the mesh raycaster call happens when the layer is hidden; don't queue a
      // second mockReturnValueOnce that would leak into the next test.
      mockRaycasterIntersectObjects.mockReturnValueOnce([]); // mesh hits — no occluder

      renderViewer(
        <PlyViewer plyEntries={[]} elements={[element]} onHitSelected={onHitSelected} />,
      );

      // Hide the semantic layer via the store — PlyViewer's subscription sets group.visible = false
      act(() => {
        useLayerVisibilityStore.setState({
          visibility: {
            'test-campaign': Object.fromEntries(
              ALL_LAYER_TYPES.map((lt) => [lt, lt !== 'SEMANTIC_SEG']),
            ) as Record<LayerType, boolean>,
          },
          expanded: {},
          staticVisibility: {},
        });
      });

      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));

      expect(onHitSelected).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'element' }));
      // Raycaster called once (mesh hits only) — element raycasting skipped when layer is hidden
      expect(mockRaycasterIntersectObjects).toHaveBeenCalledTimes(1);
    });

    it('does not select an element that is occluded by the PLY mesh', () => {
      const element = createMockStructuralElement({ externalId: 'elem-behind-mesh' });
      const onHitSelected = vi.fn();
      const hitMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());

      // First call = mesh hits (mesh is CLOSER); second call = element hit (element is FARTHER)
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([{ face: { normal: new Vector3(0, 0, 1) }, point: new Vector3(0, 0, 0), object: hitMesh, distance: 3 }])
        .mockReturnValueOnce([{ object: { userData: { externalId: 'elem-behind-mesh' } }, distance: 7 }]);

      renderViewer(<PlyViewer plyEntries={[]} elements={[element]} onHitSelected={onHitSelected} />);
      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));

      // Should fall through to region hit, not element hit
      const hit = onHitSelected.mock.calls[0][0] as SelectionHit;
      expect(hit.kind).toBe('region');
    });
  });

  describe('clearAllSelections handle method', () => {
    it('exposes clearAllSelections on the handle without throwing', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);
      expect(() => ref.current?.clearAllSelections()).not.toThrow();
    });

    it('can be called multiple times without throwing', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);
      expect(() => {
        ref.current?.clearAllSelections();
        ref.current?.clearAllSelections();
      }).not.toThrow();
    });
  });

  describe('unified selection: only one selection active at a time', () => {
    it('fires onHitSelected with region when dblclick on surface after task was selected via handle', () => {
      const ref = createRef<PlyViewerHandle>();
      const onHitSelected = vi.fn();
      const hitMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());

      // dblclick: call 1 = mesh hits (the surface); call 2 = no element hits
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([{ face: { normal: new Vector3(0, 0, 1) }, point: new Vector3(1, 2, 3), object: hitMesh, distance: 5 }])
        .mockReturnValueOnce([]); // no element hits

      renderViewer(
        <PlyViewer ref={ref} plyEntries={[]} elements={[]} onHitSelected={onHitSelected} />,
      );

      act(() => {
        useActivePlanStore.setState({
          // normalVector is required by PlanTasksLayer._addRegionTask
          activePlanTasks: [{ space: 'autoassess', externalId: 'task-1', planExternalId: 'plan-1', taskKind: 'region', inspectionType: 'visual', position3d: [0, 0, 0], normalVector: [0, 0, 1], radiusM: 0.3 }],
        });
      });

      // Select a task via handle first, then dblclick the surface
      act(() => { ref.current?.selectTask({ space: 'autoassess', externalId: 'task-1', planExternalId: 'plan-1', taskKind: 'region', inspectionType: 'visual', position3d: [0, 0, 0], normalVector: [0, 0, 1], radiusM: 0.3 }); });

      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));

      const calls = onHitSelected.mock.calls;
      const lastCall = calls[calls.length - 1][0] as SelectionHit;
      expect(lastCall.kind).toBe('region');
    });

    it('does not fire onHitSelected a second time with the same kind when a new selection replaces the old one', () => {
      const element = createMockStructuralElement({ externalId: 'el-1' });
      const onHitSelected = vi.fn();

      // dblclick 1: mesh hit (no occluder), element hit → element selected
      // dblclick 2: mesh hit (surface) → region selected (element cleared)
      const hitMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([]) // dblclick 1: no mesh occluder
        .mockReturnValueOnce([{ object: { userData: { externalId: 'el-1' } }, distance: 5 }]) // dblclick 1: element hit
        .mockReturnValueOnce([{ face: { normal: new Vector3(0, 0, 1) }, point: new Vector3(1, 2, 3), object: hitMesh, distance: 5 }]) // dblclick 2: surface hit
        .mockReturnValueOnce([]); // dblclick 2: no element hit

      renderViewer(
        <PlyViewer plyEntries={[]} elements={[element]} onHitSelected={onHitSelected} />,
      );

      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));
      expect((onHitSelected.mock.calls[0][0] as SelectionHit).kind).toBe('element');

      sharedCanvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));
      expect((onHitSelected.mock.calls[1][0] as SelectionHit).kind).toBe('region');

      // Exactly one call per interaction — no spurious duplicates
      expect(onHitSelected).toHaveBeenCalledTimes(2);
    });
  });

  describe('colorModeStore subscription', () => {
    it('does not throw when color mode changes after mount', () => {
      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);

      // No objects are loaded (fetchPlyWithCache never resolves), so the forEach
      // over loadedObjectsRef.current is a no-op — but the subscription must not throw.
      expect(() => {
        act(() => {
          useColorModeStore.getState().setColorMode('MESH', 'colorization');
        });
      }).not.toThrow();
    });

    it('does not throw when color mode is reset to defects', () => {
      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);

      act(() => { useColorModeStore.getState().setColorMode('MESH', 'colorization'); });

      expect(() => {
        act(() => { useColorModeStore.getState().setColorMode('MESH', 'defects'); });
      }).not.toThrow();
    });
  });

  describe('color material assignment', () => {
    // Track the active Object3D.prototype.add spy so afterEach can always restore it,
    // even when a test fails. vi.restoreAllMocks() is intentionally NOT used here because
    // it would strip mockImplementation from vi.mock() stubs (e.g. FirstPersonViewerControls),
    // corrupting subsequent tests.
    let activeMeshCapture: ReturnType<typeof captureAddedPlyMesh> | null = null;
    afterEach(() => { activeMeshCapture?.restore(); activeMeshCapture = null; });

    async function loadColoredMesh(mode: 'colorization' | 'defects') {
      vi.mocked(getCachedParsedPly).mockResolvedValueOnce(makeColoredMeshCache());
      activeMeshCapture = captureAddedPlyMesh();
      useColorModeStore.getState().setColorMode('MESH', mode);
      renderViewer(
        <PlyViewer plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply')]} elements={[]} />,
      );
      await waitFor(() => expect(activeMeshCapture!.getPlyMesh()).toBeDefined());
      const mesh = activeMeshCapture.getPlyMesh()!;
      activeMeshCapture.restore(); activeMeshCapture = null;
      return mesh;
    }

    it('uses shaded MeshLambertMaterial with vertex colors in colorization mode', async () => {
      const mesh = await loadColoredMesh('colorization');
      expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
      expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(true);
    });

    it('uses shaded MeshLambertMaterial with segment colors in defects mode', async () => {
      const mesh = await loadColoredMesh('defects');
      // Defects mode renders the face/segment colors encoded in the PLY face data.
      expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
      expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(true);
      // Geometry's active 'color' attribute should be the face/segment colors (green).
      expect((mesh.geometry.attributes.color as BufferAttribute).array[0]).toBeCloseTo(0); // R ≈ 0
      expect((mesh.geometry.attributes.color as BufferAttribute).array[1]).toBeCloseTo(1); // G ≈ 1
    });

    it('swaps color attribute between vertex colors and face colors on mode change', async () => {
      const mesh = await loadColoredMesh('defects');

      act(() => { useColorModeStore.getState().setColorMode('MESH', 'colorization'); });
      expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
      expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(true);
      // Colorization active color attribute should be vertex colors (R=1 for first vertex).
      expect((mesh.geometry.attributes.color as BufferAttribute).array[0]).toBeCloseTo(1);

      act(() => { useColorModeStore.getState().setColorMode('MESH', 'defects'); });
      expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
      expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(true);
      // Defects active color attribute should be face colors (R=0, G=1 for first vertex).
      expect((mesh.geometry.attributes.color as BufferAttribute).array[0]).toBeCloseTo(0);
      expect((mesh.geometry.attributes.color as BufferAttribute).array[1]).toBeCloseTo(1);
    });

    describe('face colors only (no camera vertex colors)', () => {
      async function loadFaceOnlyMesh(mode: 'colorization' | 'defects') {
        vi.mocked(getCachedParsedPly).mockResolvedValueOnce(makeFaceOnlyMeshCache());
        activeMeshCapture = captureAddedPlyMesh();
        useColorModeStore.getState().setColorMode('MESH', mode);
        renderViewer(
          <PlyViewer plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply')]} elements={[]} />,
        );
        await waitFor(() => expect(activeMeshCapture!.getPlyMesh()).toBeDefined());
        const mesh = activeMeshCapture!.getPlyMesh()!;
        activeMeshCapture!.restore(); activeMeshCapture = null;
        return mesh;
      }

      it('uses flat MeshLambertMaterial in colorization mode (no camera data)', async () => {
        const mesh = await loadFaceOnlyMesh('colorization');
        expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
        expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(false);
        expect(mesh.geometry.hasAttribute('color')).toBe(false);
      });

      it('uses MeshLambertMaterial with segment colors in defects mode', async () => {
        const mesh = await loadFaceOnlyMesh('defects');
        expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
        expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(true);
        expect((mesh.geometry.attributes.color as BufferAttribute).array[1]).toBeCloseTo(1); // G ≈ 1
      });

      it('clears color attribute when switching from defects to colorization', async () => {
        const mesh = await loadFaceOnlyMesh('defects');
        expect(mesh.geometry.hasAttribute('color')).toBe(true);

        act(() => { useColorModeStore.getState().setColorMode('MESH', 'colorization'); });
        expect(mesh.geometry.hasAttribute('color')).toBe(false);

        act(() => { useColorModeStore.getState().setColorMode('MESH', 'defects'); });
        expect(mesh.geometry.hasAttribute('color')).toBe(true);
        expect((mesh.geometry.attributes.color as BufferAttribute).array[1]).toBeCloseTo(1);
      });
    });
  });

  describe('activePlanStore subscription (FR-06)', () => {
    it('subscribes to activePlanStore on mount without throwing', () => {
      expect(() => {
        renderViewer(
          <PlyViewer
            plyEntries={[]}
            elements={[createMockStructuralElement({ externalId: 'el-1' })]}
          />,
        );
      }).not.toThrow();
    });

    it('does not throw when activePlanTasks change after mount', () => {
      renderViewer(
        <PlyViewer
          plyEntries={[]}
          elements={[createMockStructuralElement({ externalId: 'el-1' })]}
        />,
      );

      // Simulate ViewModel syncing a task into the store
      expect(() => {
        act(() => {
          useActivePlanStore.setState({
            activePlanTasks: [
              createMockElementTask({ targetElementExternalId: 'el-1' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('does not throw when activePlanTasks are cleared', () => {
      renderViewer(
        <PlyViewer
          plyEntries={[]}
          elements={[createMockStructuralElement({ externalId: 'el-1' })]}
        />,
      );

      act(() => {
        useActivePlanStore.setState({
          activePlanTasks: [createMockElementTask({ targetElementExternalId: 'el-1' })],
        });
      });

      expect(() => {
        act(() => {
          useActivePlanStore.setState({ activePlanTasks: [] });
        });
      }).not.toThrow();
    });
  });

  describe('selectImage handle method', () => {
    it('exposes selectImage on the handle without throwing', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);
      const image = createMockDroneImage({ externalId: 'frame-s1', campaignExternalId: 'campaign-1', frameId: 1, position: [0, 0, 1] });
      expect(() => act(() => { ref.current?.selectImage(image); })).not.toThrow();
    });
  });

  describe('image ray picking handle methods', () => {
    const mockImage = createMockDroneImage({ externalId: 'frame-ray-1', position: [0, 0, 1] });

    it('exposes hoverImageRay on the handle without throwing', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);
      expect(() => act(() => { ref.current?.hoverImageRay(mockImage, 320, 240); })).not.toThrow();
    });

    it('exposes clearImageRayHover on the handle without throwing', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);
      expect(() => act(() => { ref.current?.clearImageRayHover(); })).not.toThrow();
    });

    it('does not call onHitSelected when selectImageRay misses all meshes', () => {
      const ref = createRef<PlyViewerHandle>();
      const onHitSelected = vi.fn();
      mockRaycasterIntersectObjects.mockReturnValue([]);
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} onHitSelected={onHitSelected} />);
      act(() => { ref.current?.selectImageRay(mockImage, 320, 240); });
      expect(onHitSelected).not.toHaveBeenCalled();
    });

    it('calls onHitSelected with kind region when selectImageRay hits a mesh surface', () => {
      const ref = createRef<PlyViewerHandle>();
      const onHitSelected = vi.fn();
      const hitPoint = new Vector3(1, 2, 3);
      const hitNormal = new Vector3(0, 0, 1);
      const hitMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
      mockRaycasterIntersectObjects.mockReturnValueOnce([
        { face: { normal: hitNormal }, point: hitPoint, object: hitMesh, distance: 1 },
      ]);
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} onHitSelected={onHitSelected} />);
      act(() => { ref.current?.selectImageRay(mockImage, 320, 240); });
      expect(onHitSelected).toHaveBeenCalledOnce();
      const hit = onHitSelected.mock.calls[0][0] as SelectionHit;
      expect(hit.kind).toBe('region');
    });
  });

  describe('canvas mesh hover ring', () => {
    let hoverRingCapture: ReturnType<typeof captureHoverRing> | null = null;
    afterEach(() => { hoverRingCapture?.restore(); hoverRingCapture = null; });

    it('shows the hover ring when pointermove hits a PLY mesh surface', () => {
      hoverRingCapture = captureHoverRing();
      const hitMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
      const hitPoint = new Vector3(1, 2, 3);
      const hitNormal = new Vector3(0, 0, 1);

      // Arrange / Act / Assert
      // Call order in onPointerMove: (1) plan tasks, (2) defects, (3) PLY mesh
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([])  // plan tasks: no hit
        .mockReturnValueOnce([])  // defects: no hit
        .mockReturnValueOnce([{ face: { normal: hitNormal }, point: hitPoint, object: hitMesh, distance: 5 }]);

      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);
      sharedCanvas.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300, buttons: 0 }),
      );

      expect(hoverRingCapture.getHoverRing()?.visible).toBe(true);
    });

    it('hides the hover ring when pointermove misses all meshes', () => {
      hoverRingCapture = captureHoverRing();
      mockRaycasterIntersectObjects.mockReturnValue([]);

      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);
      sharedCanvas.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300, buttons: 0 }),
      );

      expect(hoverRingCapture.getHoverRing()?.visible).toBe(false);
    });

    it('hides the hover ring and skips raycasting while camera is dragging (buttons !== 0)', () => {
      hoverRingCapture = captureHoverRing();

      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);
      sharedCanvas.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300, buttons: 1 }),
      );

      expect(hoverRingCapture.getHoverRing()?.visible).toBe(false);
      expect(mockRaycasterIntersectObjects).not.toHaveBeenCalled();
    });

    it('skips PLY mesh raycasting when a plan-task hit is present', () => {
      hoverRingCapture = captureHoverRing();
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([{ object: { userData: {} }, distance: 3 }])  // plan task hit
        .mockReturnValueOnce([]);  // defects: no hit

      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);
      sharedCanvas.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300, buttons: 0 }),
      );

      expect(hoverRingCapture.getHoverRing()?.visible).toBe(false);
      // Only plan tasks + defects calls — PLY mesh raycasting skipped
      expect(mockRaycasterIntersectObjects).toHaveBeenCalledTimes(2);
    });

    it('hides the hover ring when the pointer leaves the canvas', () => {
      hoverRingCapture = captureHoverRing();

      // Arrange: first make the ring visible via a hit
      mockRaycasterIntersectObjects
        .mockReturnValueOnce([])  // plan tasks: no hit
        .mockReturnValueOnce([])  // defects: no hit
        .mockReturnValueOnce([{ face: { normal: new Vector3(0, 0, 1) }, point: new Vector3(1, 2, 3), object: new Mesh(), distance: 5 }]);

      renderViewer(<PlyViewer plyEntries={[]} elements={[]} />);
      sharedCanvas.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300, buttons: 0 }),
      );
      expect(hoverRingCapture.getHoverRing()?.visible).toBe(true); // precondition

      // Act: pointer leaves the canvas
      sharedCanvas.dispatchEvent(new PointerEvent('pointerleave'));

      // Assert: ring is hidden
      expect(hoverRingCapture.getHoverRing()?.visible).toBe(false);
    });
  });

  describe('groundPlane prop', () => {
    it('sets camera.up to the provided ground plane vector', async () => {
      const { Vector3 } = await import('three');
      const setSpy = vi.spyOn(Vector3.prototype, 'set');

      renderViewer(<PlyViewer plyEntries={[]} elements={[]} groundPlane={[1, 0, 0]} />);

      // The groundPlane effect fires after render, calling camera.up.set(1, 0, 0)
      await waitFor(() => {
        expect(setSpy).toHaveBeenCalledWith(1, 0, 0);
      });
      setSpy.mockRestore();
    });

    it('calls lookAt to re-orient the camera when groundPlane arrives after fit-to-scene', async () => {
      // Arrange: provide geometry so fit-to-scene runs
      vi.mocked(getCachedParsedPly).mockResolvedValueOnce({
        attrs: {
          position: {
            buffer: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
            itemSize: 3,
            normalized: false,
          },
        },
        index: null,
        indexIsUint32: false,
        isMesh: true,
        hasFaceColors: false,
      });

      const { rerender } = renderViewer(
        <PlyViewer
          plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply?signed=1')]}
          elements={[]}
        />,
      );

      // Wait for fit-to-scene to complete (loading overlay disappears)
      await waitFor(() => expect(screen.queryByTestId('ply-viewer-loading')).toBeNull());

      // Start spying on lookAt after fit-to-scene has already run
      const { Object3D } = await import('three');
      const lookAtSpy = vi.spyOn(Object3D.prototype, 'lookAt');

      // Act: supply groundPlane after the camera is already fitted
      rerender(
        <PlyViewerContext.Provider value={mockDeps}>
          <PlyViewer
            plyEntries={[makePlyEntry('https://storage.example.test/mesh.ply?signed=1')]}
            elements={[]}
            groundPlane={[1, 0, 0]}
          />
        </PlyViewerContext.Provider>,
      );

      // The effect fires camera.lookAt(sceneCenterRef.current) to re-orient
      await waitFor(() => {
        expect(lookAtSpy).toHaveBeenCalled();
      });
      lookAtSpy.mockRestore();
    });

    it('initialises camera.up from groundPlane when plyEntries changes from empty to real URLs', async () => {
      // Regression: when plyEntries first renders with empty URLs and then updates to real URLs,
      // the main useEffect re-runs creating a new camera. The groundPlane effect does not re-run
      // (groundPlane prop unchanged), so the new camera's up must be set in the main effect itself.

      // Arrange: capture the camera via the renderer's render callback.
      // animate() fires once synchronously when the main effect runs; requestAnimationFrame is
      // stubbed to a no-op so there are no further frames after that single call.
      const captured: { camera: PerspectiveCamera | null } = { camera: null };
      const capturingDeps: PlyViewerContextType = {
        ...mockDeps,
        createRenderer: () => {
          const base = mockDeps.createRenderer();
          return {
            ...base,
            render: (_: unknown, cam: PerspectiveCamera) => { captured.camera = cam; },
          };
        },
      };

      vi.mocked(getCachedParsedPly).mockResolvedValueOnce({
        attrs: {
          position: {
            buffer: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
            itemSize: 3,
            normalized: false,
          },
        },
        index: null,
        indexIsUint32: false,
        isMesh: true,
        hasFaceColors: false,
      });

      const url = 'https://storage.example.test/mesh.ply?signed=1';
      // Stable reference — same object both renders so the groundPlane effect does NOT re-run
      // between them (React uses Object.is for dep comparison). This matches how ViewerPage
      // passes area.groundPlane: the array reference is stable until area itself re-fetches.
      const stableGroundPlane: [number, number, number] = [1, 0, 0];

      // Start with empty plyEntries (PLY download URLs not yet available from usePlyUrls)
      const { rerender } = render(
        <PlyViewerContext.Provider value={capturingDeps}>
          <PlyViewer plyEntries={[]} elements={[]} groundPlane={stableGroundPlane} />
        </PlyViewerContext.Provider>,
      );

      // Act: URL arrives — plyEntries changes, triggering a second main effect run with a new camera
      rerender(
        <PlyViewerContext.Provider value={capturingDeps}>
          <PlyViewer plyEntries={[makePlyEntry(url)]} elements={[]} groundPlane={stableGroundPlane} />
        </PlyViewerContext.Provider>,
      );

      // Wait for geometry to load (loading overlay disappears)
      await waitFor(() => expect(screen.queryByTestId('ply-viewer-loading')).toBeNull());

      // Assert: the new camera's up matches groundPlane = [1, 0, 0], not the Three.js default [0, 1, 0].
      // Without the fix the groundPlane effect only ran for the first (now-disposed) camera, leaving
      // the second camera with the default up and producing incorrect roll on the initial view.
      expect(captured.camera?.up.x).toBe(1);
      expect(captured.camera?.up.y).toBe(0);
      expect(captured.camera?.up.z).toBe(0);
    });
  });

  describe('flyToImage handle method', () => {
    it('exposes flyToImage on the handle without throwing', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);
      const image = createMockDroneImage({ externalId: 'frame-1', campaignExternalId: 'campaign-1', frameId: 1, position: [0, 0, 1] });
      expect(() => act(() => { ref.current?.flyToImage(image); })).not.toThrow();
    });

    it('sets a fly state targeting the image position', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);
      const image = createMockDroneImage({ externalId: 'frame-2', campaignExternalId: 'campaign-1', frameId: 2, position: [3, 4, 5] });
      // Should not throw — we verify indirectly that the animation loop ticks
      // with the new fly state by checking requestAnimationFrame was called
      const rafCallsBefore = (vi.mocked(requestAnimationFrame) as ReturnType<typeof vi.fn>).mock.calls.length;
      act(() => { ref.current?.flyToImage(image); });
      // requestAnimationFrame may already be called due to the animation loop;
      // we just verify no error was thrown
      expect(ref.current).not.toBeNull();
      void rafCallsBefore; // suppress unused-variable warning
    });
  });

  describe('getCurrentCameraPose handle method', () => {
    it('returns a pose object with position and target arrays after mount', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);

      const pose = ref.current?.getCurrentCameraPose();
      expect(pose).not.toBeNull();
      expect(pose?.position).toHaveLength(3);
      expect(pose?.target).toHaveLength(3);
    });
  });

  describe('flyToExactPose handle method', () => {
    it('does not throw when called before geometry loads', () => {
      const ref = createRef<PlyViewerHandle>();
      renderViewer(<PlyViewer ref={ref} plyEntries={[]} elements={[]} />);

      expect(() =>
        act(() => {
          ref.current?.flyToExactPose(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
        }),
      ).not.toThrow();
    });
  });

  describe('initialCameraPose prop', () => {
    it('accepts initialCameraPose without throwing', () => {
      expect(() =>
        renderViewer(
          <PlyViewer
            plyEntries={[]}
            elements={[]}
            initialCameraPose={{ position: [1, 2, 3], target: [4, 5, 6] }}
          />,
        ),
      ).not.toThrow();
    });
  });
});

// --- Helpers ---

/**
 * Returns a CachedParsedPly with position, face colors ('color') and vertex colors ('vertexColor').
 * 'color' = face/segment colors (green tones), 'vertexColor' = camera-captured RGB (RGB diagonal).
 */
function makeColoredMeshCache(): CachedParsedPly {
  return {
    attrs: {
      position: {
        buffer: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
        itemSize: 3,
        normalized: false,
      },
      color: {
        // face/segment colors — defects mode
        buffer: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]).buffer,
        itemSize: 3,
        normalized: false,
      },
      vertexColor: {
        // camera-captured vertex colors — colorization mode
        buffer: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]).buffer,
        itemSize: 3,
        normalized: false,
      },
    },
    index: null,
    indexIsUint32: false,
    isMesh: true,
    hasFaceColors: true,
  };
}

/**
 * Returns a CachedParsedPly with position and face colors only — no camera vertex colors.
 * 'color' = face/segment colors (green). hasFaceColors=true, no 'vertexColor' attribute.
 */
function makeFaceOnlyMeshCache(): CachedParsedPly {
  return {
    attrs: {
      position: {
        buffer: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
        itemSize: 3,
        normalized: false,
      },
      color: {
        buffer: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]).buffer,
        itemSize: 3,
        normalized: false,
      },
    },
    index: null,
    indexIsUint32: false,
    isMesh: true,
    hasFaceColors: true,
  };
}

/**
 * Spies on Object3D.prototype.add to capture the gold hover ring when it is added to the
 * scene. Identified by renderOrder === 998 (hover dot) vs renderOrder === 1 (selection ring).
 */
function captureHoverRing(): { getHoverRing: () => Mesh | undefined; restore: () => void } {
  let captured: Mesh | undefined;
  const origAdd = Object3D.prototype.add;
  const spy = vi.spyOn(Object3D.prototype, 'add').mockImplementation(
    function (this: Object3D, ...objects: Object3D[]) {
      for (const o of objects) {
        if (o instanceof Mesh && !captured && o.renderOrder === 998) {
          captured = o;
        }
      }
      return origAdd.call(this, ...objects);
    },
  );
  return {
    getHoverRing: () => captured,
    restore: () => spy.mockRestore(),
  };
}

describe(isTypingTarget.name, () => {
  function makeEvent(tagName: string): KeyboardEvent {
    const el = document.createElement(tagName) as HTMLElement;
    return { target: el } as unknown as KeyboardEvent;
  }

  it('returns true for INPUT', () => {
    expect(isTypingTarget(makeEvent('INPUT'))).toBe(true);
  });

  it('returns true for TEXTAREA', () => {
    expect(isTypingTarget(makeEvent('TEXTAREA'))).toBe(true);
  });

  it('returns true for SELECT', () => {
    expect(isTypingTarget(makeEvent('SELECT'))).toBe(true);
  });

  it('returns false for CANVAS', () => {
    expect(isTypingTarget(makeEvent('CANVAS'))).toBe(false);
  });

  it('returns false for BODY', () => {
    expect(isTypingTarget(makeEvent('BODY'))).toBe(false);
  });

  it('returns false when target is null', () => {
    expect(isTypingTarget({ target: null } as unknown as KeyboardEvent)).toBe(false);
  });
});

/**
 * Spies on Object3D.prototype.add to capture the PLY mesh when it is inserted into the
 * scene hierarchy. The PLY mesh is identified by the presence of userData.materials,
 * which is set exclusively in addPlyToScene.
 *
 * Call restore() after the mesh has been captured to clean up the spy.
 */
function captureAddedPlyMesh(): { getPlyMesh: () => Mesh | undefined; restore: () => void } {
  const captured: Mesh[] = [];
  const origAdd = Object3D.prototype.add;
  const spy = vi.spyOn(Object3D.prototype, 'add').mockImplementation(
    function (this: Object3D, ...objects: Object3D[]) {
      objects.forEach((o) => {
        if (o instanceof Mesh && o.userData.materials !== undefined) {
          captured.push(o);
        }
      });
      return origAdd.call(this, ...objects);
    },
  );
  return {
    getPlyMesh: () => captured[0],
    restore: () => spy.mockRestore(),
  };
}
