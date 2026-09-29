import { boundsAround } from '../domain/bounds';
import type { Area, DataSourceMode, SandboxSnapshot, StructuralElement } from '../domain/types';

/** Where the Python SDK's data comes from. Implementations are read-only. */
export interface SnapshotSource {
  readonly mode: DataSourceMode;
  readonly label: string;
  load(): Promise<SandboxSnapshot>;
}

/** Margin (m) around an area's structural elements used as the simulator geofence. */
export const AREA_BOUNDS_MARGIN_M = 0.3;

/** Fills in each area's bounds from its structural elements. */
export function withAreaBounds(areas: Omit<Area, 'bounds'>[], elements: StructuralElement[]): Area[] {
  return areas.map((area) => ({
    ...area,
    bounds: boundsAround(
      elements.filter((e) => e.areaExternalId === area.externalId).map((e) => e.center),
      AREA_BOUNDS_MARGIN_M,
    ),
  }));
}
