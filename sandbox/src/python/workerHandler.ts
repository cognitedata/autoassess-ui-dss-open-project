import type { MissionResult } from '../sim/simulator';
import type { FromWorker, ToWorker } from './protocol';
import type { LoadPyodide } from './session';
import { PythonSession } from './session';

export interface WorkerHandlerDeps {
  loadPyodide: LoadPyodide;
  files: Record<string, string>;
  post: (message: FromWorker) => void;
  /** Output is coalesced for this long so a print loop can't flood the main thread. */
  flushIntervalMs?: number;
}

/** Message handler for the Python Web Worker (kept free of worker globals so it's testable). */
export function createWorkerHandler({
  loadPyodide,
  files,
  post,
  flushIntervalMs = 30,
}: WorkerHandlerDeps): (message: ToWorker) => Promise<void> {
  let session: Promise<PythonSession> | null = null;
  let queue: Promise<void> = Promise.resolve();

  return async (message) => {
    switch (message.type) {
      case 'init':
        session = PythonSession.create({
          loadPyodide,
          indexURL: message.indexURL,
          files,
          snapshot: message.snapshot,
        });
        try {
          await session;
          post({ type: 'ready' });
        } catch (err) {
          post({ type: 'init-error', message: err instanceof Error ? err.message : String(err) });
        }
        return;
      case 'snapshot':
        (await session)?.setSnapshot(message.snapshot);
        return;
      case 'run': {
        const current = session;
        // Runs are serialised; the main thread only sends one at a time anyway.
        queue = queue.then(async () => {
          if (!current) {
            post({ type: 'done', runId: message.runId, outcome: { ok: false, error: 'Python is not initialised' } });
            return;
          }
          const out = createCoalescer(message.runId, post, flushIntervalMs);
          const outcome = await (await current).run(message.code, {
            stdout: (text) => out.write('stdout', text),
            stderr: (text) => out.write('stderr', text),
            mission: (mission) => out.mission(mission),
            planPatch: (plan) => {
              out.flush();
              post({ type: 'snapshot-patch', runId: message.runId, plan });
            },
          });
          out.flush();
          post({ type: 'done', runId: message.runId, outcome });
        });
        return queue;
      }
    }
  };
}

/**
 * Batches output: text per stream, and only the latest mission (every flight step produces a
 * full snapshot of the flight so far; the UI needs just the newest one).
 */
function createCoalescer(runId: number, post: (m: FromWorker) => void, intervalMs: number) {
  let stream: 'stdout' | 'stderr' | null = null;
  let buffer = '';
  let mission: MissionResult | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stream && buffer) post({ type: stream, runId, text: buffer });
    buffer = '';
    stream = null;
    if (mission) post({ type: 'mission', runId, mission });
    mission = null;
  };

  return {
    write(next: 'stdout' | 'stderr', text: string): void {
      if (stream !== next) flush();
      stream = next;
      buffer += text;
      timer ??= setTimeout(flush, intervalMs);
    },
    mission(next: MissionResult): void {
      mission = next;
      timer ??= setTimeout(flush, intervalMs);
    },
    flush,
  };
}
