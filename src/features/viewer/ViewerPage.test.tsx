import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';


import { createMockArea } from '../../__mocks__/areas';
import { createMockDroneImage } from '../../__mocks__/droneImages';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';
import { createMockVessel } from '../../__mocks__/vessels';

import type { PlyViewerProps } from './PlyViewer';
import type { SelectionHit } from './selection';
import type { ViewerViewModelContextType } from './useViewerViewModel';
import { ViewerViewModelContext } from './useViewerViewModel';
import { ViewerPage } from './ViewerPage';

vi.mock('./usePlyUrls', () => ({
  usePlyUrls: vi.fn(() => ({
    data: ['https://storage.example.test/mesh.ply?signed=1'],
    isLoading: false,
    error: null,
  })),
}));

// vi.mock: useCampaignCadModels runs a React Query hook against CDF; the page tests only
// need a finished CAD model for the mocked campaign so the viewer renders.
vi.mock('./reveal/useCampaignCadModels', () => ({
  useCampaignCadModels: vi.fn((campaigns: { externalId: string }[]) => ({
    data: campaigns.some((c) => c.externalId === 'test-campaign')
      ? { models: [makeDoneCadModel('test-campaign')], meshesWithoutModel: [] }
      : undefined,
    isSuccess: campaigns.length > 0,
    isLoading: false,
    error: null,
  })),
}));

function makeDoneCadModel(campaignExternalId: string, status = 'Done') {
  return {
    key: `${campaignExternalId}/f1-cad-model`,
    campaignExternalId,
    sourceFileId: 42,
    modelId: 1,
    revisionId: 2,
    status,
    collisionProxyFileId: 42,
    hasTexture: false,
    palette: {},
  };
}

vi.mock('./useLayerPanelViewModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useLayerPanelViewModel')>();
  return {
    ...actual,
    useLayerPanelViewModel: vi.fn(() => ({
      campaigns: [],
      allPcdFileIds: [],
      allPlyEntries: [{ key: '42', campaignId: 'test-campaign' }],
      staticLayers: [],
      isLoading: false,
      error: null,
      isEmpty: true,
      onToggleLayer: vi.fn(),
      onToggleStaticLayer: vi.fn(),
      onToggleCampaignExpanded: vi.fn(),
      onTogglePcdLayer: vi.fn(),
      onColorModeChange: vi.fn(),
    })),
  };
});

// vi.mock is necessary here because useInspectionPlansViewModel instantiates
// React Query hooks that require a QueryClient provider — mocking avoids that complexity
// in ViewerPage integration tests.
vi.mock('./useInspectionPlansViewModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useInspectionPlansViewModel')>();
  return {
    ...actual,
    useInspectionPlansViewModel: vi.fn(() => ({
      plans: [],
      isLoadingPlans: false,
      activePlan: null,
      tasks: [],
      isLoadingTasks: false,
      createPlan: vi.fn(),
      isCreatingPlan: false,
      selectPlan: vi.fn(),
      deactivatePlan: vi.fn(),
      togglePlanStatus: vi.fn(),
      isTogglingStatus: false,
      addTaskFromHit: vi.fn(),
      isAddingTask: false,
      removeTask: vi.fn(),
    })),
  };
});

vi.mock('./useNdtMeasurements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useNdtMeasurements')>();
  return {
    ...actual,
    useNdtMeasurements: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  };
});

vi.mock('./useDroneImages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useDroneImages')>();
  return {
    ...actual,
    useDroneImages: vi.fn(() => ({ data: [], isLoading: false, error: null })),
    useDroneImageDownloadUrl: vi.fn(() => ({ data: undefined, isLoading: false, error: null })),
  };
});

// vi.mock: the edit-campaign view model runs React Query hooks against CDF; the page tests
// only check that it reaches the right panel.
vi.mock('./campaigns/useEditCampaignViewModel', () => ({
  useEditCampaignViewModel: vi.fn(() => ({ isOpen: false, openEdit: vi.fn(), openCreate: vi.fn() })),
}));

