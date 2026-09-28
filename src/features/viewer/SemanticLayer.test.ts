import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Mesh } from 'three';
import type { MeshBasicMaterial } from 'three';
import { SemanticLayer } from './SemanticLayer';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';

describe(SemanticLayer.name, () => {
  let layer: SemanticLayer;

  beforeEach(() => {
    layer = new SemanticLayer();
  });

  it('should expose a group object', () => {
    expect(layer.group).toBeDefined();
  });

  it('should have layerType SEMANTIC_SEG', () => {
    expect(layer.layerType).toBe('SEMANTIC_SEG');
  });

  it('should create one sphere per element after update', () => {
    const elements = [
      createMockStructuralElement({ externalId: 'el-1' }),
      createMockStructuralElement({ externalId: 'el-2', elementType: 'wall' }),
    ];
    layer.update(elements);
    expect(layer.count).toBe(2);
  });

  it('should replace existing spheres when update is called again', () => {
    layer.update([createMockStructuralElement()]);
    layer.update([createMockStructuralElement({ externalId: 'el-new' })]);
    expect(layer.count).toBe(1);
  });

  it('should position spheres at element centers', () => {
    const el = createMockStructuralElement({ center: [1, 2, 3] });
    layer.update([el]);

    // First child is the visible sphere
    const sphere = layer.group.children[0];
    expect(sphere.position.x).toBeCloseTo(1);
    expect(sphere.position.y).toBeCloseTo(2);
    expect(sphere.position.z).toBeCloseTo(3);
  });

  it('should clear all spheres when update is called with empty array', () => {
    layer.update([createMockStructuralElement()]);
    layer.update([]);
    expect(layer.count).toBe(0);
  });

  it('should render spheres as semi-transparent meshes', () => {
    layer.update([createMockStructuralElement()]);

    const sphere = layer.group.children[0] as Mesh;
    const mat = sphere.material as MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeGreaterThan(0);
    expect(mat.opacity).toBeLessThan(1);
  });

  describe('hit meshes', () => {
    it('should return one invisible Mesh per element after update', () => {
      const elements = [
        createMockStructuralElement({ externalId: 'el-1' }),
        createMockStructuralElement({ externalId: 'el-2' }),
      ];
      layer.update(elements);
      const hitMeshes = layer.getHitMeshes();
      expect(hitMeshes).toHaveLength(2);
      expect(hitMeshes.every((m) => m instanceof Mesh)).toBe(true);
    });

    it('should position each hit mesh at the element center', () => {
      const el = createMockStructuralElement({ center: [1, 2, 3] });
      layer.update([el]);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.position.x).toBeCloseTo(1);
      expect(hitMesh.position.y).toBeCloseTo(2);
      expect(hitMesh.position.z).toBeCloseTo(3);
    });

    it('should store externalId and elementType in hit mesh userData', () => {
      const el = createMockStructuralElement({ externalId: 'el-42', elementType: 'manhole' });
      layer.update([el]);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.userData).toMatchObject({ externalId: 'el-42', elementType: 'manhole' });
    });

    it('should return empty array after update([])', () => {
      layer.update([createMockStructuralElement()]);
      layer.update([]);
      expect(layer.getHitMeshes()).toHaveLength(0);
    });

    it('should dispose hit mesh geometry and material on update([])', () => {
      layer.update([createMockStructuralElement()]);
      const [hitMesh] = layer.getHitMeshes();
      const geoSpy = vi.spyOn(hitMesh.geometry, 'dispose');
      const matSpy = vi.spyOn(hitMesh.material as MeshBasicMaterial, 'dispose');
      layer.update([]);
      expect(geoSpy).toHaveBeenCalled();
      expect(matSpy).toHaveBeenCalled();
    });
  });

  describe('setSelectedElementId', () => {
    it('should make the selected sphere fully opaque', () => {
      layer.update([createMockStructuralElement({ externalId: 'el-1' })]);

      layer.setSelectedElementId('el-1');

      const sphere = layer.group.children[0] as Mesh;
      expect((sphere.material as MeshBasicMaterial).opacity).toBe(1.0);
    });

    it('should revert previously selected sphere to default opacity when selection moves', () => {
      layer.update([
        createMockStructuralElement({ externalId: 'el-1' }),
        createMockStructuralElement({ externalId: 'el-2' }),
      ]);
      layer.setSelectedElementId('el-2'); // el-2 selected first

      layer.setSelectedElementId('el-1'); // selection moves to el-1

      const el2Sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-2',
      )!;
      expect((el2Sphere.material as MeshBasicMaterial).opacity).toBe(0.5);
    });

    it('should revert all spheres to default opacity when called with null', () => {
      layer.update([createMockStructuralElement({ externalId: 'el-1' })]);
      layer.setSelectedElementId('el-1');

      layer.setSelectedElementId(null);

      const sphere = layer.group.children[0] as Mesh;
      expect((sphere.material as MeshBasicMaterial).opacity).toBe(0.5);
    });

    it('should restore selection after update if element is still present', () => {
      layer.update([createMockStructuralElement({ externalId: 'el-1' })]);
      layer.setSelectedElementId('el-1');

      layer.update([createMockStructuralElement({ externalId: 'el-1' })]);

      const sphere = layer.group.children[0] as Mesh;
      expect((sphere.material as MeshBasicMaterial).opacity).toBe(1.0);
    });

    it('should be a no-op on an empty layer', () => {
      expect(() => layer.setSelectedElementId('el-1')).not.toThrow();
    });
  });

  describe('setActivePlanElementIds', () => {
    it('should highlight sphere of elements in the set with amber colour', () => {
      const el = createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' });
      layer.update([el]);

      layer.setActivePlanElementIds(new Set(['el-1']));

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-1',
      )!;
      const mat = sphere.material as MeshBasicMaterial;
      expect(mat.color.getHex()).toBe(0xff9000);
    });

    it('should revert sphere colour for elements not in the set', () => {
      const el = createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' });
      layer.update([el]);
      layer.setActivePlanElementIds(new Set(['el-1']));

      layer.setActivePlanElementIds(new Set());

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-1',
      )!;
      const mat = sphere.material as MeshBasicMaterial;
      expect(mat.color.getHex()).not.toBe(0xff9000);
    });

    it('should highlight only matching elements when multiple are in the layer', () => {
      layer.update([
        createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' }),
        createMockStructuralElement({ externalId: 'el-2', elementType: 'manhole' }),
      ]);

      layer.setActivePlanElementIds(new Set(['el-1']));

      const visibleSpheres = layer.group.children.filter(
        (c): c is Mesh =>
          c instanceof Mesh && (c.material as MeshBasicMaterial).visible !== false,
      ) as Mesh[];
      const el1Sphere = visibleSpheres.find((s) => s.userData['externalId'] === 'el-1')!;
      const el2Sphere = visibleSpheres.find((s) => s.userData['externalId'] === 'el-2')!;
      expect((el1Sphere.material as MeshBasicMaterial).color.getHex()).toBe(0xff9000);
      expect((el2Sphere.material as MeshBasicMaterial).color.getHex()).not.toBe(0xff9000);
    });

    it('should no-op on empty layer', () => {
      expect(() => layer.setActivePlanElementIds(new Set(['el-1']))).not.toThrow();
    });
  });

  describe('setSelectedPlanTaskElementId', () => {
    it('should change matched sphere colour to cyan (0x00aaff)', () => {
      layer.update([createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' })]);
      layer.setActivePlanElementIds(new Set(['el-1']));

      layer.setSelectedPlanTaskElementId('el-1');

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-1',
      )!;
      expect((sphere.material as MeshBasicMaterial).color.getHex()).toBe(0x00aaff);
    });

    it('should revert to amber when cleared and element is still in active plan', () => {
      layer.update([createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' })]);
      layer.setActivePlanElementIds(new Set(['el-1']));
      layer.setSelectedPlanTaskElementId('el-1');

      layer.setSelectedPlanTaskElementId(null);

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-1',
      )!;
      expect((sphere.material as MeshBasicMaterial).color.getHex()).toBe(0xff9000);
    });

    it('should revert to class colour when cleared and element is not in active plan', () => {
      const el = createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' });
      layer.update([el]);
      layer.setSelectedPlanTaskElementId('el-1');

      layer.setSelectedPlanTaskElementId(null);

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-1',
      )!;
      // Wall class colour is yellow (0xffe66d)
      expect((sphere.material as MeshBasicMaterial).color.getHex()).toBe(0xffe66d);
    });

    it('selected colour (cyan) beats amber when setActivePlanElementIds is called after', () => {
      layer.update([createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' })]);
      layer.setSelectedPlanTaskElementId('el-1');

      layer.setActivePlanElementIds(new Set(['el-1']));

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-1',
      )!;
      expect((sphere.material as MeshBasicMaterial).color.getHex()).toBe(0x00aaff);
    });

    it('should not affect non-matching spheres', () => {
      layer.update([
        createMockStructuralElement({ externalId: 'el-1', elementType: 'wall' }),
        createMockStructuralElement({ externalId: 'el-2', elementType: 'manhole' }),
      ]);
      layer.setActivePlanElementIds(new Set(['el-1', 'el-2']));

      layer.setSelectedPlanTaskElementId('el-1');

      const el2Sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'el-2',
      )!;
      expect((el2Sphere.material as MeshBasicMaterial).color.getHex()).toBe(0xff9000);
    });

    it('should no-op on empty layer', () => {
      expect(() => layer.setSelectedPlanTaskElementId('el-1')).not.toThrow();
    });
  });
});
