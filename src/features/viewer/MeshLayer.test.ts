import { describe, it, expect } from 'vitest';
import { Mesh, MeshBasicMaterial, BufferGeometry, Points, PointsMaterial } from 'three';
import { MeshLayer } from './MeshLayer';

describe(MeshLayer.name, () => {
  it('should have layerType MESH', () => {
    const layer = new MeshLayer();
    expect(layer.layerType).toBe('MESH');
  });

  it('should expose a Three.js Group', () => {
    const layer = new MeshLayer();
    expect(layer.group).toBeDefined();
  });

  it('add() appends a Mesh object to the group', () => {
    const layer = new MeshLayer();
    const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    layer.add(mesh);
    expect(layer.group.children).toContain(mesh);
  });

  it('add() appends a Points object to the group', () => {
    const layer = new MeshLayer();
    const points = new Points(new BufferGeometry(), new PointsMaterial());
    layer.add(points);
    expect(layer.group.children).toContain(points);
  });

  it('add() accumulates multiple objects', () => {
    const layer = new MeshLayer();
    const a = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    const b = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    layer.add(a);
    layer.add(b);
    expect(layer.group.children).toHaveLength(2);
  });

});