vi.mock('./ViewerRightPanel', () => ({
  ViewerRightPanel: vi.fn(() => <div data-testid="viewer-right-panel" />),
}));

// Capture the onHitSelected prop so tests can trigger it
let capturedOnHitSelected: ((hit: SelectionHit | null) => void) | undefined;
let capturedInitialCameraPose: PlyViewerProps['initialCameraPose'];
let capturedOnCameraSettled: PlyViewerProps['onCameraSettled'];
// Capture handle calls so URL-param tests and ray-picking tests can assert on them
const mockFlyToImage = vi.fn();
const mockSelectImage = vi.fn();
const mockHoverImageRay = vi.fn();
const mockClearImageRayHover = vi.fn();
const mockSelectImageRay = vi.fn();

// PlyViewer uses WebGL — mock the whole module.
// In React 19, ref is a regular prop; we call it in useLayoutEffect so the
// callback ref in ViewerPage fires at the correct commit-phase timing.
vi.mock('./PlyViewer', async () => {
  const { useLayoutEffect } = await import('react');
  return {
    PlyViewer: vi.fn((props: PlyViewerProps & { ref?: unknown }) => {
      capturedOnHitSelected = props.onHitSelected;
      capturedInitialCameraPose = props.initialCameraPose;
      capturedOnCameraSettled = props.onCameraSettled;
      useLayoutEffect(() => {
        if (typeof props.ref === 'function') {
          const handle = {
            flyToImage: mockFlyToImage,
            selectImage: mockSelectImage,
            hoverImageRay: mockHoverImageRay,
            clearImageRayHover: mockClearImageRayHover,
            selectImageRay: mockSelectImageRay,
            flyTo: vi.fn(),
            flyToTask: vi.fn(),
            selectTask: vi.fn(),
            hoverTask: vi.fn(),
            clearAllSelections: vi.fn(),
            clearTaskSelection: vi.fn(),
            selectDefect: vi.fn(),
            hoverDefect: vi.fn(),
            setActiveFrustumId: vi.fn(),
          };
          (props.ref as (h: unknown) => void)(handle);
          return () => (props.ref as (n: null) => void)(null);
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="ply-viewer-container" />;
    }),
  };
});

// Capture SelectionPanel pixel callbacks so ray-picking tests can trigger them
let capturedOnHoverImagePixel: ((u: number, v: number) => void) | undefined;
let capturedOnHoverImageExit: (() => void) | undefined;
let capturedOnSelectImagePixel: ((u: number, v: number) => void) | undefined;

// SelectionPanel is already pure React — mock it to inspect props simply
vi.mock('./SelectionPanel', () => ({
  SelectionPanel: vi.fn((props: {
    hit: SelectionHit | null;
    onHoverImagePixel?: (u: number, v: number) => void;
    onHoverImageExit?: () => void;
    onSelectImagePixel?: (u: number, v: number) => void;
  }) => {
    capturedOnHoverImagePixel = props.onHoverImagePixel;
    capturedOnHoverImageExit = props.onHoverImageExit;
    capturedOnSelectImagePixel = props.onSelectImagePixel;
    return <div data-testid="selection-panel" data-hit-kind={props.hit?.kind ?? 'none'} />;
  }),
}));

function makeSuccessResult<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null, status: 'success' as const, isSuccess: true, isError: false, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}

function makePendingResult<T = never>(): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: true, error: null, status: 'pending' as const, isSuccess: false, isError: false, isPending: true, isFetching: true } as UseQueryResult<T, Error>;
}

function makeErrorResult<T = never>(err: Error): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: false, error: err, status: 'error' as const, isSuccess: false, isError: true, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}

