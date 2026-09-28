import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useInspectionResults as defaultUseInspectionResults } from './useInspectionResults';
import type { InspectionResult } from './InspectionResultService';
import type { NdtMeasurement } from './NdtMeasurementService';
import type { ColorMode } from './colorModeStore';
import { useColorModeStore } from './colorModeStore';
import type { LayerType } from './LayerType';
import { useLayerVisibilityStore } from './layerVisibilityStore';
import type { CampaignInit } from './layerVisibilityStore';
import { usePcdVisibilityStore } from './pcdVisibilityStore';

/** Associates a PLY file ID with the campaign that owns it. */
export interface PlyEntry {
  /** String(cdfFileId) — used as a stable React key and URL lookup index. */
  key: string;
  campaignId: string;
}

// Human-readable labels for layer types (domain language, not tech jargon)
export const LAYER_LABELS: Record<LayerType, string> = {
  POINT_CLOUD: 'Point cloud',
  MESH: 'Mesh',
  SEMANTIC_SEG: 'Structural elements',
  IMAGES: 'Images',
  DEFECT_DETECTIONS: 'Defect detections',
  NDT_MEASUREMENTS: 'NDT measurements',
  CHANGE_DETECTION: 'Change detection',
};

type UseInspectionResultsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<InspectionResult[], Error>;

export type LayerPanelViewModelContextType = {
  useInspectionResults: UseInspectionResultsFn;
};

const defaultDeps: LayerPanelViewModelContextType = {
  useInspectionResults: defaultUseInspectionResults,
};

export const LayerPanelViewModelContext =
  createContext<LayerPanelViewModelContextType>(defaultDeps);

const COLOR_MODE_SUPPORTED_LAYERS: ReadonlySet<LayerType> = new Set(['MESH', 'POINT_CLOUD']);

export interface LayerRowViewModel {
  layerType: LayerType;
  label: string;
  isVisible: boolean;
  colorMode: ColorMode;
  supportsColorMode: boolean;
}

export interface PcdLayerViewModel {
  /** Unique key for this PCD layer (String(cdfFileId)). */
  key: string;
  label: string;
  isVisible: boolean;
}

export interface CampaignRowViewModel {
  campaignId: string;
  label: string;
  isExpanded: boolean;
  layers: LayerRowViewModel[];
  /** Per-file point cloud rows for this campaign. */
  pcdLayers: PcdLayerViewModel[];
}

export interface LayerPanelViewModel {
  campaigns: CampaignRowViewModel[];
  /**
   * All PCD file IDs across every campaign, flattened in campaign order.
   * Used by ViewerPage to fetch download URLs for PlyViewer.
   */
  allPcdFileIds: number[];
  /**
   * All PLY entries across every campaign, flattened in campaign order.
   * Used by ViewerPage to fetch download URLs and build the plyEntries prop for PlyViewer.
   */
  allPlyEntries: PlyEntry[];
  /** Area-level static layer rows (e.g. structural elements). Rendered above campaigns. */
  staticLayers: LayerRowViewModel[];
  isLoading: boolean;
  error: Error | null;
  isEmpty: boolean;
  onToggleLayer: (campaignId: string, layerType: LayerType, visible: boolean) => void;
  onToggleStaticLayer: (layerType: LayerType, visible: boolean) => void;
  onToggleCampaignExpanded: (campaignId: string) => void;
  onTogglePcdLayer: (key: string, visible: boolean) => void;
  onColorModeChange: (layerType: LayerType, mode: ColorMode) => void;
}

/**
 * Determines which layer types are available for a given inspection result.
 * MESH is available when the result has associated PLY file IDs.
 * NDT_MEASUREMENTS is available when the campaign has at least one measurement.
 * SEMANTIC_SEG is area-level and lives in staticLayers, not per-campaign.
 * IMAGES is per-campaign when that campaign has drone images.
 */
function computeAvailableLayers(
  result: InspectionResult,
  hasNdtData: boolean,
  hasImageData: boolean,
): LayerType[] {
  const layers: LayerType[] = [];
  if (result.cdfFileIds.length > 0) layers.push('MESH');
  if (hasNdtData) layers.push('NDT_MEASUREMENTS');
  if (hasImageData) layers.push('IMAGES');
  return layers;
}

