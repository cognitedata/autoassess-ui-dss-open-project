import { describe, expect, it } from 'vitest';

import { createDemoSnapshotSource } from './DemoSnapshotSource';

describe(createDemoSnapshotSource.name, () => {
  it('should load a demo-mode snapshot with vessels, areas, plans and tasks', async () => {
    const source = createDemoSnapshotSource(() => new Date('2026-09-26T12:00:00Z'));

    const snapshot = await source.load();

    expect(source.mode).toBe('demo');
    expect(snapshot).toMatchObject({ mode: 'demo', loadedAt: '2026-09-26T12:00:00.000Z' });
    expect(snapshot.vessels).toHaveLength(1);
    expect(snapshot.areas.map((a) => a.name)).toEqual(['BWT 3P', 'Cargo Hold 2']);
    expect(snapshot.plans.length).toBeGreaterThanOrEqual(3);
  });

  it('should give every area bounds that contain its structural elements', async () => {
    const snapshot = await createDemoSnapshotSource().load();

    const bwt = snapshot.areas.find((a) => a.name === 'BWT 3P');
    expect(bwt?.bounds?.min[0]).toBeLessThan(-1.3);
    expect(bwt?.bounds?.max[0]).toBeGreaterThan(11.38);
  });

  it('should only reference plans and elements that exist', async () => {
    const snapshot = await createDemoSnapshotSource().load();
    const planIds = new Set(snapshot.plans.map((p) => p.externalId));
    const elementIds = new Set(snapshot.elements.map((e) => e.externalId));

    for (const task of snapshot.tasks) {
      expect(planIds.has(task.planExternalId)).toBe(true);
      if (task.targetElement) expect(elementIds.has(task.targetElement.externalId)).toBe(true);
    }
  });

  it('should return an independent copy on every load', async () => {
    const source = createDemoSnapshotSource();
    const first = await source.load();
    first.plans.length = 0;

    const second = await source.load();

    expect(second.plans.length).toBeGreaterThan(0);
  });
});
