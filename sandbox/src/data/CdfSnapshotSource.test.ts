import type { CogniteClient } from '@cognite/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CdfReader, InstanceReader } from './CdfSnapshotSource';
import { createCdfSnapshotSource, MAX_PAGES } from './CdfSnapshotSource';

type ListParams = Parameters<CogniteClient['instances']['list']>[0];
type ListResponse = Awaited<ReturnType<CogniteClient['instances']['list']>>;

describe(createCdfSnapshotSource.name, () => {
  let pages: Record<string, ListResponse[]>;
  let reader: CdfReader;
  let list: ReturnType<typeof vi.fn<InstanceReader['list']>>;

  beforeEach(() => {
    pages = {
      VesselView: [page([node('vessel-1', 'VesselView/2', { name: 'Test Vessel', vesselType: 'tanker' })])],
      AreaView: [
        page([node('area-1', 'AreaView/4', { name: 'BWT 1', areaType: 'BWT', vessel: ref('vessel-1') })]),
      ],
      InspectionPlanView: [
        page([
          node('plan-old', 'InspectionPlanView/4', { area: ref('area-1'), status: 'Ready', name: 'Old' }, 1000),
          node('plan-new', 'InspectionPlanView/4', { area: ref('area-1'), status: 'Bogus', map: ref('result-1') }, 2000),
        ]),
      ],
      StructuralElementView: [
        page([
          node('el-1', 'StructuralElementView/1', {
            area: ref('area-1'), elementType: 'wall', label: 3001, centerX: 1, centerY: 2, centerZ: 3,
          }),
          node('el-2', 'StructuralElementView/1', {
            area: ref('area-1'), elementType: 'manhole', label: 1001, centerX: 5, centerY: -2, centerZ: 0,
          }),
        ]),
      ],
      InspectionTaskView: [
        page(
          [
            node('task-1', 'InspectionTaskView/1', {
              plan: ref('plan-old'), taskType: 'element', inspectionType: 'visual', targetElement: ref('el-1'),
            }),
          ],
          'cursor-2',
        ),
        page([
          node('task-2', 'InspectionTaskView/1', {
            plan: ref('plan-new'), taskType: 'region', inspectionType: 'ndt_thickness',
            position3d: [1, 1, 1], normalVector: [0, 1, 0], radiusM: 0.3,
          }),
          node('task-orphan', 'InspectionTaskView/1', { plan: ref('plan-deleted'), taskType: 'region' }),
        ]),
      ],
    };
    list = vi.fn<InstanceReader['list']>(async (params: ListParams) => {
      const view = viewOf(params);
      const queue = pages[view] ?? [page([])];
      return params.cursor ? queue[1] : queue[0];
    });
    reader = { project: 'autoassess-dev', instances: { list } };
  });

  it('should label itself as a read-only live source for the project', () => {
    const source = createCdfSnapshotSource(reader);

    expect(source.mode).toBe('live');
    expect(source.label).toBe('CDF project autoassess-dev (read-only)');
  });

  it('should only ever touch instances.list (no CDF write endpoint is reachable)', async () => {
    const touched = new Set<string>();
    const guarded: CdfReader = {
      project: reader.project,
      instances: new Proxy(reader.instances, {
        get: (target, prop, receiver) => {
          touched.add(String(prop));
          return Reflect.get(target, prop, receiver);
        },
      }),
    };

    await createCdfSnapshotSource(guarded).load();

    expect([...touched]).toEqual(['list']);
  });

  it('should query each view in the autoassess space and exclude soft-deleted plans', async () => {
    await createCdfSnapshotSource(reader).load();

    const planCall = list.mock.calls.map(([p]) => p).find((p) => viewOf(p) === 'InspectionPlanView');
    expect(planCall).toMatchObject({
      instanceType: 'node',
      limit: 1000,
      sources: [{ source: { type: 'view', space: 'autoassess', externalId: 'InspectionPlanView', version: '4' } }],
      filter: { not: { exists: { property: ['autoassess', 'InspectionPlanContainer', 'deletedAt'] } } },
    });
  });

  it('should map vessels, areas and plans (newest first, invalid status -> Draft)', async () => {
    const snapshot = await createCdfSnapshotSource(reader).load();

    expect(snapshot.vessels).toEqual([
      { space: 'autoassess', externalId: 'vessel-1', name: 'Test Vessel', vesselType: 'tanker' },
    ]);
    expect(snapshot.areas[0]).toMatchObject({ externalId: 'area-1', vesselExternalId: 'vessel-1' });
    expect(snapshot.plans.map((p) => [p.externalId, p.status, p.mapExternalId])).toEqual([
      ['plan-new', 'Draft', 'result-1'],
      ['plan-old', 'Ready', null],
    ]);
  });

  it('should keep the Active plan status (not fall back to Draft)', async () => {
    pages['InspectionPlanView'] = [
      page([node('plan-active', 'InspectionPlanView/4', { area: ref('area-1'), status: 'Active' }, 1500)]),
    ];

    const snapshot = await createCdfSnapshotSource(reader).load();

    expect(snapshot.plans.map((p) => [p.externalId, p.status])).toEqual([['plan-active', 'Active']]);
  });

  it('should map createdTime and lastUpdatedTime from the node system fields', async () => {
    // The bridge's recency key is (lastUpdatedTime, createdTime): both must survive the mapping.
    pages['InspectionPlanView'] = [
      page([node('plan-edited', 'InspectionPlanView/4', { area: ref('area-1'), status: 'Ready' }, 1000, 5000)]),
    ];

    const snapshot = await createCdfSnapshotSource(reader).load();

    expect(snapshot.plans[0]).toMatchObject({ externalId: 'plan-edited', createdTime: 1000, lastUpdatedTime: 5000 });
  });

  it('should follow cursors, resolve element targets and drop tasks of unknown plans', async () => {
    const snapshot = await createCdfSnapshotSource(reader).load();

    expect(snapshot.tasks.map((t) => t.externalId)).toEqual(['task-1', 'task-2']);
    expect(snapshot.tasks[0].targetElement).toEqual({ externalId: 'el-1', elementType: 'wall', center: [1, 2, 3] });
    expect(snapshot.tasks[1]).toMatchObject({ kind: 'region', position3d: [1, 1, 1], radiusM: 0.3 });
  });

  it('should derive area bounds from the structural elements', async () => {
    const snapshot = await createCdfSnapshotSource(reader).load();

    expect(snapshot.areas[0].bounds).toEqual({ min: [0.7, -2.3, -0.3], max: [5.3, 2.3, 3.3] });
  });

  it('should stop paginating after the page cap', async () => {
    list.mockImplementation(async () => page([], 'always-more'));

    await createCdfSnapshotSource(reader).load();

    expect(list).toHaveBeenCalledTimes(5 * MAX_PAGES);
  });

  it('should propagate CDF errors', async () => {
    list.mockRejectedValue(new Error('403 Forbidden'));

    await expect(createCdfSnapshotSource(reader).load()).rejects.toThrow('403 Forbidden');
  });
});

function viewOf(params: ListParams): string {
  const source = params.sources?.[0]?.source;
  return source && 'externalId' in source ? source.externalId : '';
}

function page(items: ListResponse['items'], nextCursor?: string): ListResponse {
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

function ref(externalId: string): { space: string; externalId: string } {
  return { space: 'autoassess', externalId };
}

function node(
  externalId: string,
  viewKey: string,
  props: Record<string, unknown>,
  createdTime = 0,
  lastUpdatedTime = createdTime,
): ListResponse['items'][number] {
  return {
    instanceType: 'node',
    space: 'autoassess',
    externalId,
    version: 1,
    createdTime,
    lastUpdatedTime,
    properties: { autoassess: { [viewKey]: props } },
  } as ListResponse['items'][number];
}
