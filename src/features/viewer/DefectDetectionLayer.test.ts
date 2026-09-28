import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Mesh } from 'three';
import type { MeshBasicMaterial } from 'three';
import { DefectDetectionLayer } from './DefectDetectionLayer';
import { createMockDefectDetection, createMockManualDefectDetection } from '../../__mocks__/defectDetections';

describe(DefectDetectionLayer.name, () => {
  let layer: DefectDetectionLayer;

  beforeEach(() => {
    layer = new DefectDetectionLayer();
  });

  it('should expose a group object', () => {
    expect(layer.group).toBeDefined();
  });

  it('should have an empty group after construction', () => {
    expect(layer.group.children).toHaveLength(0);
  });

  describe('update', () => {
    it('should have no children after update([])', () => {
      layer.update([]);
      expect(layer.group.children).toHaveLength(0);
    });

    it('should add ring, disc, and hit mesh for each defect', () => {
      layer.update([createMockDefectDetection()]);
      // ring + disc + hit mesh = at least 3 children
      expect(layer.group.children.length).toBeGreaterThanOrEqual(3);
    });

    it('should add correct number of hit meshes for multiple defects', () => {
      layer.update([
        createMockDefectDetection({ externalId: 'defect-001' }),
        createMockDefectDetection({ externalId: 'defect-002' }),
      ]);
      expect(layer.getHitMeshes()).toHaveLength(2);
    });

    it('should replace previous children on second update call', () => {
      layer.update([createMockDefectDetection()]);
      expect(layer.group.children.length).toBeGreaterThan(0);

      layer.update([]);
      expect(layer.group.children).toHaveLength(0);
    });

    it('should dispose geometry and materials from the previous batch on update', () => {
      layer.update([createMockDefectDetection()]);
      const firstChildren = [...layer.group.children] as Mesh[];
      const geoSpies = firstChildren.map((c) => vi.spyOn(c.geometry, 'dispose'));
      const matSpies = firstChildren.map((c) => vi.spyOn(c.material as MeshBasicMaterial, 'dispose'));

      layer.update([]);

      geoSpies.forEach((spy) => expect(spy).toHaveBeenCalled());
      matSpies.forEach((spy) => expect(spy).toHaveBeenCalled());
    });

    it('should position the hit mesh at the bounding box centre', () => {
      const defect = createMockDefectDetection({ boundingBox3d: [5, 6, 7, 0.1, 0.1, 0.1, 0, 0, 0] });
      layer.update([defect]);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.position.x).toBeCloseTo(5);
      expect(hitMesh.position.y).toBeCloseTo(6);
      expect(hitMesh.position.z).toBeCloseTo(7);
    });

    it('should use normal3d for ring orientation when provided', () => {
      // Manual defect with a known normal — rings should not be in default orientation
      const defect = createMockManualDefectDetection({ normal3d: [0, 0, 1] });
      expect(() => layer.update([defect])).not.toThrow();
    });

    it('should fall back gracefully when normal3d is absent', () => {
      const defect = createMockDefectDetection();
      expect(() => layer.update([defect])).not.toThrow();
    });
  });

  describe('getHitMeshes', () => {
    it('should return empty array when no defects are loaded', () => {
      expect(layer.getHitMeshes()).toHaveLength(0);
    });

    it('should return one hit mesh per defect', () => {
      layer.update([
        createMockDefectDetection({ externalId: 'defect-001' }),
        createMockDefectDetection({ externalId: 'defect-002' }),
      ]);
      expect(layer.getHitMeshes()).toHaveLength(2);
    });

    it('should store defectExternalId in hit mesh userData', () => {
      const defect = createMockDefectDetection({ externalId: 'defect-xyz' });
      layer.update([defect]);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.userData).toMatchObject({ defectExternalId: 'defect-xyz' });
    });

    it('should return empty array after update([])', () => {
      layer.update([createMockDefectDetection()]);
      layer.update([]);
      expect(layer.getHitMeshes()).toHaveLength(0);
    });
  });

  describe('externalIdForMesh', () => {
    it('should return the externalId for a known hit mesh', () => {
      const defect = createMockDefectDetection({ externalId: 'defect-abc' });
      layer.update([defect]);
      const [hitMesh] = layer.getHitMeshes();
      expect(layer.externalIdForMesh(hitMesh)).toBe('defect-abc');
    });

    it('should return undefined for an unknown mesh', () => {
      const unknown = new Mesh();
      expect(layer.externalIdForMesh(unknown)).toBeUndefined();
    });
  });

  /** Find ring/disc meshes that are currently visible (mesh.visible AND material.visible). */
  function visibleRingMeshes(): Mesh[] {
    return layer.group.children.filter(
      (c): c is Mesh =>
        c instanceof Mesh &&
        c.visible &&
        (c.material as MeshBasicMaterial).visible !== false,
    );
  }

  describe('setSelectedId', () => {
    it('should make ring visible and set colour to cyan (0x00aaff) for the matched defect', () => {
      const defect = createMockDefectDetection({ externalId: 'defect-001' });
      layer.update([defect]);

      layer.setSelectedId('defect-001');

      const visible = visibleRingMeshes();
      expect(visible.length).toBeGreaterThan(0);
      expect((visible[0].material as MeshBasicMaterial).color.getHex()).toBe(0x00aaff);
    });

    it('should hide all rings when called with null', () => {
      const defect = createMockDefectDetection({ externalId: 'defect-001' });
      layer.update([defect]);
      layer.setSelectedId('defect-001');

      layer.setSelectedId(null);

      expect(visibleRingMeshes()).toHaveLength(0);
    });

    it('should hide all rings immediately after update (no selection)', () => {
      layer.update([createMockDefectDetection()]);
      expect(visibleRingMeshes()).toHaveLength(0);
    });

    it('should be a no-op on an empty layer', () => {
      expect(() => layer.setSelectedId('defect-001')).not.toThrow();
    });
  });

  describe('setHoveredId', () => {
    it('should make ring visible and set colour to light red (0xff6060) for the hovered defect', () => {
      const defect = createMockDefectDetection({ externalId: 'defect-001' });
      layer.update([defect]);

      layer.setHoveredId('defect-001');

      const visible = visibleRingMeshes();
      expect(visible.length).toBeGreaterThan(0);
      expect((visible[0].material as MeshBasicMaterial).color.getHex()).toBe(0xff6060);
    });

    it('should hide ring when hover is cleared', () => {
      const defect = createMockDefectDetection({ externalId: 'defect-001' });
      layer.update([defect]);
      layer.setHoveredId('defect-001');

      layer.setHoveredId(null);

      expect(visibleRingMeshes()).toHaveLength(0);
    });

    it('should prioritise selected over hovered when both match', () => {
      const defect = createMockDefectDetection({ externalId: 'defect-001' });
      layer.update([defect]);

      layer.setSelectedId('defect-001');
      layer.setHoveredId('defect-001');

      const visible = visibleRingMeshes();
      expect(visible.length).toBeGreaterThan(0);
      // selected takes priority → cyan
      expect((visible[0].material as MeshBasicMaterial).color.getHex()).toBe(0x00aaff);
    });

    it('should be a no-op on an empty layer', () => {
      expect(() => layer.setHoveredId('defect-001')).not.toThrow();
    });
  });
});
