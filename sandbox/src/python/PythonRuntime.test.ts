import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InspectionPlan, SandboxSnapshot } from '../domain/types';
import type { MissionResult } from '../sim/simulator';
import type { FromWorker, ToWorker } from './protocol';
import type { PythonRuntime, RunHandlers, WorkerLike } from './PythonRuntime';
import { createWorkerPythonRuntime } from './PythonRuntime';

describe(createWorkerPythonRuntime.name, () => {
  let workers: FakeWorker[];
  let runtime: PythonRuntime;
  let handlers: RunHandlers;

  beforeEach(() => {
    workers = [];
    runtime = createWorkerPythonRuntime({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      indexURL: 'https://app.test/pyodide/',
      timeoutMs: 1000,
      bootTimeoutMs: 5000,
    });
    handlers = { onStdout: vi.fn(), onStderr: vi.fn(), onMission: vi.fn(), onPlanPatch: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should send init with the self-hosted indexURL and resolve when ready', async () => {
    const started = runtime.start(SNAPSHOT);
    workers[0].emit({ type: 'ready' });

    await expect(started).resolves.toBeUndefined();
    expect(workers[0].sent[0]).toEqual({ type: 'init', indexURL: 'https://app.test/pyodide/', snapshot: SNAPSHOT });
  });

  it('should only boot one worker for repeated starts', async () => {
    void runtime.start(SNAPSHOT);
    void runtime.start(SNAPSHOT);

    expect(workers).toHaveLength(1);
  });

  it('should reject start on init-error and boot a new worker on retry', async () => {
    const started = runtime.start(SNAPSHOT);
    workers[0].emit({ type: 'init-error', message: 'no wasm' });

    await expect(started).rejects.toThrow('no wasm');
    expect(workers[0].terminated).toBe(true);
    void runtime.start(SNAPSHOT);
    expect(workers).toHaveLength(2);
  });

  it('should fail start when Python does not boot in time (Pyodide hangs if wasm is blocked)', async () => {
    vi.useFakeTimers();
    const started = runtime.start(SNAPSHOT);
    const assertion = expect(started).rejects.toThrow(/did not start within 5 s/);

    await vi.advanceTimersByTimeAsync(5001);

    await assertion;
    expect(workers[0].terminated).toBe(true);
  });

  it('should route output and missions of the current run, then resolve on done', async () => {
    const result = await bootAndRun(async (w, runId) => {
      w.emit({ type: 'stdout', runId, text: 'hi\n' });
      w.emit({ type: 'stderr', runId, text: 'warn\n' });
      w.emit({ type: 'mission', runId, mission: MISSION });
      w.emit({ type: 'snapshot-patch', runId, plan: PLAN });
      w.emit({ type: 'stdout', runId: runId + 99, text: 'stale\n' });
      w.emit({ type: 'done', runId, outcome: { ok: true } });
    });

    expect(result).toEqual({ ok: true });
    expect(handlers.onStdout).toHaveBeenCalledTimes(1);
    expect(handlers.onStdout).toHaveBeenCalledWith('hi\n');
    expect(handlers.onStderr).toHaveBeenCalledWith('warn\n');
    expect(handlers.onMission).toHaveBeenCalledWith(MISSION);
    expect(handlers.onPlanPatch).toHaveBeenCalledWith(PLAN);
  });

  it('should stop a running script by terminating the worker', async () => {
    const result = await bootAndRun(async () => {
      runtime.stop();
    });

    expect(result).toMatchObject({ ok: false, stopped: true });
    expect(workers[0].terminated).toBe(true);
  });

  it('should time out a long-running script', async () => {
    vi.useFakeTimers();

    const result = await bootAndRun(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });

    expect(result).toMatchObject({ ok: false, timedOut: true, error: 'Stopped: the script ran longer than 1 s' });
    expect(workers[0].terminated).toBe(true);
  });

  it('should resolve the run as an error when the worker crashes', async () => {
    const result = await bootAndRun(async (w) => {
      w.onerror?.(new ErrorEvent('error', { message: 'out of memory' }));
    });

    expect(result).toEqual({ ok: false, error: 'out of memory' });
  });

  it('should forward snapshot updates to a live worker', async () => {
    void runtime.start(SNAPSHOT);
    const updated = { ...SNAPSHOT, sourceLabel: 'new' };

    runtime.updateSnapshot(updated);

    expect(workers[0].sent[1]).toEqual({ type: 'snapshot', snapshot: updated });
  });

  it('should refuse to run before start', async () => {
    await expect(runtime.run('print(1)', handlers)).rejects.toThrow('start()');
  });

  async function bootAndRun(during: (w: FakeWorker, runId: number) => Promise<void>) {
    const started = runtime.start(SNAPSHOT);
    workers[0].emit({ type: 'ready' });
    await started;
    const running = runtime.run('print("hi")', handlers);
    await Promise.resolve();
    await Promise.resolve();
    const runMsg = workers[0].sent.find((m): m is Extract<ToWorker, { type: 'run' }> => m.type === 'run');
    if (!runMsg) throw new Error('run was not posted');
    await during(workers[0], runMsg.runId);
    return running;
  }
});

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: FromWorker): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const SNAPSHOT: SandboxSnapshot = {
  mode: 'demo',
  sourceLabel: 'test',
  loadedAt: '2026-09-26T00:00:00Z',
  vessels: [],
  areas: [],
  plans: [],
  tasks: [],
  elements: [],
};

const MISSION = { planExternalId: 'p' } as MissionResult;

const PLAN: InspectionPlan = {
  space: 's',
  externalId: 'p',
  areaExternalId: 'a',
  status: 'Complete',
  createdTime: 0,
  lastUpdatedTime: 0,
  name: null,
  description: null,
  mapExternalId: null,
};
