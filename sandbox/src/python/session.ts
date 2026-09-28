import type { loadPyodide as loadPyodideFn, PyodideAPI } from 'pyodide';

import { patchPlan } from '../domain/snapshotPatch';
import type { InspectionPlan, SandboxSnapshot } from '../domain/types';
import type { MissionResult } from '../sim/simulator';
import type { SandboxBridgeHandle } from './bridge';
import { createSandboxBridge } from './bridge';

export type LoadPyodide = typeof loadPyodideFn;

export interface RunOutput {
  stdout(text: string): void;
  stderr(text: string): void;
  /** The flight so far, after every step that changed it. */
  mission(mission: MissionResult): void;
  /** A plan changed by the simulated `plans.update_status` (in-browser only, never CDF). */
  planPatch(plan: InspectionPlan): void;
}

export interface RunOutcome {
  ok: boolean;
  /** Cleaned-up Python traceback (or JS error message) when ok is false. */
  error?: string;
}

/** Where the sandbox Python packages live inside Pyodide's in-memory filesystem. */
export const LIB_DIR = '/home/pyodide/.sandbox_lib';
/** Filename shown in tracebacks for the user's code. */
export const MAIN_FILENAME = 'main.py';

/**
 * One Pyodide interpreter with the sandbox packages installed. Runs in the Web Worker in the
 * browser, and directly in Node in the integration tests.
 */
/** Load everything from the app's own origin: packageBaseUrl too, so nothing falls back to the jsdelivr CDN. */
export function pyodideLoadOptions(
  indexURL: string | undefined,
): { indexURL?: string; packageBaseUrl?: string } {
  if (!indexURL) return {};
  return { indexURL, packageBaseUrl: indexURL };
}

export class PythonSession {
  private output: RunOutput | null = null;
  private bridge: SandboxBridgeHandle | null = null;

  private constructor(
    private readonly pyodide: PyodideAPI,
    private snapshot: SandboxSnapshot,
  ) {}

  static async create(options: {
    loadPyodide: LoadPyodide;
    indexURL?: string;
    files: Record<string, string>;
    snapshot: SandboxSnapshot;
  }): Promise<PythonSession> {
    const pyodide = await options.loadPyodide(pyodideLoadOptions(options.indexURL));
    const session = new PythonSession(pyodide, options.snapshot);
    session.install(options.files);
    return session;
  }

  setSnapshot(snapshot: SandboxSnapshot): void {
    this.snapshot = snapshot;
  }

  getSnapshot(): SandboxSnapshot {
    return this.snapshot;
  }

  async run(code: string, output: RunOutput): Promise<RunOutcome> {
    const { pyodide } = this;
    this.output = output;
    pyodide.setStdout(streamWriter(output.stdout));
    pyodide.setStderr(streamWriter(output.stderr));
    const globals = pyodide.globals.get('dict')();
    try {
      this.bridge?.resetRun();
      globals.set('__name__', '__main__');
      await pyodide.runPythonAsync(code, { globals, filename: MAIN_FILENAME });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: cleanTraceback(err instanceof Error ? err.message : String(err)) };
    } finally {
      pyodide.runPython('import sys; sys.stdout.flush(); sys.stderr.flush()');
      globals.destroy();
      this.output = null;
    }
  }

  private install(files: Record<string, string>): void {
    const { FS } = this.pyodide;
    for (const [relPath, source] of Object.entries(files)) {
      const fullPath = `${LIB_DIR}/${relPath}`;
      FS.mkdirTree(fullPath.slice(0, fullPath.lastIndexOf('/')));
      FS.writeFile(fullPath, source, { encoding: 'utf8' });
    }
    this.bridge = createSandboxBridge({
      getSnapshot: () => this.snapshot,
      onMission: (mission) => this.output?.mission(mission),
      onPlanPatch: (plan) => {
        this.snapshot = patchPlan(this.snapshot, plan);
        this.output?.planPatch(plan);
      },
    });
    this.pyodide.registerJsModule('_sandbox_bridge', this.bridge.module);
    this.pyodide.runPython(`import sys\nsys.path.insert(0, ${JSON.stringify(LIB_DIR)})`);
  }
}

function streamWriter(sink: (text: string) => void): { write(buffer: Uint8Array): number } {
  const decoder = new TextDecoder();
  return {
    write(buffer: Uint8Array): number {
      sink(decoder.decode(buffer, { stream: true }));
      return buffer.length;
    },
  };
}

/**
 * Drops Pyodide's internal frames (files under /lib/python…) from a traceback so users see
 * only their own code and the sandbox SDK.
 */
export function cleanTraceback(message: string): string {
  const lines = message.replace(/\s+$/, '').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^ {2}File "\/lib\/python/.test(lines[i])) {
      while (i + 1 < lines.length && /^ {4}/.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}