function renderViewerPage(mockDeps: ViewerViewModelContextType, path = '/vessels/vessel-test/areas/area-01581') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/vessels/:vesselId/areas/:areaId"
            element={
              <ViewerViewModelContext.Provider value={mockDeps}>
                <ViewerPage />
              </ViewerViewModelContext.Provider>
            }
          />
          <Route
            path="/vessels/:vesselId/areas/:areaId/report"
            element={<div data-testid="area-report-page" />}
          />
          <Route
            path="/vessels/:vesselId/areas/:areaId/report/:campaignId"
            element={<div data-testid="campaign-report-page" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe(ViewerPage.name, () => {
  let mockDeps: ViewerViewModelContextType;

  beforeEach(() => {
    mockFlyToImage.mockClear();
    mockSelectImage.mockClear();
    mockHoverImageRay.mockClear();
    mockClearImageRayHover.mockClear();
    mockSelectImageRay.mockClear();
    mockDeps = {
      useArea: vi.fn(() => makeSuccessResult(createMockArea()) as ReturnType<ViewerViewModelContextType['useArea']>),
      useVessel: vi.fn(() => ({ data: createMockVessel(), isLoading: false, error: null })),
      useStructuralElements: vi.fn(() => makeSuccessResult([createMockStructuralElement()]) as ReturnType<ViewerViewModelContextType['useStructuralElements']>),
    };
  });

  it('renders a loading spinner while data is loading', () => {
    vi.mocked(mockDeps.useArea).mockReturnValue(makePendingResult() as ReturnType<ViewerViewModelContextType['useArea']>);
    renderViewerPage(mockDeps);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders the vessel name as the header title', () => {
    vi.mocked(mockDeps.useVessel).mockReturnValue({
      data: createMockVessel({ name: 'MV Atlantic' }),
      isLoading: false,
      error: null,
    });
    renderViewerPage(mockDeps);
    expect(screen.getByText('MV Atlantic')).toBeDefined();
  });

  it('renders the area name as a subtitle when vessel name is available', () => {
    vi.mocked(mockDeps.useVessel).mockReturnValue({
      data: createMockVessel({ name: 'MV Atlantic' }),
      isLoading: false,
      error: null,
    });
    renderViewerPage(mockDeps);
    expect(screen.getByText('Ballast Water Tank 01581')).toBeDefined();
  });

  it('renders the area name as the title when vessel name is not available', () => {
    vi.mocked(mockDeps.useVessel).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    renderViewerPage(mockDeps);
    expect(screen.getByText('Ballast Water Tank 01581')).toBeDefined();
  });

  it('renders the ply viewer container when a model URL is available', async () => {
    renderViewerPage(mockDeps);
    await waitFor(() => expect(screen.getByTestId('ply-viewer-container')).toBeDefined());
  });

  it('renders an error alert when data fetch fails', () => {
    vi.mocked(mockDeps.useArea).mockReturnValue(makeErrorResult(new Error('Load failed')) as ReturnType<ViewerViewModelContextType['useArea']>);
    renderViewerPage(mockDeps);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('renders a "not uploaded" notice when no PLY entries are available', async () => {
    const { useLayerPanelViewModel } = await import('./useLayerPanelViewModel');
    vi.mocked(useLayerPanelViewModel).mockReturnValueOnce({
      campaigns: [],
      allPcdFileIds: [],
      allPlyEntries: [],
      staticLayers: [],
      isLoading: false,
      error: null,
      isEmpty: true,
      onToggleLayer: vi.fn(),
      onToggleStaticLayer: vi.fn(),
      onToggleCampaignExpanded: vi.fn(),
      onTogglePcdLayer: vi.fn(),
      onColorModeChange: vi.fn(),
    });
    renderViewerPage(mockDeps);
    expect(screen.getByText('No scan data yet')).toBeDefined();
    expect(screen.getByText(/autoassess_bridge/)).toBeDefined();
  });

  it('passes each mesh campaign with its file ids to the CAD model lookup', async () => {
    const { useCampaignCadModels } = await import('./reveal/useCampaignCadModels');

    renderViewerPage(mockDeps);

    expect(vi.mocked(useCampaignCadModels)).toHaveBeenCalledWith([{ externalId: 'test-campaign', cdfFileIds: [42] }]);
  });

  it('says dss worker is building the 3D model when a mesh has no CAD model yet', async () => {
    const { useCampaignCadModels } = await import('./reveal/useCampaignCadModels');
    vi.mocked(useCampaignCadModels).mockReturnValueOnce(
      makeSuccessResult({ models: [], meshesWithoutModel: [{ campaignExternalId: 'test-campaign', fileId: 42 }] }),
    );

    renderViewerPage(mockDeps);

    expect(screen.getByText('3D model not built yet')).toBeInTheDocument();
    expect(screen.getByText(/being built by/)).toBeInTheDocument();
    expect(screen.getByText('dss campaign build-3d-model --campaign test-campaign')).toBeInTheDocument();
    expect(screen.queryByTestId('ply-viewer-container')).toBeNull();
  });

  it('shows an error instead of an empty viewer when the 3D models cannot be loaded', async () => {
    const { useCampaignCadModels } = await import('./reveal/useCampaignCadModels');
    vi.mocked(useCampaignCadModels).mockReturnValueOnce(makeErrorResult(new Error('Request failed | status code: 401')));

    renderViewerPage(mockDeps);

    expect(screen.getByTestId('cad-model-load-error')).toHaveTextContent(
      "Couldn't load the 3D models: Request failed | status code: 401",
    );
  });

  it('says the 3D model is processing while CDF converts it', async () => {
    const { useCampaignCadModels } = await import('./reveal/useCampaignCadModels');
    vi.mocked(useCampaignCadModels).mockReturnValueOnce(
      makeSuccessResult({ models: [makeDoneCadModel('test-campaign', 'Processing')], meshesWithoutModel: [] }),
    );

    renderViewerPage(mockDeps);

    expect(screen.getByText(/being processed in CDF/)).toBeInTheDocument();
  });

  it('gives the right panel the edit-campaign view model of this area', async () => {
    const { useEditCampaignViewModel } = await import('./campaigns/useEditCampaignViewModel');
    const { ViewerRightPanel } = await import('./ViewerRightPanel');

    renderViewerPage(mockDeps);

    expect(vi.mocked(useEditCampaignViewModel)).toHaveBeenCalledWith('autoassess', 'area-01581');
    expect(vi.mocked(ViewerRightPanel).mock.lastCall?.[0].editCampaignViewModel).toMatchObject({ isOpen: false });
  });

  it('renders SelectionPanel with null hit on initial load', async () => {
    renderViewerPage(mockDeps);
    await waitFor(() => expect(screen.getByTestId('selection-panel')).toBeDefined());
    expect(screen.getByTestId('selection-panel').getAttribute('data-hit-kind')).toBe('none');
  });

  it('passes selection hit to SelectionPanel when PlyViewer fires onHitSelected', async () => {
    renderViewerPage(mockDeps);
    await waitFor(() => expect(screen.getByTestId('ply-viewer-container')).toBeDefined());

    const mockHit: SelectionHit = {
      kind: 'region',
      position: { x: 1, y: 2, z: 3 } as import('three').Vector3,
      normal: { x: 0, y: 0, z: 1 } as import('three').Vector3,
    };

    act(() => {
      capturedOnHitSelected?.(mockHit);
    });

    await waitFor(() =>
      expect(screen.getByTestId('selection-panel').getAttribute('data-hit-kind')).toBe('region'),
    );
  });

  it('renders ViewerRightPanel in all page states', () => {
    renderViewerPage(mockDeps);
    expect(screen.getByTestId('viewer-right-panel')).toBeDefined();
  });

  it('renders ViewerRightPanel while loading', () => {
    vi.mocked(mockDeps.useArea).mockReturnValue(makePendingResult() as ReturnType<ViewerViewModelContextType['useArea']>);
    renderViewerPage(mockDeps);
    expect(screen.getByTestId('viewer-right-panel')).toBeDefined();
  });

  it('renders ViewerRightPanel when no model is uploaded', async () => {
    const { useLayerPanelViewModel } = await import('./useLayerPanelViewModel');
    vi.mocked(useLayerPanelViewModel).mockReturnValueOnce({
      campaigns: [],
      allPcdFileIds: [],
      allPlyEntries: [],
      staticLayers: [],
      isLoading: false,
      error: null,
      isEmpty: true,
      onToggleLayer: vi.fn(),
      onToggleStaticLayer: vi.fn(),
      onToggleCampaignExpanded: vi.fn(),
      onTogglePcdLayer: vi.fn(),
      onColorModeChange: vi.fn(),
    });
    renderViewerPage(mockDeps);
    expect(screen.getByTestId('viewer-right-panel')).toBeDefined();
  });

  it('renders the AutoAssess logo in the header', () => {
    renderViewerPage(mockDeps);
    expect(screen.getByRole('img', { name: 'AutoAssess' })).toBeDefined();
  });

  it('renders Reports button in the header', () => {
    renderViewerPage(mockDeps);
    expect(screen.getByRole('button', { name: /reports/i })).toBeInTheDocument();
  });

  it('navigates to area report page when Reports button is clicked', async () => {
    renderViewerPage(mockDeps);
    await userEvent.click(screen.getByRole('button', { name: /reports/i }));
    expect(screen.getByTestId('area-report-page')).toBeInTheDocument();
  });

  describe('?flyToImage URL param', () => {
    it('calls flyToImage on the viewer handle when the param matches a loaded image', async () => {
      const image = createMockDroneImage({ externalId: 'frame-42' });
      const { useDroneImages } = await import('./useDroneImages');
      vi.mocked(useDroneImages).mockReturnValue(makeSuccessResult([image]));

      renderViewerPage(
        mockDeps,
        '/vessels/vessel-test/areas/area-01581?flyToImage=frame-42',
      );

      await waitFor(() => expect(mockFlyToImage).toHaveBeenCalledWith(image));
    });

    it('does not call flyToImage when the param does not match any loaded image', async () => {
      const image = createMockDroneImage({ externalId: 'frame-42' });
      const { useDroneImages } = await import('./useDroneImages');
      vi.mocked(useDroneImages).mockReturnValue(makeSuccessResult([image]));

      renderViewerPage(
        mockDeps,
        '/vessels/vessel-test/areas/area-01581?flyToImage=no-such-frame',
      );

      // Give effects time to run — flyToImage should NOT have been called
      await waitFor(() => screen.getByTestId('ply-viewer-container'));
      expect(mockFlyToImage).not.toHaveBeenCalled();
    });

    it('selects the image in the viewer (SelectionPanel receives image hit) alongside flying', async () => {
      const image = createMockDroneImage({ externalId: 'frame-42' });
      const { useDroneImages } = await import('./useDroneImages');
      vi.mocked(useDroneImages).mockReturnValue(makeSuccessResult([image]));

      renderViewerPage(
        mockDeps,
        '/vessels/vessel-test/areas/area-01581?flyToImage=frame-42',
      );

      await waitFor(() => expect(mockFlyToImage).toHaveBeenCalledWith(image));
      expect(mockSelectImage).toHaveBeenCalledWith(image);
      // SelectionPanel receives an image hit
      await waitFor(() =>
        expect(screen.getByTestId('selection-panel').getAttribute('data-hit-kind')).toBe('image'),
      );
    });
  });

  describe('?camera URL param', () => {
    it('overrides the area default camera pose', async () => {
      vi.mocked(mockDeps.useArea).mockReturnValue(
        makeSuccessResult(
          createMockArea({ initialCameraPosition: [9, 9, 9], initialCameraTarget: [0, 0, 0] }),
        ) as ReturnType<ViewerViewModelContextType['useArea']>,
      );

      renderViewerPage(mockDeps, '/vessels/vessel-test/areas/area-01581?camera=1,2,3,4,5,6');

      await waitFor(() => screen.getByTestId('ply-viewer-container'));
      expect(capturedInitialCameraPose).toEqual({ position: [1, 2, 3], target: [4, 5, 6] });
    });

    it('writes the settled camera view into ?camera= so the link reopens the same view', async () => {
      renderViewerPage(mockDeps);
      await waitFor(() => screen.getByTestId('ply-viewer-container'));

      act(() => capturedOnCameraSettled?.({ position: [1.23456, 2, 3], target: [4, 5, 6] }));

      await waitFor(() =>
        expect(capturedInitialCameraPose).toEqual({ position: [1.2346, 2, 3], target: [4, 5, 6] }),
      );
    });

    it('falls back to the area default pose when the param is invalid', async () => {
      vi.mocked(mockDeps.useArea).mockReturnValue(
        makeSuccessResult(
          createMockArea({ initialCameraPosition: [9, 9, 9], initialCameraTarget: [0, 0, 0] }),
        ) as ReturnType<ViewerViewModelContextType['useArea']>,
      );

      renderViewerPage(mockDeps, '/vessels/vessel-test/areas/area-01581?camera=not,a,pose');

      await waitFor(() => screen.getByTestId('ply-viewer-container'));
      expect(capturedInitialCameraPose).toEqual({ position: [9, 9, 9], target: [0, 0, 0] });
    });
  });

  describe('image ray picking', () => {
    beforeEach(() => {
      capturedOnHoverImagePixel = undefined;
      capturedOnHoverImageExit = undefined;
      capturedOnSelectImagePixel = undefined;
    });

    async function renderWithImageSelected() {
      const image = createMockDroneImage({ externalId: 'frame-pick' });
      const { useDroneImages } = await import('./useDroneImages');
      vi.mocked(useDroneImages).mockReturnValue(makeSuccessResult([image]));
      renderViewerPage(mockDeps);
      await waitFor(() => expect(screen.getByTestId('ply-viewer-container')).toBeDefined());
      // Select the image via the PlyViewer onHitSelected callback
      act(() => { capturedOnHitSelected?.({ kind: 'image', image }); });
      await waitFor(() =>
        expect(screen.getByTestId('selection-panel').getAttribute('data-hit-kind')).toBe('image'),
      );
      return image;
    }

    it('calls hoverImageRay on the viewer handle when onHoverImagePixel fires with image selected', async () => {
      const image = await renderWithImageSelected();
      act(() => { capturedOnHoverImagePixel?.(320, 240); });
      expect(mockHoverImageRay).toHaveBeenCalledWith(image, 320, 240);
    });

    it('calls clearImageRayHover on the viewer handle when onHoverImageExit fires', async () => {
      await renderWithImageSelected();
      act(() => { capturedOnHoverImageExit?.(); });
      expect(mockClearImageRayHover).toHaveBeenCalled();
    });

    it('calls selectImageRay on the viewer handle when onSelectImagePixel fires with image selected', async () => {
      const image = await renderWithImageSelected();
      act(() => { capturedOnSelectImagePixel?.(160, 120); });
      expect(mockSelectImageRay).toHaveBeenCalledWith(image, 160, 120);
    });

    it('does not pass pixel callbacks to SelectionPanel when selection is not an image', async () => {
      renderViewerPage(mockDeps);
      await waitFor(() => expect(screen.getByTestId('ply-viewer-container')).toBeDefined());
      // No selection → pixel callbacks should be undefined
      expect(capturedOnHoverImagePixel).toBeUndefined();
      expect(capturedOnSelectImagePixel).toBeUndefined();
    });
  });
});
