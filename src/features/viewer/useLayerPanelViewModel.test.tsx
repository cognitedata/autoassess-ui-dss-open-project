import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useLayerPanelViewModel,
  LayerPanelViewModelContext,
} from './useLayerPanelViewModel';
import type { LayerPanelViewModelContextType } from './useLayerPanelViewModel';
import { useLayerVisibilityStore } from './layerVisibilityStore';
import { useColorModeStore } from './colorModeStore';
import { usePcdVisibilityStore } from './pcdVisibilityStore';
import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import type { InspectionResult } from './InspectionResultService';

function makeSuccessResult<T>(data: T) {
  return {
    data,
    isLoading: false,
    error: null,
    status: 'success' as const,
    isSuccess: true,
    isError: false,
    isPending: false,
    isFetching: false,
  };
}

function makePendingResult() {
  return {
    data: undefined,
    isLoading: true,
    error: null,
    status: 'pending' as const,
    isSuccess: false,
    isError: false,
    isPending: true,
    isFetching: true,
  };
}

function makeErrorResult(err: Error) {
  return {
    data: undefined,
    isLoading: false,
    error: err,
    status: 'error' as const,
    isSuccess: false,
    isError: true,
    isPending: false,
    isFetching: false,
  };
}

describe(useLayerPanelViewModel.name, () => {
  let mockDeps: LayerPanelViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    // Reset Zustand stores between tests
    useLayerVisibilityStore.setState({ visibility: {}, expanded: {}, staticVisibility: {} });
    useColorModeStore.setState({ modes: {} });
    usePcdVisibilityStore.setState({ visibility: {} });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    mockDeps = {
      useInspectionResults: vi.fn(() =>
        makeSuccessResult([createMockInspectionResult()]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
      ),
    };

    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <LayerPanelViewModelContext.Provider value={mockDeps}>
          {children}
        </LayerPanelViewModelContext.Provider>
      </QueryClientProvider>
    );
  });

  it('should return isLoading=true while results are loading', () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makePendingResult() as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.campaigns).toEqual([]);
    expect(result.current.isEmpty).toBe(false);
  });

  it('should return error when results fetch fails', () => {
    const err = new Error('CDF error');
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeErrorResult(err) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    expect(result.current.error).toBe(err);
    expect(result.current.campaigns).toEqual([]);
  });

  it('should return isEmpty=true when loaded but no results exist', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult<InspectionResult[]>([]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.campaigns).toEqual([]);
  });

  it('should return correct campaign label from date', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.campaigns[0].label).toBe('Campaign 2024-09-15');
  });

  // ---------------------------------------------------------------------------
  // Static layers (structural elements — area-level, not per-campaign)
  // ---------------------------------------------------------------------------

  it('staticLayers is empty when hasStructuralElements is false', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.staticLayers).toHaveLength(0);
  });

  it('staticLayers has a SEMANTIC_SEG row when hasStructuralElements is true', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.staticLayers).toHaveLength(1));
    expect(result.current.staticLayers[0].layerType).toBe('SEMANTIC_SEG');
    expect(result.current.staticLayers[0].label).toBe('Structural elements');
    expect(result.current.staticLayers[0].supportsColorMode).toBe(false);
  });

  it('staticLayers SEMANTIC_SEG is hidden by default', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.staticLayers).toHaveLength(1));
    expect(result.current.staticLayers[0].isVisible).toBe(false);
  });

  it('campaign layers do not include SEMANTIC_SEG (it lives in staticLayers)', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.campaigns[0].layers.every((l) => l.layerType !== 'SEMANTIC_SEG')).toBe(true);
  });

  it('onToggleStaticLayer updates SEMANTIC_SEG visibility in store', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.staticLayers).toHaveLength(1));
    result.current.onToggleStaticLayer('SEMANTIC_SEG', false);

    await waitFor(() =>
      expect(result.current.staticLayers[0].isVisible).toBe(false),
    );
    expect(useLayerVisibilityStore.getState().staticVisibility['SEMANTIC_SEG']).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Per-campaign mesh layer
  // ---------------------------------------------------------------------------

  it('should include MESH layer when result has cdfFileIds', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([createMockInspectionResult({ cdfFileIds: [42] })]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.layers).toHaveLength(1));
    expect(result.current.campaigns[0].layers[0].layerType).toBe('MESH');
    expect(result.current.campaigns[0].layers[0].label).toBe('Mesh');
  });

  it('should not include MESH layer when result has no cdfFileIds', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.campaigns[0].layers.every((l) => l.layerType !== 'MESH')).toBe(true);
  });

  it('should include no campaign layers when no cdfFileIds and no NDT data', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.campaigns[0].layers).toHaveLength(0);
  });

  it('latest campaign is expanded by default (FR-12)', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ externalId: 'r-latest', date: '2024-09-15' }),
        createMockInspectionResult({ externalId: 'r-older', date: '2024-03-01' }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(2));
    expect(result.current.campaigns[0].isExpanded).toBe(true);
    expect(result.current.campaigns[1].isExpanded).toBe(false);
  });

  it('latest campaign MESH is visible, older is not (FR-12)', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ externalId: 'r-latest', date: '2024-09-15', cdfFileIds: [1] }),
        createMockInspectionResult({ externalId: 'r-older', date: '2024-03-01', cdfFileIds: [2] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.layers[0]?.isVisible).toBe(true));
    expect(result.current.campaigns[1].layers[0].isVisible).toBe(false);
  });

  it('onToggleLayer calls store.setLayerVisible with correct args', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([createMockInspectionResult({ cdfFileIds: [1] })]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));

    result.current.onToggleLayer('result-legacy-area-01581', 'MESH', false);

    const { visibility } = useLayerVisibilityStore.getState();
    expect(visibility['result-legacy-area-01581']?.['MESH']).toBe(false);
  });

  it('onToggleCampaignExpanded calls store.toggleCampaignExpanded', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));

    // Campaign starts expanded (latest) — toggle collapses it
    result.current.onToggleCampaignExpanded('result-legacy-area-01581');

    const { expanded } = useLayerVisibilityStore.getState();
    expect(expanded['result-legacy-area-01581']).toBe(false);
  });

  it('MESH layer row should have supportsColorMode=true and default colorMode="colorization"', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([createMockInspectionResult({ cdfFileIds: [42] })]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.layers).toHaveLength(1));
    const meshLayer = result.current.campaigns[0].layers[0];
    expect(meshLayer.supportsColorMode).toBe(true);
    expect(meshLayer.colorMode).toBe('colorization');
  });

  it('onColorModeChange updates colorMode on MESH layer row', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([createMockInspectionResult({ cdfFileIds: [42] })]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.layers).toHaveLength(1));

    result.current.onColorModeChange('MESH', 'colorization');

    await waitFor(() =>
      expect(result.current.campaigns[0].layers[0].colorMode).toBe('colorization'),
    );
  });

  // ---------------------------------------------------------------------------
  // allPlyEntries — cross-campaign PLY file registry
  // ---------------------------------------------------------------------------

  it('allPlyEntries is empty when no result has cdfFileIds', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.allPlyEntries).toEqual([]);
  });

  it('allPlyEntries has one entry per cdfFileId with correct key and campaignId', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ externalId: 'r1', cdfFileIds: [10, 20] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.allPlyEntries).toHaveLength(2));
    expect(result.current.allPlyEntries[0]).toEqual({ key: '10', campaignId: 'r1' });
    expect(result.current.allPlyEntries[1]).toEqual({ key: '20', campaignId: 'r1' });
  });

  it('allPlyEntries flattens cdfFileIds across campaigns', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ externalId: 'r1', cdfFileIds: [10] }),
        createMockInspectionResult({ externalId: 'r2', cdfFileIds: [20, 30] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.allPlyEntries).toHaveLength(3));
    expect(result.current.allPlyEntries).toEqual([
      { key: '10', campaignId: 'r1' },
      { key: '20', campaignId: 'r2' },
      { key: '30', campaignId: 'r2' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // PCD layers — per-campaign
  // ---------------------------------------------------------------------------

  it('campaign pcdLayers is empty when result has no pcdFileIds', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.campaigns[0].pcdLayers).toEqual([]);
  });

  it('campaign pcdLayers has one row per pcdFileId with correct label', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ pcdFileIds: [101, 102], pcdFileLabels: ['Pointcloud', 'Labeled cloud'] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.pcdLayers).toHaveLength(2));
    expect(result.current.campaigns[0].pcdLayers[0]).toEqual({ key: '101', label: 'Pointcloud', isVisible: false });
    expect(result.current.campaigns[0].pcdLayers[1]).toEqual({ key: '102', label: 'Labeled cloud', isVisible: false });
  });

  it('pcdLayers falls back to generic label when pcdFileLabels is short', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ pcdFileIds: [101, 102], pcdFileLabels: ['Pointcloud'] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.pcdLayers).toHaveLength(2));
    expect(result.current.campaigns[0].pcdLayers[1].label).toBe('Point cloud 2');
  });

  it('allPcdFileIds is empty when no result has pcdFileIds', async () => {
    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    expect(result.current.allPcdFileIds).toEqual([]);
  });

  it('allPcdFileIds flattens pcdFileIds across campaigns', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ externalId: 'r1', pcdFileIds: [101, 102] }),
        createMockInspectionResult({ externalId: 'r2', pcdFileIds: [201] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(2));
    expect(result.current.allPcdFileIds).toEqual([101, 102, 201]);
  });

  it('onTogglePcdLayer(key, true) makes pcdLayer visible', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ pcdFileIds: [101], pcdFileLabels: ['Pointcloud'] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.pcdLayers).toHaveLength(1));
    expect(result.current.campaigns[0].pcdLayers[0].isVisible).toBe(false);

    result.current.onTogglePcdLayer('101', true);
    await waitFor(() => expect(result.current.campaigns[0].pcdLayers[0].isVisible).toBe(true));
  });

  it('onTogglePcdLayer for one key does not affect another', async () => {
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([
        createMockInspectionResult({ pcdFileIds: [101, 102], pcdFileLabels: ['Pointcloud', 'Labeled cloud'] }),
      ]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns[0]?.pcdLayers).toHaveLength(2));
    // Turn key 101 on; key 102 should remain off (its own independent state)
    result.current.onTogglePcdLayer('101', true);

    await waitFor(() => expect(result.current.campaigns[0].pcdLayers[0].isVisible).toBe(true));
    expect(result.current.campaigns[0].pcdLayers[1].isVisible).toBe(false);
  });

  it('IMAGES layer appears in campaign layers when campaign ID is in droneImageCampaignIds', async () => {
    const campaign = createMockInspectionResult({ externalId: 'result-27aca577' });
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([campaign]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel(
        'autoassess', 'area-01581', false, [],
        new Set(['result-27aca577']),
      ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    const layerTypes = result.current.campaigns[0].layers.map((l) => l.layerType);
    expect(layerTypes).toContain('IMAGES');
  });

  it('IMAGES layer is visible by default for the latest campaign', async () => {
    const campaign = createMockInspectionResult({ externalId: 'result-27aca577', cdfFileIds: [42] });
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([campaign]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel(
        'autoassess', 'area-01581', false, [],
        new Set(['result-27aca577']),
      ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    const imagesLayer = result.current.campaigns[0].layers.find((l) => l.layerType === 'IMAGES');
    expect(imagesLayer?.isVisible).toBe(true);
  });

  it('IMAGES layer does not appear when campaign is not in droneImageCampaignIds', async () => {
    const campaign = createMockInspectionResult({ externalId: 'result-27aca577', cdfFileIds: [42] });
    vi.mocked(mockDeps.useInspectionResults).mockReturnValue(
      makeSuccessResult([campaign]) as ReturnType<LayerPanelViewModelContextType['useInspectionResults']>,
    );

    const { result } = renderHook(
      () => useLayerPanelViewModel('autoassess', 'area-01581', false),
      { wrapper },
    );

    await waitFor(() => expect(result.current.campaigns).toHaveLength(1));
    const layerTypes = result.current.campaigns[0].layers.map((l) => l.layerType);
    expect(layerTypes).not.toContain('IMAGES');
  });
});
