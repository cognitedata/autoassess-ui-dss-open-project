import type { Group } from 'three';
import type { LayerType } from './LayerType';

/**
 * A viewer layer contributes a Three.js Group to the scene.
 * Each layer manages its own update cycle with its specific data type —
 * no shared `update` signature is enforced here.
 */
export interface IViewerLayer {
  /** The Three.js Group that will be added to the Reveal scene. */
  readonly group: Group;
  /** Identifies which kind of data this layer renders. */
  readonly layerType: LayerType;
}
