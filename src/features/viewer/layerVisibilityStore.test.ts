import { describe, it, expect, beforeEach } from 'vitest';
import { useLayerVisibilityStore } from './layerVisibilityStore';
import type { LayerType } from './LayerType';

// Reset store state between tests
beforeEach(() => {
  useLayerVisibilityStore.setState({ visibility: {}, expanded: {}, staticVisibility: {} });
});

describe('layerVisibilityStore', () => {
  describe('initCampaigns', () => {
    it('single campaign: MESH and IMAGES both visible by default, campaign expanded', () => {
      // Act
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: ['MESH', 'IMAGES'] },
      ]);

      // Assert — IMAGES is visible by default alongside the primary layer for the latest campaign
      const { visibility, expanded } = useLayerVisibilityStore.getState();
      expect(expanded['c1']).toBe(true);
      expect(visibility['c1']['MESH']).toBe(true);
      expect(visibility['c1']['IMAGES']).toBe(true);
    });

    it('single campaign without MESH: first available layer visible, IMAGES also visible, campaign expanded', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: ['NDT_MEASUREMENTS', 'IMAGES'] },
      ]);

      const { visibility, expanded } = useLayerVisibilityStore.getState();
      expect(expanded['c1']).toBe(true);
      expect(visibility['c1']['NDT_MEASUREMENTS']).toBe(true);
      expect(visibility['c1']['IMAGES']).toBe(true);
    });

    it('older campaigns: IMAGES is hidden even if available', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c-latest', availableLayers: ['MESH', 'IMAGES'] },
        { externalId: 'c-older', availableLayers: ['MESH', 'IMAGES'] },
      ]);

      const { visibility } = useLayerVisibilityStore.getState();
      expect(visibility['c-latest']['IMAGES']).toBe(true);
      expect(visibility['c-older']['IMAGES']).toBe(false);
    });

    it('two campaigns: latest MESH-only/expanded, older all-off/collapsed', () => {
      // Act — campaigns must be passed in date-descending order (as the service provides)
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c-latest', availableLayers: ['MESH'] },
        { externalId: 'c-older', availableLayers: ['MESH'] },
      ]);

      // Assert
      const { visibility, expanded } = useLayerVisibilityStore.getState();
      expect(expanded['c-latest']).toBe(true);
      expect(visibility['c-latest']['MESH']).toBe(true);
      expect(expanded['c-older']).toBe(false);
      expect(visibility['c-older']['MESH']).toBe(false);
    });

    it('is idempotent: calling twice with the same data produces the same state', () => {
      const campaigns = [{ externalId: 'c1', availableLayers: ['MESH'] as LayerType[] }];

      useLayerVisibilityStore.getState().initCampaigns(campaigns);
      useLayerVisibilityStore.getState().initCampaigns(campaigns);

      const { visibility, expanded } = useLayerVisibilityStore.getState();
      expect(expanded['c1']).toBe(true);
      expect(visibility['c1']['MESH']).toBe(true);
    });

    it('resets prior state when called with different campaigns', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'old-campaign', availableLayers: ['MESH'] },
      ]);

      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'new-campaign', availableLayers: ['MESH'] },
      ]);

      const { visibility, expanded } = useLayerVisibilityStore.getState();
      expect(expanded['old-campaign']).toBeUndefined();
      expect(visibility['old-campaign']).toBeUndefined();
      expect(expanded['new-campaign']).toBe(true);
    });

    it('empty campaigns list clears all state', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: ['MESH'] },
      ]);

      useLayerVisibilityStore.getState().initCampaigns([]);

      const { visibility, expanded } = useLayerVisibilityStore.getState();
      expect(Object.keys(visibility)).toHaveLength(0);
      expect(Object.keys(expanded)).toHaveLength(0);
    });
  });

  describe('initStaticLayers', () => {
    it('sets each layer to hidden', () => {
      useLayerVisibilityStore.getState().initStaticLayers(['SEMANTIC_SEG']);

      expect(useLayerVisibilityStore.getState().staticVisibility['SEMANTIC_SEG']).toBe(false);
    });

    it('does not override a layer that was explicitly shown', () => {
      useLayerVisibilityStore.getState().setStaticLayerVisible('SEMANTIC_SEG', true);
      useLayerVisibilityStore.getState().initStaticLayers(['SEMANTIC_SEG']);

      expect(useLayerVisibilityStore.getState().staticVisibility['SEMANTIC_SEG']).toBe(true);
    });

    it('is idempotent when called twice', () => {
      useLayerVisibilityStore.getState().initStaticLayers(['SEMANTIC_SEG']);
      useLayerVisibilityStore.getState().initStaticLayers(['SEMANTIC_SEG']);

      expect(useLayerVisibilityStore.getState().staticVisibility['SEMANTIC_SEG']).toBe(false);
    });
  });

  describe('setStaticLayerVisible', () => {
    it('sets the static layer to visible', () => {
      useLayerVisibilityStore.getState().setStaticLayerVisible('SEMANTIC_SEG', true);
      expect(useLayerVisibilityStore.getState().staticVisibility['SEMANTIC_SEG']).toBe(true);
    });

    it('sets the static layer to hidden', () => {
      useLayerVisibilityStore.getState().setStaticLayerVisible('SEMANTIC_SEG', true);
      useLayerVisibilityStore.getState().setStaticLayerVisible('SEMANTIC_SEG', false);
      expect(useLayerVisibilityStore.getState().staticVisibility['SEMANTIC_SEG']).toBe(false);
    });
  });

  describe('setLayerVisible', () => {
    beforeEach(() => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: ['MESH', 'IMAGES'] },
      ]);
    });

    it('toggles a single layer off without affecting others', () => {
      // Arrange — MESH starts on; manually turn IMAGES on so both are visible
      useLayerVisibilityStore.getState().setLayerVisible('c1', 'IMAGES', true);

      // Act
      useLayerVisibilityStore.getState().setLayerVisible('c1', 'MESH', false);

      // Assert
      const { visibility } = useLayerVisibilityStore.getState();
      expect(visibility['c1']['MESH']).toBe(false);
      expect(visibility['c1']['IMAGES']).toBe(true);
    });

    it('toggles a layer back on', () => {
      useLayerVisibilityStore.getState().setLayerVisible('c1', 'MESH', false);
      useLayerVisibilityStore.getState().setLayerVisible('c1', 'MESH', true);

      expect(useLayerVisibilityStore.getState().visibility['c1']['MESH']).toBe(true);
    });
  });

  describe('toggleCampaignExpanded', () => {
    it('flips the expanded flag', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: [] },
      ]);

      // Initially expanded (latest)
      expect(useLayerVisibilityStore.getState().expanded['c1']).toBe(true);

      useLayerVisibilityStore.getState().toggleCampaignExpanded('c1');
      expect(useLayerVisibilityStore.getState().expanded['c1']).toBe(false);

      useLayerVisibilityStore.getState().toggleCampaignExpanded('c1');
      expect(useLayerVisibilityStore.getState().expanded['c1']).toBe(true);
    });
  });

  describe('isEffectivelyVisible', () => {
    it('returns true when the latest campaign has MESH on', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c-latest', availableLayers: ['MESH'] },
        { externalId: 'c-older', availableLayers: ['MESH'] },
      ]);
      // Only latest has MESH on; older is off by initCampaigns defaults
      expect(useLayerVisibilityStore.getState().isEffectivelyVisible('MESH')).toBe(true);
    });

    it('returns false for non-MESH layers after init (no static override)', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: ['MESH', 'NDT_MEASUREMENTS'] },
      ]);

      expect(useLayerVisibilityStore.getState().isEffectivelyVisible('NDT_MEASUREMENTS')).toBe(false);
    });

    it('returns false when all campaigns have the layer off', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: ['MESH'] },
      ]);
      useLayerVisibilityStore.getState().setLayerVisible('c1', 'MESH', false);

      expect(useLayerVisibilityStore.getState().isEffectivelyVisible('MESH')).toBe(false);
    });

    it('returns false when no campaigns are initialised', () => {
      expect(useLayerVisibilityStore.getState().isEffectivelyVisible('MESH')).toBe(false);
    });

    it('returns true when an older campaign has the layer turned back on', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c-latest', availableLayers: ['MESH'] },
        { externalId: 'c-older', availableLayers: ['MESH'] },
      ]);
      // Turn off latest, turn on older
      useLayerVisibilityStore.getState().setLayerVisible('c-latest', 'MESH', false);
      useLayerVisibilityStore.getState().setLayerVisible('c-older', 'MESH', true);

      expect(useLayerVisibilityStore.getState().isEffectivelyVisible('MESH')).toBe(true);
    });

    it('returns false for a static layer after init (defaults hidden)', () => {
      useLayerVisibilityStore.getState().initCampaigns([
        { externalId: 'c1', availableLayers: ['MESH'] },
      ]);
      useLayerVisibilityStore.getState().initStaticLayers(['SEMANTIC_SEG']);

      expect(useLayerVisibilityStore.getState().isEffectivelyVisible('SEMANTIC_SEG')).toBe(false);
    });

    it('returns true for a static layer that was turned on', () => {
      useLayerVisibilityStore.getState().initStaticLayers(['SEMANTIC_SEG']);
      useLayerVisibilityStore.getState().setStaticLayerVisible('SEMANTIC_SEG', true);

      expect(useLayerVisibilityStore.getState().isEffectivelyVisible('SEMANTIC_SEG')).toBe(true);
    });
  });
});