export function useLayerPanelViewModel(
  areaSpace: string,
  areaExternalId: string,
  hasStructuralElements: boolean,
  ndtMeasurements: NdtMeasurement[] = [],
  droneImageCampaignIds: ReadonlySet<string> = new Set(),
): LayerPanelViewModel {
  const { useInspectionResults } = useContext(LayerPanelViewModelContext);
  const resultsQuery = useInspectionResults(areaSpace, areaExternalId);

  const visibility = useLayerVisibilityStore((state) => state.visibility);
  const expanded = useLayerVisibilityStore((state) => state.expanded);
  const staticVisibility = useLayerVisibilityStore((state) => state.staticVisibility);
  const initCampaigns = useLayerVisibilityStore((state) => state.initCampaigns);
  const initStaticLayers = useLayerVisibilityStore((state) => state.initStaticLayers);
  const setLayerVisible = useLayerVisibilityStore((state) => state.setLayerVisible);
  const setStaticLayerVisible = useLayerVisibilityStore((state) => state.setStaticLayerVisible);
  const toggleCampaignExpanded = useLayerVisibilityStore((state) => state.toggleCampaignExpanded);

  // Subscribe to modes so the view re-renders when a color mode changes
  useColorModeStore((state) => state.modes);
  const setColorMode = useColorModeStore((state) => state.setColorMode);
  const getColorMode = useColorModeStore((state) => state.getColorMode);

  // Subscribe to PCD visibility so rows re-render when toggled
  const pcdVisibility = usePcdVisibilityStore((state) => state.visibility);
  const initPcdKeys = usePcdVisibilityStore((state) => state.initPcdKeys);
  const setPcdVisible = usePcdVisibilityStore((state) => state.setPcdVisible);
  const isPcdVisible = usePcdVisibilityStore((state) => state.isPcdVisible);

  // Suppress unused-variable warning — pcdVisibility is consumed only to trigger re-render
  void pcdVisibility;

  const rawResults = resultsQuery.data;

  const ndtCampaignIds = useMemo(
    () => new Set(ndtMeasurements.map((m) => m.campaignExternalId)),
    [ndtMeasurements],
  );

  // Stable key guard: only call initCampaigns when the set of result IDs, NDT set, or image set changes.
  const initKeyRef = useRef<string>('');
  useEffect(() => {
    if (!rawResults) return;
    const ndtKey = [...ndtCampaignIds].sort().join(',');
    const imgKey = [...droneImageCampaignIds].sort().join(',');
    const key = rawResults.map((r) => r.externalId).join(',') + `:ndt=${ndtKey}:img=${imgKey}`;
    if (initKeyRef.current === key) return;
    initKeyRef.current = key;
    const inits: CampaignInit[] = rawResults.map((r) => ({
      externalId: r.externalId,
      availableLayers: computeAvailableLayers(
        r,
        ndtCampaignIds.has(r.externalId),
        droneImageCampaignIds.has(r.externalId),
      ),
    }));
    initCampaigns(inits);
    const allPcdKeys = rawResults.flatMap((r) => r.pcdFileIds.map(String));
    initPcdKeys(allPcdKeys);
  }, [rawResults, ndtCampaignIds, droneImageCampaignIds, initCampaigns, initPcdKeys]);

  // Initialise static layers when structural elements are confirmed present.
  const staticInitRef = useRef(false);
  useEffect(() => {
    if (!hasStructuralElements || staticInitRef.current) return;
    staticInitRef.current = true;
    initStaticLayers(['SEMANTIC_SEG']);
  }, [hasStructuralElements, initStaticLayers]);

  const campaigns: CampaignRowViewModel[] = (rawResults ?? []).map((result) => {
    const campaignVis = visibility[result.externalId] ?? {};
    const availableLayers = computeAvailableLayers(
      result,
      ndtCampaignIds.has(result.externalId),
      droneImageCampaignIds.has(result.externalId),
    );
    const pcdLayers: PcdLayerViewModel[] = result.pcdFileIds.map((fileId, i) => ({
      key: String(fileId),
      label: result.pcdFileLabels[i] ?? `Point cloud ${i + 1}`,
      isVisible: isPcdVisible(String(fileId)),
    }));
    return {
      campaignId: result.externalId,
      label: `Campaign ${result.date}`,
      isExpanded: expanded[result.externalId] ?? false,
      layers: availableLayers.map((layerType) => ({
        layerType,
        label: LAYER_LABELS[layerType],
        isVisible: campaignVis[layerType] ?? false,
        colorMode: getColorMode(layerType),
        supportsColorMode: COLOR_MODE_SUPPORTED_LAYERS.has(layerType),
      })),
      pcdLayers,
    };
  });

  // Stable references: only recompute when rawResults changes, not on visibility changes.
  // This prevents ViewerPage from passing new arrays to PlyViewer on every visibility
  // toggle, which would trigger a full scene remount and camera reset.
  const allPcdFileIds = useMemo(
    () => (rawResults ?? []).flatMap((r) => r.pcdFileIds),
    [rawResults],
  );

  const allPlyEntries = useMemo<PlyEntry[]>(
    () => (rawResults ?? []).flatMap((r) =>
      r.cdfFileIds.map((id) => ({ key: String(id), campaignId: r.externalId })),
    ),
    [rawResults],
  );

  const staticLayers = useMemo<LayerRowViewModel[]>(() => {
    if (!hasStructuralElements) return [];
    return [{
      layerType: 'SEMANTIC_SEG',
      label: LAYER_LABELS['SEMANTIC_SEG'],
      isVisible: staticVisibility['SEMANTIC_SEG'] ?? false,
      colorMode: getColorMode('SEMANTIC_SEG'),
      supportsColorMode: COLOR_MODE_SUPPORTED_LAYERS.has('SEMANTIC_SEG'),
    }];
  }, [hasStructuralElements, staticVisibility, getColorMode]);

  return {
    campaigns,
    allPcdFileIds,
    allPlyEntries,
    staticLayers,
    isLoading: resultsQuery.isLoading,
    error: resultsQuery.error ?? null,
    isEmpty: !resultsQuery.isLoading && !resultsQuery.error && (rawResults?.length ?? 0) === 0,
    onToggleLayer: setLayerVisible,
    onToggleStaticLayer: setStaticLayerVisible,
    onToggleCampaignExpanded: toggleCampaignExpanded,
    onTogglePcdLayer: setPcdVisible,
    onColorModeChange: setColorMode,
  };
}
