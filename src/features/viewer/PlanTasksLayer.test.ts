import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Mesh } from 'three';
import type { MeshBasicMaterial } from 'three';
import { PlanTasksLayer } from './PlanTasksLayer';
import { createMockElementTask, createMockRegionTask } from '../../__mocks__/inspectionTasks';
import { createMockStructuralElement } from '../../__mocks__/structuralElements';

describe(PlanTasksLayer.name, () => {
  let layer: PlanTasksLayer;

  beforeEach(() => {
    layer = new PlanTasksLayer();
  });

  it('should expose a group object', () => {
    expect(layer.group).toBeDefined();
  });

  it('should have an empty group after construction', () => {
    expect(layer.group.children).toHaveLength(0);
  });

  describe('update', () => {
    it('should have no children after update([])', () => {
      layer.update([], []);
      expect(layer.group.children).toHaveLength(0);
    });

    it('should add ring meshes + hit mesh for a region task', () => {
      const regionTask = createMockRegionTask();
      layer.update([regionTask], []);
      // Expect at least: ring, disc, and hit mesh → 3 children
      expect(layer.group.children.length).toBeGreaterThanOrEqual(3);
    });

    it('should add only a hit mesh for an element task when element is found', () => {
      const el = createMockStructuralElement({ externalId: 'element-3-15' });
      const elementTask = createMockElementTask({ targetElementExternalId: el.externalId });
      layer.update([elementTask], [el]);
      expect(layer.group.children).toHaveLength(1);
    });

    it('should add nothing for an element task when no matching element is found', () => {
      const elementTask = createMockElementTask({ targetElementExternalId: 'not-found' });
      layer.update([elementTask], []);
      expect(layer.group.children).toHaveLength(0);
    });

    it('should replace previous children on second update call', () => {
      layer.update([createMockRegionTask()], []);
      const firstCount = layer.group.children.length;
      expect(firstCount).toBeGreaterThan(0);

      layer.update([], []);
      expect(layer.group.children).toHaveLength(0);
    });

    it('should dispose geometry and materials from the previous batch on update', () => {
      layer.update([createMockRegionTask()], []);
      const firstChildren = [...layer.group.children] as Mesh[];
      const geoSpies = firstChildren.map((c) => vi.spyOn(c.geometry, 'dispose'));
      const matSpies = firstChildren.map((c) => vi.spyOn(c.material as MeshBasicMaterial, 'dispose'));

      layer.update([], []);

      geoSpies.forEach((spy) => expect(spy).toHaveBeenCalled());
      matSpies.forEach((spy) => expect(spy).toHaveBeenCalled());
    });

    it('should position the hit mesh at the region task position', () => {
      const task = createMockRegionTask({ position3d: [5, 6, 7] });
      layer.update([task], []);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.position.x).toBeCloseTo(5);
      expect(hitMesh.position.y).toBeCloseTo(6);
      expect(hitMesh.position.z).toBeCloseTo(7);
    });

    it('should position the hit mesh at the element center for an element task', () => {
      const el = createMockStructuralElement({ externalId: 'el-1', center: [1, 2, 3] });
      const task = createMockElementTask({ targetElementExternalId: 'el-1' });
      layer.update([task], [el]);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.position.x).toBeCloseTo(1);
      expect(hitMesh.position.y).toBeCloseTo(2);
      expect(hitMesh.position.z).toBeCloseTo(3);
    });
  });

  describe('getHitMeshes', () => {
    it('should return empty array when no tasks are loaded', () => {
      expect(layer.getHitMeshes()).toHaveLength(0);
    });

    it('should return one hit mesh per region task', () => {
      layer.update([
        createMockRegionTask({ externalId: 'task-r-1' }),
        createMockRegionTask({ externalId: 'task-r-2' }),
      ], []);
      expect(layer.getHitMeshes()).toHaveLength(2);
    });

    it('should store taskExternalId in hit mesh userData', () => {
      const task = createMockRegionTask({ externalId: 'task-xyz' });
      layer.update([task], []);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.userData).toMatchObject({ taskExternalId: 'task-xyz' });
    });

    it('should return empty array after update([])', () => {
      layer.update([createMockRegionTask()], []);
      layer.update([], []);
      expect(layer.getHitMeshes()).toHaveLength(0);
    });
  });

  describe('setSelectedTaskId', () => {
    it('should change ring colour to cyan (0x00aaff) for the matched region task', () => {
      const task = createMockRegionTask({ externalId: 'task-r-1' });
      layer.update([task], []);

      layer.setSelectedTaskId('task-r-1');

      const ringMesh = layer.group.children.find(
        (c): c is Mesh =>
          c instanceof Mesh && (c.material as MeshBasicMaterial).visible !== false,
      )!;
      expect((ringMesh.material as MeshBasicMaterial).color.getHex()).toBe(0x00aaff);
    });

    it('should revert ring colour to amber (0xff9000) when called with null', () => {
      const task = createMockRegionTask({ externalId: 'task-r-1' });
      layer.update([task], []);
      layer.setSelectedTaskId('task-r-1');

      layer.setSelectedTaskId(null);

      const ringMesh = layer.group.children.find(
        (c): c is Mesh =>
          c instanceof Mesh && (c.material as MeshBasicMaterial).visible !== false,
      )!;
      expect((ringMesh.material as MeshBasicMaterial).color.getHex()).toBe(0xff9000);
    });

    it('should not change colour of non-matching tasks', () => {
      layer.update([
        createMockRegionTask({ externalId: 'task-r-1' }),
        createMockRegionTask({ externalId: 'task-r-2' }),
      ], []);

      layer.setSelectedTaskId('task-r-1');

      // Find the ring mesh belonging to task-r-2 (second set of visible meshes)
      // Both ring meshes should be visible; only task-r-1's should be cyan
      const visibleRings = layer.group.children.filter(
        (c): c is Mesh => c instanceof Mesh && (c.material as MeshBasicMaterial).visible !== false,
      ) as Mesh[];

      const amberRings = visibleRings.filter(
        (m) => (m.material as MeshBasicMaterial).color.getHex() === 0xff9000,
      );
      expect(amberRings.length).toBeGreaterThanOrEqual(1);
    });

    it('should be a no-op on an empty layer', () => {
      expect(() => layer.setSelectedTaskId('task-r-1')).not.toThrow();
    });
  });
});
