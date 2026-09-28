import { describe, it, expect, beforeEach } from 'vitest';
import { MeshBasicMaterial } from 'three';
import { ImageLayer } from './ImageLayer';
import { createMockDroneImage } from '../../__mocks__/droneImages';
import type { DroneImage } from './DroneImageService';

describe(ImageLayer.name, () => {
  let layer: ImageLayer;

  beforeEach(() => {
    layer = new ImageLayer();
  });

  describe('update', () => {
    it('should start with zero images', () => {
      expect(layer.count).toBe(0);
    });

    it('should add one group entry per image', () => {
      const images: DroneImage[] = [createMockDroneImage(), createMockDroneImage()];
      layer.update(images);
      expect(layer.count).toBe(2);
    });

    it('should replace previous images on subsequent update', () => {
      layer.update([createMockDroneImage(), createMockDroneImage()]);
      layer.update([createMockDroneImage()]);
      expect(layer.count).toBe(1);
    });

    it('should add objects to the group', () => {
      layer.update([createMockDroneImage()]);
      // Each image contributes at least: visible sphere, hitMesh, camera, cameraHelper → ≥ 4 children
      expect(layer.group.children.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('getHitMeshes', () => {
    it('should return one mesh per image', () => {
      const images = [createMockDroneImage(), createMockDroneImage(), createMockDroneImage()];
      layer.update(images);
      expect(layer.getHitMeshes()).toHaveLength(3);
    });

    it('should return meshes with correct externalId in userData', () => {
      const img = createMockDroneImage({ externalId: 'test-frame-99' });
      layer.update([img]);
      const hitMeshes = layer.getHitMeshes();
      expect(hitMeshes[0].userData.externalId).toBe('test-frame-99');
    });

    it('should return empty array when no images are loaded', () => {
      expect(layer.getHitMeshes()).toEqual([]);
    });
  });

  describe('setSelectedImageId', () => {
    let images: DroneImage[];

    beforeEach(() => {
      images = [
        createMockDroneImage({ externalId: 'frame-A' }),
        createMockDroneImage({ externalId: 'frame-B' }),
      ];
      layer.update(images);
    });

    it('should set selected image sphere to full opacity', () => {
      layer.setSelectedImageId('frame-A');

      // Find the visible sphere for frame-A (userData.externalId matches and material is transparent)
      const sphere = layer.group.children.find((c) => {
        if (!('userData' in c) || c.userData.externalId !== 'frame-A') return false;
        const mat = (c as import('three').Mesh).material;
        return mat instanceof MeshBasicMaterial && mat.visible !== false;
      }) as import('three').Mesh | undefined;

      expect(sphere).toBeDefined();
      expect(((sphere as import('three').Mesh).material as MeshBasicMaterial).opacity).toBe(1.0);
    });

    it('should leave non-selected spheres at default opacity', () => {
      layer.setSelectedImageId('frame-A');

      const sphereB = layer.group.children.find((c) => {
        if (!('userData' in c) || c.userData.externalId !== 'frame-B') return false;
        const mat = (c as import('three').Mesh).material;
        return mat instanceof MeshBasicMaterial && mat.visible !== false;
      }) as import('three').Mesh | undefined;

      expect(sphereB).toBeDefined();
      expect(((sphereB as import('three').Mesh).material as MeshBasicMaterial).opacity).toBeLessThan(1.0);
    });

    it('should revert to default when cleared with null', () => {
      layer.setSelectedImageId('frame-A');
      layer.setSelectedImageId(null);

      const sphere = layer.group.children.find((c) => {
        if (!('userData' in c) || c.userData.externalId !== 'frame-A') return false;
        const mat = (c as import('three').Mesh).material;
        return mat instanceof MeshBasicMaterial && mat.visible !== false;
      }) as import('three').Mesh | undefined;

      expect(sphere).toBeDefined();
      expect(((sphere as import('three').Mesh).material as MeshBasicMaterial).opacity).toBeLessThan(1.0);
    });
  });

  describe('clearHighlights', () => {
    it('should reset selectedId and activeId to null', () => {
      const images = [createMockDroneImage({ externalId: 'frame-A' })];
      layer.update(images);
      layer.setSelectedImageId('frame-A');
      layer.setActiveFrustumId('frame-A');
      layer.clearHighlights();

      // After clearing, selecting null should not change sphere to selected opacity
      // Verify sphere is back to default opacity
      const sphere = layer.group.children.find((c) => {
        if (!('userData' in c) || c.userData.externalId !== 'frame-A') return false;
        const mat = (c as import('three').Mesh).material;
        return mat instanceof MeshBasicMaterial && mat.visible !== false;
      }) as import('three').Mesh | undefined;

      expect(sphere).toBeDefined();
      expect(((sphere as import('three').Mesh).material as MeshBasicMaterial).opacity).toBeLessThan(1.0);
    });
  });

  describe('setActiveFrustumId', () => {
    it('should not throw when no images are loaded', () => {
      expect(() => layer.setActiveFrustumId('nonexistent')).not.toThrow();
    });

    it('should not throw when called with null', () => {
      layer.update([createMockDroneImage()]);
      expect(() => layer.setActiveFrustumId(null)).not.toThrow();
    });
  });

  describe('layerType', () => {
    it('should be IMAGES', () => {
      expect(layer.layerType).toBe('IMAGES');
    });
  });
});
