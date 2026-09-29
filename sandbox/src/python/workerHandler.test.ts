// @vitest-environment node
// Integration: the worker message handler driving a real Pyodide (no Worker, no browser).
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';

import { createDemoSnapshotSource } from '../data/DemoSnapshotSource';
import type { SandboxSnapshot } from '../domain/types';
import type { FromWorker, ToWorker } from './protocol';
import { PYTHON_FILES } from './pythonFiles';
import { createWorkerHandler } from './workerHandler';

const indexURL = fileURLToPath(new URL('../../node_modules/pyodide/', import.meta.url));

describe(createWorkerHandler.name, () => {
  let messages: FromWorker[];
  let handle: (m: ToWorker) => Promise<void>;
  let snapshot: SandboxSnapshot;

  beforeAll(async () => {
    messages = [];
    snapshot = await createDemoSnapshotSource().load();
    handle = createWorkerHandler({ loadPyodide, files: PYTHON_FILES, post: (m) => messages.push(m), flushIntervalMs: 5 });
    await handle({ type: 'init', indexURL, snapshot });
  }, 60_000);

  it('should report ready after init', () => {
    expect(messages).toContainEqual({ type: 'ready' });
  });

  it('should coalesce output and finish with a done message', async () => {
    messages.length = 0;

    await handle({ type: 'run', runId: 7, code: 'for i in range(3):\n    print(i)' });

    expect(messages).toEqual([
      { type: 'stdout', runId: 7, text: '0\n1\n2\n' },
      { type: 'done', runId: 7, outcome: { ok: true } },
    ]);
  });

  it('should keep stdout/stderr ordering', async () => {
    messages.length = 0;

    await handle({ type: 'run', runId: 8, code: 'import sys\nprint("a")\nprint("b", file=sys.stderr)\nprint("c")' });

    expect(messages.map((m) => m.type)).toEqual(['stdout', 'stderr', 'stdout', 'done']);
  });

  it('should post the latest mission of a burst of flight steps, before done', async () => {
    messages.length = 0;
    const code = [
      'import json',
      'from pathlib import Path',
      'from uidss import UidssClient',
      'from dss_sandbox import SimDrone',
      'c = UidssClient.from_env()',
      'c.plans.download("autoassess", "demo-plan-ndt-sweep", "BWT 3P", Path("p.json"))',
      'sim_drone = SimDrone()',
      'sim_drone.fly_plan("p.json")',
    ].join('\n');

    await handle({ type: 'run', runId: 9, code });

    const missions = messages.filter((m) => m.type === 'mission');
    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({ runId: 9, mission: { planExternalId: 'demo-plan-ndt-sweep', status: 'landed' } });
    expect(messages.at(-1)).toEqual({ type: 'done', runId: 9, outcome: { ok: true } });
  });

  it('should post a snapshot patch when a flown plan is marked Complete (simulated)', async () => {
    messages.length = 0;
    const code = [
      'from uidss import UidssClient',
      'from dss_sandbox import SimDrone',
      'c = UidssClient.from_env()',
      'c.plans.download("autoassess", "demo-plan-ndt-sweep", "BWT 3P", "p.json")',
      'SimDrone().fly_plan("p.json")',
      'c.plans.update_status("autoassess", "demo-plan-ndt-sweep", "Complete")',
    ].join('\n');

    await handle({ type: 'run', runId: 11, code });

    const types = messages.map((m) => m.type);
    expect(types.indexOf('mission')).toBeLessThan(types.indexOf('snapshot-patch'));
    expect(messages.find((m) => m.type === 'snapshot-patch')).toMatchObject({
      runId: 11,
      plan: { externalId: 'demo-plan-ndt-sweep', status: 'Complete' },
    });
    expect(messages.at(-1)).toEqual({ type: 'done', runId: 11, outcome: { ok: true } });
  });

  it('should use an updated snapshot for later runs', async () => {
    messages.length = 0;
    await handle({ type: 'snapshot', snapshot: { ...snapshot, vessels: [] } });

    await handle({ type: 'run', runId: 10, code: 'from uidss import UidssClient\nprint(len(UidssClient.from_env().vessels.list()))' });

    expect(messages[0]).toEqual({ type: 'stdout', runId: 10, text: '0\n' });
  });

  it('should answer a run before init with an error', async () => {
    const early: FromWorker[] = [];
    const fresh = createWorkerHandler({ loadPyodide, files: {}, post: (m) => early.push(m) });

    await fresh({ type: 'run', runId: 1, code: 'print(1)' });

    expect(early).toEqual([{ type: 'done', runId: 1, outcome: { ok: false, error: 'Python is not initialised' } }]);
  });

  it('should report an init failure', async () => {
    const out: FromWorker[] = [];
    const failing = createWorkerHandler({
      loadPyodide: () => Promise.reject(new Error('wasm blocked by CSP')),
      files: {},
      post: (m) => out.push(m),
    });

    await failing({ type: 'init', indexURL, snapshot });

    expect(out).toEqual([{ type: 'init-error', message: 'wasm blocked by CSP' }]);
  });
});
