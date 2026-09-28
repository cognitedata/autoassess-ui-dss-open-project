import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Mesh } from 'three';
import type { MeshBasicMaterial } from 'three';
import { NdtMeasurementLayer } from './NdtMeasurementLayer';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';

describe(NdtMeasurementLayer.name, () => {
  let layer: NdtMeasurementLayer;

  beforeEach(() => {
    layer = new NdtMeasurementLayer();
  });

  it('should expose a group object', () => {
    expect(layer.group).toBeDefined();
  });

  it('should have layerType NDT_MEASUREMENTS', () => {
    expect(layer.layerType).toBe('NDT_MEASUREMENTS');
  });

  it('should create one sphere per measurement after update', () => {
    const measurements = [
      createMockNdtMeasurement({ externalId: 'ndt-1' }),
      createMockNdtMeasurement({ externalId: 'ndt-2' }),
    ];
    layer.update(measurements);
    expect(layer.count).toBe(2);
  });

  it('should replace existing spheres when update is called again', () => {
    layer.update([createMockNdtMeasurement()]);
    layer.update([createMockNdtMeasurement({ externalId: 'ndt-new' })]);
    expect(layer.count).toBe(1);
  });

  it('should position spheres at measurement positions', () => {
    const m = createMockNdtMeasurement({ position3d: [1, 2, 3] });
    layer.update([m]);

    // First child is the visible sphere
    const sphere = layer.group.children[0];
    expect(sphere.position.x).toBeCloseTo(1);
    expect(sphere.position.y).toBeCloseTo(2);
    expect(sphere.position.z).toBeCloseTo(3);
  });

  it('should clear all spheres when update is called with empty array', () => {
    layer.update([createMockNdtMeasurement()]);
    layer.update([]);
    expect(layer.count).toBe(0);
  });

  it('should render spheres as semi-transparent meshes', () => {
    layer.update([createMockNdtMeasurement()]);

    const sphere = layer.group.children[0] as Mesh;
    const mat = sphere.material as MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeGreaterThan(0);
    expect(mat.opacity).toBeLessThan(1);
  });

  describe('getHitMeshes', () => {
    it('should return one hit mesh per measurement after update', () => {
      const measurements = [
        createMockNdtMeasurement({ externalId: 'ndt-1' }),
        createMockNdtMeasurement({ externalId: 'ndt-2' }),
      ];
      layer.update(measurements);
      const hitMeshes = layer.getHitMeshes();
      expect(hitMeshes).toHaveLength(2);
      expect(hitMeshes.every((m) => m instanceof Mesh)).toBe(true);
    });

    it('should position each hit mesh at the measurement position', () => {
      const m = createMockNdtMeasurement({ position3d: [4, 5, 6] });
      layer.update([m]);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.position.x).toBeCloseTo(4);
      expect(hitMesh.position.y).toBeCloseTo(5);
      expect(hitMesh.position.z).toBeCloseTo(6);
    });

    it('should store externalId and campaignExternalId in hit mesh userData', () => {
      const m = createMockNdtMeasurement({
        externalId: 'ndt-42',
        campaignExternalId: 'campaign-99',
      });
      layer.update([m]);
      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.userData).toMatchObject({
        externalId: 'ndt-42',
        campaignExternalId: 'campaign-99',
      });
    });

    it('should return empty array after update([])', () => {
      layer.update([createMockNdtMeasurement()]);
      layer.update([]);
      expect(layer.getHitMeshes()).toHaveLength(0);
    });

    it('should dispose hit mesh geometry and material on update([])', () => {
      layer.update([createMockNdtMeasurement()]);
      const [hitMesh] = layer.getHitMeshes();
      const geoSpy = vi.spyOn(hitMesh.geometry, 'dispose');
      const matSpy = vi.spyOn(hitMesh.material as MeshBasicMaterial, 'dispose');
      layer.update([]);
      expect(geoSpy).toHaveBeenCalled();
      expect(matSpy).toHaveBeenCalled();
    });
  });

  describe('setSelectedMeasurementId', () => {
    it('should make the selected sphere fully opaque', () => {
      layer.update([createMockNdtMeasurement({ externalId: 'ndt-1' })]);

      layer.setSelectedMeasurementId('ndt-1');

      const sphere = layer.group.children[0] as Mesh;
      expect((sphere.material as MeshBasicMaterial).opacity).toBe(1.0);
    });

    it('should revert previously selected sphere to default opacity when selection moves', () => {
      layer.update([
        createMockNdtMeasurement({ externalId: 'ndt-1' }),
        createMockNdtMeasurement({ externalId: 'ndt-2' }),
      ]);
      layer.setSelectedMeasurementId('ndt-2');

      layer.setSelectedMeasurementId('ndt-1');

      const ndt2Sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'ndt-2',
      )!;
      expect((ndt2Sphere.material as MeshBasicMaterial).opacity).toBe(0.5);
    });

    it('should revert all spheres to default opacity when called with null', () => {
      layer.update([createMockNdtMeasurement({ externalId: 'ndt-1' })]);
      layer.setSelectedMeasurementId('ndt-1');

      layer.setSelectedMeasurementId(null);

      const sphere = layer.group.children[0] as Mesh;
      expect((sphere.material as MeshBasicMaterial).opacity).toBe(0.5);
    });

    it('should restore selection after update if measurement is still present', () => {
      layer.update([createMockNdtMeasurement({ externalId: 'ndt-1' })]);
      layer.setSelectedMeasurementId('ndt-1');

      layer.update([createMockNdtMeasurement({ externalId: 'ndt-1' })]);

      const sphere = layer.group.children[0] as Mesh;
      expect((sphere.material as MeshBasicMaterial).opacity).toBe(1.0);
    });

    it('should be a no-op on an empty layer', () => {
      expect(() => layer.setSelectedMeasurementId('ndt-1')).not.toThrow();
    });
  });

  describe('syncCampaignVisibility', () => {
    it('should show spheres whose campaign is visible', () => {
      layer.update([
        createMockNdtMeasurement({ externalId: 'ndt-1', campaignExternalId: 'camp-A' }),
      ]);

      layer.syncCampaignVisibility((id) => id === 'camp-A');

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'ndt-1',
      )!;
      expect(sphere.visible).toBe(true);
    });

    it('should hide spheres whose campaign is not visible', () => {
      layer.update([
        createMockNdtMeasurement({ externalId: 'ndt-1', campaignExternalId: 'camp-A' }),
      ]);

      layer.syncCampaignVisibility(() => false);

      const sphere = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'ndt-1',
      )!;
      expect(sphere.visible).toBe(false);
    });

    it('should hide hit meshes for invisible campaigns so they are not raycastable', () => {
      layer.update([
        createMockNdtMeasurement({ externalId: 'ndt-1', campaignExternalId: 'camp-A' }),
      ]);

      layer.syncCampaignVisibility(() => false);

      const [hitMesh] = layer.getHitMeshes();
      expect(hitMesh.visible).toBe(false);
    });

    it('should independently control spheres from different campaigns', () => {
      layer.update([
        createMockNdtMeasurement({ externalId: 'ndt-1', campaignExternalId: 'camp-A' }),
        createMockNdtMeasurement({ externalId: 'ndt-2', campaignExternalId: 'camp-B' }),
      ]);

      layer.syncCampaignVisibility((id) => id === 'camp-A');

      const sphereA = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'ndt-1',
      )!;
      const sphereB = layer.group.children.find(
        (c): c is Mesh => c instanceof Mesh && c.userData['externalId'] === 'ndt-2',
      )!;
      expect(sphereA.visible).toBe(true);
      expect(sphereB.visible).toBe(false);
    });

    it('should be a no-op on an empty layer', () => {
      expect(() => layer.syncCampaignVisibility(() => true)).not.toThrow();
    });
  });
});
