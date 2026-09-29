import { createContext, useContext, useMemo } from 'react';

import { useColorModeStore } from './colorModeStore';
import type { ColorMode } from './colorModeStore';
import { useLayerVisibilityStore } from './layerVisibilityStore';
import type { LayerVisibilityState } from './layerVisibilityStore';
import type { CampaignCadModel } from './reveal/CampaignCadModelService';

export interface SegmentLegendEntry {
  /** Lowercase 6-digit hex of the segment colour, without `#`. */
  colourHex: string;
  /** The class name from the models' legends, or `#<hex>` for unnamed segments. */
  label: string;
  named: boolean;
}

export interface SegmentLegendViewModel {
  /** True only in Segments colour mode with at least one named class to explain. */
  visible: boolean;
  entries: SegmentLegendEntry[];
  /** Distinct segment colours beyond {@link MAX_LEGEND_ENTRIES}, shown as "+N more". */
  overflowCount: number;
}

/** Entries beyond this are summarised, so an unlabelled scan can't flood the overlay. */
export const MAX_LEGEND_ENTRIES = 10;

const defaultDeps = {
  /** Reactive colour mode of the mesh layer. */
  useMeshColorMode: (): ColorMode => useColorModeStore((state) => state.getColorMode('MESH')),
  /** Reactive per-campaign layer visibility, as toggled in the layer panel. */
  useCampaignLayerVisibility: (): LayerVisibilityState['visibility'] =>
    useLayerVisibilityStore((state) => state.visibility),
};
export type SegmentLegendViewModelContextType = typeof defaultDeps;
export const SegmentLegendViewModelContext = createContext<SegmentLegendViewModelContextType>(defaultDeps);

/**
 * Legend for the Segments colour mode: one row per semantic class across the rendered CAD
 * models (named by their build-time legend, see `CampaignCadModel.legend`), then one row
 * per remaining unnamed segment colour as a hex fallback. Only campaigns whose mesh layer
 * is toggled visible contribute — a hidden campaign's colours aren't on screen. Hidden
 * outside Segments mode and for models whose palette names no class (old models: nothing
 * useful to show).
 */
export function useSegmentLegendViewModel(cadModels: CampaignCadModel[]): SegmentLegendViewModel {
  const { useMeshColorMode, useCampaignLayerVisibility } = useContext(SegmentLegendViewModelContext);
  const mode = useMeshColorMode();
  const visibility = useCampaignLayerVisibility();
  return useMemo(() => {
    if (mode !== 'defects') return { visible: false, entries: [], overflowCount: 0 };

    const visibleModels = cadModels.filter(
      (model) => visibility[model.campaignExternalId]?.MESH === true,
    );
    const named = new Map<string, SegmentLegendEntry>(); // keyed by class name
    const unnamed = new Map<string, SegmentLegendEntry>(); // keyed by colour hex
    for (const model of visibleModels) {
      for (const rgb of Object.values(model.palette)) {
        const colourHex = rgbToHex(rgb);
        const label = model.legend[colourHex];
        if (label !== undefined) {
          if (!named.has(label)) named.set(label, { colourHex, label, named: true });
        } else if (!unnamed.has(colourHex)) {
          unnamed.set(colourHex, { colourHex, label: `#${colourHex}`, named: false });
        }
      }
    }
    if (named.size === 0) return { visible: false, entries: [], overflowCount: 0 };

    const all = [...named.values(), ...unnamed.values()];
    return {
      visible: true,
      entries: all.slice(0, MAX_LEGEND_ENTRIES),
      overflowCount: Math.max(0, all.length - MAX_LEGEND_ENTRIES),
    };
  }, [mode, cadModels, visibility]);
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
