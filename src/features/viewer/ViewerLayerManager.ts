import type { IViewerLayer } from './IViewerLayer';

export class ViewerLayerManager {
  private readonly layers = new Map<string, IViewerLayer>();

  register(name: string, layer: IViewerLayer): void {
    this.layers.set(name, layer);
  }

  getLayer(name: string): IViewerLayer | undefined {
    return this.layers.get(name);
  }

  getLayers(): IViewerLayer[] {
    return [...this.layers.values()];
  }
}
