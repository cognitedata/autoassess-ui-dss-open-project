import { Group } from 'three';
import type { Mesh, Points } from 'three';
import type { IViewerLayer } from './IViewerLayer';
import type { LayerType } from './LayerType';

/**
 * Wraps all loaded PLY mesh/point-cloud objects in a single Group so the
 * model can be toggled as a unit through the layer visibility store.
 */
export class MeshLayer implements IViewerLayer {
  readonly group: Group = new Group();
  readonly layerType: LayerType = 'MESH';

  add(object: Mesh | Points): void {
    this.group.add(object);
  }
}
