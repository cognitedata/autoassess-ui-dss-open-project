import type { CogniteClient } from '@cognite/sdk';

import type {
  Area,
  ElementType,
  InspectionPlan,
  InspectionTask,
  InspectionType,
  PlanStatus,
  SandboxSnapshot,
  StructuralElement,
  TaskKind,
  Vec3,
  Vessel,
} from '../domain/types';
import {
  AREA_CONTAINER,
  AREA_VIEW,
  getContainerProperty,
  getViewKey,
  INSPECTION_PLAN_CONTAINER,
  INSPECTION_PLAN_VIEW,
  INSPECTION_TASK_VIEW,
  STRUCTURAL_ELEMENT_VIEW,
  VESSEL_CONTAINER,
  VESSEL_VIEW,
} from './cdfModel';
import type { ContainerRef, ViewRef } from './cdfModel';
import type { SnapshotSource } from './SnapshotSource';
import { withAreaBounds } from './SnapshotSource';

type ListParams = Parameters<CogniteClient['instances']['list']>[0];
type ListResponse = Awaited<ReturnType<CogniteClient['instances']['list']>>;
type Filter = NonNullable<ListParams['filter']>;
type Item = ListResponse['items'][number];

/**
 * The only CDF capability the sandbox gets: listing instances. Deliberately narrower than
 * CogniteClient so the sandbox is read-only by construction (no upsert/delete reachable).
 */
export interface InstanceReader {
  list(params: ListParams): Promise<ListResponse>;
}

export interface CdfReader {
  readonly project: string;
  readonly instances: InstanceReader;
}

/** Page size for instances.list (DMS max is 1000). */
export const PAGE_SIZE = 1000;
/** Hard cap per view so a huge project can't make the sandbox fetch forever. */
export const MAX_PAGES = 20;

export function createCdfSnapshotSource(
  client: CdfReader,
  now: () => Date = () => new Date(),
): SnapshotSource {
  return new CdfSnapshotSource(client, now);
}

class CdfSnapshotSource implements SnapshotSource {
  readonly mode = 'live' as const;
  readonly label: string;

  constructor(
    private readonly client: CdfReader,
    private readonly now: () => Date,
  ) {
    this.label = `CDF project ${client.project} (read-only)`;
  }

  async load(): Promise<SandboxSnapshot> {
    // Sequential on purpose: five small paginated reads, gentle on DMS concurrency limits.
    const vessels = (await this.listAll(VESSEL_VIEW, notDeleted(VESSEL_CONTAINER))).map(mapVessel);
    const areas = (await this.listAll(AREA_VIEW, notDeleted(AREA_CONTAINER))).map(mapArea);
    const plans = (await this.listAll(INSPECTION_PLAN_VIEW, notDeleted(INSPECTION_PLAN_CONTAINER))).map(
      mapPlan,
    );
    const elements = (await this.listAll(STRUCTURAL_ELEMENT_VIEW)).map(mapElement);
    const elementsById = new Map(elements.map((e) => [e.externalId, e]));
    const planIds = new Set(plans.map((p) => p.externalId));
    const tasks = (await this.listAll(INSPECTION_TASK_VIEW))
      .map((item) => mapTask(item, elementsById))
      .filter((t) => planIds.has(t.planExternalId));

    return {
      mode: this.mode,
      sourceLabel: this.label,
      loadedAt: this.now().toISOString(),
      vessels,
      areas: withAreaBounds(areas, elements),
      plans: plans.sort((a, b) => b.createdTime - a.createdTime),
      tasks,
      elements,
    };
  }

  private async listAll(view: ViewRef, filter?: Filter): Promise<Props[]> {
    const out: Props[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.client.instances.list({
        instanceType: 'node',
        sources: [{ source: { type: 'view', ...view } }],
        ...(filter ? { filter } : {}),
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      for (const item of response.items) {
        if (item.instanceType === 'node') out.push(toProps(item, view));
      }
      cursor = response.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return out;
  }
}

/** A node flattened to its identity plus the property group of one view. */
interface Props {
  space: string;
  externalId: string;
  createdTime: number;
  p: Record<string, unknown>;
}

function toProps(item: Item, view: ViewRef): Props {
  const group = item.properties?.[view.space]?.[getViewKey(view)];
  return {
    space: item.space,
    externalId: item.externalId,
    createdTime: item.createdTime,
    p: (group ?? {}) as Record<string, unknown>,
  };
}

function notDeleted(container: ContainerRef): Filter {
  return { not: { exists: { property: getContainerProperty(container, 'deletedAt') } } };
}

function mapVessel({ space, externalId, p }: Props): Vessel {
  return { space, externalId, name: str(p['name']) ?? '', vesselType: str(p['vesselType']) ?? '' };
}

function mapArea({ space, externalId, p }: Props): Omit<Area, 'bounds'> {
  return {
    space,
    externalId,
    name: str(p['name']) ?? '',
    areaType: str(p['areaType']) ?? '',
    vesselExternalId: refId(p['vessel']) ?? '',
  };
}

const PLAN_STATUSES = new Set<string>(['Draft', 'Ready', 'Complete']);
const TASK_KINDS = new Set<string>(['element', 'region']);
const INSPECTION_TYPES = new Set<string>(['visual', 'ndt_thickness']);
const ELEMENT_TYPES = new Set<string>(['manhole', 'longitudinal', 'wall', 'compartment']);

function mapPlan({ space, externalId, createdTime, p }: Props): InspectionPlan {
  const status = str(p['status']) ?? 'Draft';
  return {
    space,
    externalId,
    areaExternalId: refId(p['area']) ?? '',
    status: (PLAN_STATUSES.has(status) ? status : 'Draft') as PlanStatus,
    createdTime,
    name: str(p['name']) || null,
    description: str(p['description']) || null,
    mapExternalId: refId(p['map']),
  };
}

function mapElement({ space, externalId, p }: Props): StructuralElement {
  const type = str(p['elementType']) ?? '';
  return {
    space,
    externalId,
    areaExternalId: refId(p['area']) ?? '',
    elementType: (ELEMENT_TYPES.has(type) ? type : 'longitudinal') as ElementType,
    label: num(p['label']) ?? 0,
    center: [num(p['centerX']) ?? 0, num(p['centerY']) ?? 0, num(p['centerZ']) ?? 0],
  };
}

function mapTask(
  { space, externalId, p }: Props,
  elementsById: Map<string, StructuralElement>,
): InspectionTask {
  // Same defaults as the real SDK (plan_service.py _map_task_node).
  const kindRaw = str(p['taskType']) ?? 'region';
  const kind = (TASK_KINDS.has(kindRaw) ? kindRaw : 'region') as TaskKind;
  const typeRaw = str(p['inspectionType']) ?? 'visual';
  const element = kind === 'element' ? elementsById.get(refId(p['targetElement']) ?? '') : undefined;
  return {
    space,
    externalId,
    planExternalId: refId(p['plan']) ?? '',
    kind,
    inspectionType: (INSPECTION_TYPES.has(typeRaw) ? typeRaw : 'visual') as InspectionType,
    targetElement: element
      ? { externalId: element.externalId, elementType: element.elementType, center: element.center }
      : null,
    position3d: vec3(p['position3d']),
    normalVector: vec3(p['normalVector']),
    radiusM: num(p['radiusM']),
  };
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function refId(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return null;
  const id = (v as { externalId?: unknown }).externalId;
  return typeof id === 'string' ? id : null;
}

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v.map(num);
  return x !== null && y !== null && z !== null ? [x, y, z] : null;
}

