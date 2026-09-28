import { create } from 'zustand';
import type { LayerType } from './LayerType';

export type CampaignInit = {
  externalId: string;
  availableLayers: LayerType[];
};

export interface LayerVisibilityState {
  /** visibility[campaignId][layerType] */
  visibility: Record<string, Partial<Record<LayerType, boolean>>>;
  /** expanded[campaignId] */
  expanded: Record<string, boolean>;
  /** Area-level (non-campaign) layer visibility, e.g. SEMANTIC_SEG. */
  staticVisibility: Partial<Record<LayerType, boolean>>;

  /**
   * Initialise state from loaded campaigns.
   * Latest campaign: expanded + one visible layer (MESH if available, else first available).
   * Older campaigns: all-off + collapsed.
   * Campaigns must already be sorted by date descending before calling.
   */
  initCampaigns(campaigns: CampaignInit[]): void;
  /** Initialise area-level static layers (each set to hidden). Idempotent. */
  initStaticLayers(layers: LayerType[]): void;
  setLayerVisible(campaignId: string, layerType: LayerType, visible: boolean): void;
  setStaticLayerVisible(layerType: LayerType, visible: boolean): void;
  toggleCampaignExpanded(campaignId: string): void;
  /**
   * Returns true if any campaign has the given layer enabled, OR if the static
   * visibility for that layer is true. Used by PlyViewer to drive group.visible.
   */
  isEffectivelyVisible(layerType: LayerType): boolean;
}

export const useLayerVisibilityStore = create<LayerVisibilityState>((set, get) => ({
  visibility: {},
  expanded: {},
  staticVisibility: {},

  initCampaigns(campaigns: CampaignInit[]): void {
    const visibility: Record<string, Partial<Record<LayerType, boolean>>> = {};
    const expanded: Record<string, boolean> = {};

    campaigns.forEach((campaign, index) => {
      const isLatest = index === 0;
      expanded[campaign.externalId] = isLatest;
      const layerVis: Partial<Record<LayerType, boolean>> = {};
      const primaryLayer: LayerType | undefined = isLatest
        ? (campaign.availableLayers.includes('MESH') ? 'MESH' : campaign.availableLayers[0])
        : undefined;
      for (const layerType of campaign.availableLayers) {
        // For the latest campaign, MESH (primary) and IMAGES are both visible by default.
        layerVis[layerType] = isLatest && (layerType === primaryLayer || layerType === 'IMAGES');
      }
      visibility[campaign.externalId] = layerVis;
    });

    set({ visibility, expanded });
  },

  initStaticLayers(layers: LayerType[]): void {
    set((state) => {
      const next = { ...state.staticVisibility };
      for (const layer of layers) {
        if (next[layer] === undefined) next[layer] = false;
      }
      return { staticVisibility: next };
    });
  },

  setLayerVisible(campaignId: string, layerType: LayerType, visible: boolean): void {
    set((state) => ({
      visibility: {
        ...state.visibility,
        [campaignId]: {
          ...state.visibility[campaignId],
          [layerType]: visible,
        },
      },
    }));
  },

  setStaticLayerVisible(layerType: LayerType, visible: boolean): void {
    set((state) => ({
      staticVisibility: { ...state.staticVisibility, [layerType]: visible },
    }));
  },

  toggleCampaignExpanded(campaignId: string): void {
    set((state) => ({
      expanded: {
        ...state.expanded,
        [campaignId]: !state.expanded[campaignId],
      },
    }));
  },

  isEffectivelyVisible(layerType: LayerType): boolean {
    const { visibility, staticVisibility } = get();
    if (staticVisibility[layerType] === true) return true;
    return Object.values(visibility).some((layerVis) => layerVis[layerType] === true);
  },
}));
