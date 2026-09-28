import type { SandboxSnapshot } from '../domain/types';
import { DEMO_AREAS, DEMO_ELEMENTS, DEMO_PLANS, DEMO_TASKS, DEMO_VESSELS } from './demoFixture';
import type { SnapshotSource } from './SnapshotSource';
import { withAreaBounds } from './SnapshotSource';

export function createDemoSnapshotSource(now: () => Date = () => new Date()): SnapshotSource {
  return new DemoSnapshotSource(now);
}

class DemoSnapshotSource implements SnapshotSource {
  readonly mode = 'demo' as const;
  readonly label = 'Demo data (bundled)';

  constructor(private readonly now: () => Date) {}

  async load(): Promise<SandboxSnapshot> {
    // Deep-copy so a run can never mutate the fixtures.
    return structuredClone({
      mode: this.mode,
      sourceLabel: this.label,
      loadedAt: this.now().toISOString(),
      vessels: DEMO_VESSELS,
      areas: withAreaBounds(DEMO_AREAS, DEMO_ELEMENTS),
      plans: DEMO_PLANS,
      tasks: DEMO_TASKS,
      elements: DEMO_ELEMENTS,
    });
  }
}
