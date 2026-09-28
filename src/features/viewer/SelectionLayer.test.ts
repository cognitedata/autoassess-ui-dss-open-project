import { describe, it, expect, vi } from 'vitest';
import { Mesh, Quaternion, Vector3 } from 'three';
import type { MeshBasicMaterial } from 'three';
import { SelectionLayer, REGION_CIRCLE_RADIUS_M } from './SelectionLayer';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';

describe(SelectionLayer.name, () => {
  it('should expose a group object', () => {
    const layer = new SelectionLayer();
    expect(layer.group).toBeDefined();
  });

  describe('setRegionHit', () => {
    it('should add Mesh objects to the group', () => {
      const layer = new SelectionLayer();
      layer.setRegionHit(new Vector3(1, 2, 3), new Vector3(0, 0, 1));
      expect(layer.group.children.length).toBeGreaterThan(0);
      expect(layer.group.children.every((c) => c instanceof Mesh)).toBe(true);
    });

    it('should clear previous selection before setting new one', () => {
      const layer = new SelectionLayer();
      layer.setRegionHit(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      const firstRing = layer.group.children[0] as Mesh;
      const geoSpy = vi.spyOn(firstRing.geometry, 'dispose');
      layer.setRegionHit(new Vector3(1, 1, 1), new Vector3(0, 0, 1));
      expect(geoSpy).toHaveBeenCalled();
    });

    it('should orient meshes to the surface normal when normal is not (0,0,1)', () => {
      const layer = new SelectionLayer();
      layer.setRegionHit(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
      const ring = layer.group.children[0] as Mesh;
      // Rotating from (0,0,1) to (0,1,0) produces a non-identity quaternion (w ≠ 1)
      expect(ring.quaternion.w).not.toBeCloseTo(1);
    });

    it('should leave quaternion as identity when normal is (0,0,1)', () => {
      const layer = new SelectionLayer();
      layer.setRegionHit(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      const ring = layer.group.children[0] as Mesh;
      const identity = new Quaternion();
      expect(ring.quaternion.x).toBeCloseTo(identity.x);
      expect(ring.quaternion.y).toBeCloseTo(identity.y);
      expect(ring.quaternion.z).toBeCloseTo(identity.z);
      expect(ring.quaternion.w).toBeCloseTo(identity.w);
    });

    it('should use the default REGION_CIRCLE_RADIUS_M when no radius is provided', () => {
      expect(REGION_CIRCLE_RADIUS_M).toBeGreaterThan(0);
    });
  });

  describe('setElementHit', () => {
    it('should not add any visual geometry (element sphere is shown by SemanticLayer)', () => {
      const layer = new SelectionLayer();
      layer.setElementHit(createMockStructuralElement({ center: [5, 6, 7] }));
      expect(layer.group.children).toHaveLength(0);
    });

    it('should clear any previous region hit when an element is hit', () => {
      const layer = new SelectionLayer();
      layer.setRegionHit(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      const ringMesh = layer.group.children[0] as Mesh;
      const geoSpy = vi.spyOn(ringMesh.geometry, 'dispose');
      layer.setElementHit(createMockStructuralElement());
      expect(geoSpy).toHaveBeenCalled();
      expect(layer.group.children).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should remove all objects from the group', () => {
      const layer = new SelectionLayer();
      layer.setRegionHit(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      layer.clear();
      expect(layer.group.children).toHaveLength(0);
    });

    it('should dispose geometries and materials of cleared objects', () => {
      const layer = new SelectionLayer();
      layer.setRegionHit(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      const mesh = layer.group.children[0] as Mesh;
      const geoSpy = vi.spyOn(mesh.geometry, 'dispose');
      const matSpy = vi.spyOn(mesh.material as MeshBasicMaterial, 'dispose');
      layer.clear();
      expect(geoSpy).toHaveBeenCalled();
      expect(matSpy).toHaveBeenCalled();
    });
  });
});
