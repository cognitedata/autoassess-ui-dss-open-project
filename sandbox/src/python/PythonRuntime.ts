import type { InspectionPlan, SandboxSnapshot } from '../domain/types';
import type { MissionResult } from '../sim/simulator';
import type { FromWorker, ToWorker } from './protocol';
import type { RunOutcome } from './session';

export interface RunHandlers {
  onStdout(text: string): void;
  onStderr(text: string): void;
  /** The flight so far; called again with updates during the same run. */
  onMission(mission: MissionResult): void;
  /** A plan changed by the simulated `plans.update_status` (never written to CDF). */
  onPlanPatch(plan: InspectionPlan): void;
}

export interface RunResult extends RunOutcome {
  stopped?: boolean;
  timedOut?: boolean;
}

/** A Python interpreter the UI can run scripts in. Faked in tests. */
export interface PythonRuntime {
  /** Boots the interpreter (idempotent while one is alive). Rejects if Pyodide fails to load. */
  start(snapshot: SandboxSnapshot): Promise<void>;
  /** Data for subsequent runs. */
  updateSnapshot(snapshot: SandboxSnapshot): void;
  run(code: string, handlers: RunHandlers): Promise<RunResult>;
  /**
   * Stops a running script by killing the interpreter (without cross-origin isolation there is
   * no SharedArrayBuffer to interrupt Python in place). The next start() boots a fresh one.
   */
  stop(): void;
  dispose(): void;
}

/** The parts of a Worker the runtime uses. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface WorkerRuntimeDeps {
  createWorker: () => WorkerLike;
  /** Absolute URL of the directory holding the self-hosted Pyodide files. */
  indexURL: string;
  /** Scripts running longer than this are stopped. */
  timeoutMs: number;
  /**
   * Boot deadline. Pyodide never rejects when WebAssembly is blocked (e.g. CSP without
   * 'wasm-unsafe-eval'); it only logs a warning, so without this the UI would wait forever.
   */
  bootTimeoutMs: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_BOOT_TIMEOUT_MS = 60_000;

export function createWorkerPythonRuntime(overrides: Partial<WorkerRuntimeDeps> = {}): PythonRuntime {
  const deps: WorkerRuntimeDeps = {
    createWorker: () =>
      new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module', name: 'python' }),
    indexURL: new URL('./pyodide/', document.baseURI).href,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    bootTimeoutMs: DEFAULT_BOOT_TIMEOUT_MS,
    ...overrides,
  };
  return new WorkerPythonRuntime(deps);
}

interface PendingRun {
  runId: number;
  handlers: RunHandlers;
  resolve: (result: RunResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

class WorkerPythonRuntime implements PythonRuntime {
  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private pending: PendingRun | null = null;
  private nextRunId = 1;
  private snapshot: SandboxSnapshot | null = null;

  constructor(private readonly deps: WorkerRuntimeDeps) {}

  start(snapshot: SandboxSnapshot): Promise<void> {
    this.snapshot = snapshot;
    if (this.ready) return this.ready;
    const worker = this.deps.createWorker();
    this.worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      const seconds = Math.round(this.deps.bootTimeoutMs / 1000);
      const bootTimer = setTimeout(
        () =>
          reject(
            new Error(
              `Python did not start within ${seconds} s. If the browser console mentions ` +
                "'wasm-unsafe-eval', the app's CSP blocks WebAssembly (see manifest.json).",
            ),
          ),
        this.deps.bootTimeoutMs,
      );
      worker.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === 'ready') {
          clearTimeout(bootTimer);
          resolve();
        } else if (msg.type === 'init-error') {
          clearTimeout(bootTimer);
          reject(new Error(msg.message));
        } else this.onRunMessage(msg);
      };
      worker.onerror = (event) => {
        clearTimeout(bootTimer);
        const error = new Error(event.message || 'Python worker crashed');
        reject(error);
        if (this.worker !== worker) return;
        this.finish({ ok: false, error: error.message });
        this.kill();
      };
    });
    this.ready = ready;
    // A failed boot must not stick: the next start() tries again (unless already replaced).
    ready.catch(() => {
      if (this.ready === ready) this.kill();
    });
    worker.postMessage({ type: 'init', indexURL: this.deps.indexURL, snapshot });
    return ready;
  }

  updateSnapshot(snapshot: SandboxSnapshot): void {
    this.snapshot = snapshot;
    this.worker?.postMessage({ type: 'snapshot', snapshot });
  }

  async run(code: string, handlers: RunHandlers): Promise<RunResult> {
    if (this.pending) throw new Error('A script is already running');
    if (!this.snapshot) throw new Error('start() must be called before run()');
    await this.start(this.snapshot);
    const worker = this.worker;
    if (!worker) return { ok: false, error: 'Python worker is not running' };
    const runId = this.nextRunId++;
    return new Promise<RunResult>((resolve) => {
      const timer = setTimeout(() => {
        const seconds = Math.round(this.deps.timeoutMs / 1000);
        this.finish({ ok: false, timedOut: true, error: `Stopped: the script ran longer than ${seconds} s` });
        this.kill();
      }, this.deps.timeoutMs);
      this.pending = { runId, handlers, resolve, timer };
      worker.postMessage({ type: 'run', runId, code });
    });
  }

  stop(): void {
    this.finish({ ok: false, stopped: true, error: 'Stopped by user' });
    this.kill();
  }

  dispose(): void {
    this.stop();
  }

  private onRunMessage(msg: Exclude<FromWorker, { type: 'ready' } | { type: 'init-error' }>): void {
    const run = this.pending;
    if (!run || msg.runId !== run.runId) return;
    switch (msg.type) {
      case 'stdout':
        run.handlers.onStdout(msg.text);
        break;
      case 'stderr':
        run.handlers.onStderr(msg.text);
        break;
      case 'mission':
        run.handlers.onMission(msg.mission);
        break;
      case 'snapshot-patch':
        run.handlers.onPlanPatch(msg.plan);
        break;
      case 'done':
        this.finish(msg.outcome);
        break;
    }
  }

  private finish(result: RunResult): void {
    const run = this.pending;
    if (!run) return;
    clearTimeout(run.timer);
    this.pending = null;
    run.resolve(result);
  }

  private kill(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
