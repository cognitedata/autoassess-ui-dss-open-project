import { describe, it, expect, beforeEach } from 'vitest';
import { Group } from 'three';
import { ViewerLayerManager } from './ViewerLayerManager';
import type { IViewerLayer } from './IViewerLayer';

function createMockLayer(): IViewerLayer {
  return {
    group: new Group(),
    layerType: 'SEMANTIC_SEG',
  };
}

describe(ViewerLayerManager.name, () => {
  let manager: ViewerLayerManager;

  beforeEach(() => {
    manager = new ViewerLayerManager();
  });

  it('should register and retrieve a layer by name', () => {
    const layer = createMockLayer();
    manager.register('semantic', layer);
    expect(manager.getLayer('semantic')).toBe(layer);
  });

  it('should return undefined for an unregistered layer', () => {
    expect(manager.getLayer('nonexistent')).toBeUndefined();
  });

  it('should return all registered layers via getLayers()', () => {
    const layerA = createMockLayer();
    const layerB = createMockLayer();
    manager.register('a', layerA);
    manager.register('b', layerB);

    const all = manager.getLayers();
    expect(all).toContain(layerA);
    expect(all).toContain(layerB);
    expect(all).toHaveLength(2);
  });

  it('should return an empty array when no layers are registered', () => {
    expect(manager.getLayers()).toHaveLength(0);
  });
});
