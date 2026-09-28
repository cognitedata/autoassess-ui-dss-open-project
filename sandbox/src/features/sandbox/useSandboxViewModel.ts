import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { createDemoSnapshotSource } from '../../data/DemoSnapshotSource';
import type { SnapshotSource } from '../../data/SnapshotSource';
import { patchPlan } from '../../domain/snapshotPatch';
import type { DataSourceMode, SandboxSnapshot } from '../../domain/types';
import type { StarterExample } from '../../examples/examples';
import { STARTER_EXAMPLES } from '../../examples/examples';
import type { PythonRuntime } from '../../python/PythonRuntime';
import { createWorkerPythonRuntime } from '../../python/PythonRuntime';
import type { MissionResult } from '../../sim/simulator';
import type { ConsoleChunk, ConsoleStream } from './consoleBuffer';
import { appendConsole } from './consoleBuffer';

export interface SandboxViewModelDeps {
  /** Data sources the user can pick from; the first one is the default. */
  sources: SnapshotSource[];
  createRuntime: () => PythonRuntime;
  examples: StarterExample[];
  now: () => number;
}

export const defaultSandboxViewModelDeps: SandboxViewModelDeps = {
  sources: [createDemoSnapshotSource()],
  createRuntime: () => createWorkerPythonRuntime(),
  examples: STARTER_EXAMPLES,
  now: () => performance.now(),
};

export const SandboxViewModelContext = createContext<SandboxViewModelDeps>(defaultSandboxViewModelDeps);

export type PythonStatus = 'waiting-for-data' | 'booting' | 'ready' | 'running' | 'error';

export type DataState =
  | { state: 'loading' }
  | { state: 'ready'; snapshot: SandboxSnapshot }
  | { state: 'error'; message: string };

export interface SandboxViewModel {
  examples: StarterExample[];
  exampleId: string;
  selectExample(id: string): void;
  code: string;
  setCode(code: string): void;

  consoleChunks: ConsoleChunk[];
  clearConsole(): void;

  pythonStatus: PythonStatus;
  pythonError: string | null;

  data: DataState;
  sources: Array<{ label: string; mode: DataSourceMode }>;
  sourceIndex: number;
  selectSource(index: number): void;
  reloadData(): void;

  canRun: boolean;
  isRunning: boolean;
  run(): Promise<void>;
  stop(): void;
  /** Fresh interpreter + filesystem, cleared console and simulator, example code restored. */
  reset(): void;

  /** The latest flight: updated after every step while a script flies the drone. */
  mission: MissionResult | null;
  /**
   * Increments for every new flight (the first mission of a run, or a new flight id within the
   * run) to restart playback. Later steps of the same flight keep it, so playback continues.
   */
  missionId: number;
}

export function useSandboxViewModel(): SandboxViewModel {
  const { sources, createRuntime, examples, now } = useContext(SandboxViewModelContext);

  const [exampleId, setExampleId] = useState(examples[0]?.id ?? '');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [consoleChunks, setConsoleChunks] = useState<ConsoleChunk[]>([]);
  const [pythonStatus, setPythonStatus] = useState<PythonStatus>('waiting-for-data');
  const [pythonError, setPythonError] = useState<string | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<DataState>({ state: 'loading' });
  const [mission, setMission] = useState<MissionResult | null>(null);
  const [missionId, setMissionId] = useState(0);

  const runtimeRef = useRef<PythonRuntime | null>(null);
  const bootedRef = useRef(false);
  const snapshotRef = useRef<SandboxSnapshot | null>(null);

  const write = useCallback((stream: ConsoleStream, text: string) => {
    setConsoleChunks((chunks) => appendConsole(chunks, stream, text));
  }, []);

  const boot = useCallback(
    (snapshot: SandboxSnapshot) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      bootedRef.current = true;
      setPythonStatus('booting');
      setPythonError(null);
      runtime.start(snapshot).then(
        () => {
          if (runtimeRef.current === runtime) setPythonStatus((s) => (s === 'booting' ? 'ready' : s));
        },
        (err: unknown) => {
          if (runtimeRef.current !== runtime) return;
          bootedRef.current = false;
          setPythonStatus('error');
          setPythonError(`Python failed to start: ${err instanceof Error ? err.message : String(err)}`);
        },
      );
    },
    [],
  );

  // One interpreter per mounted view.
  useEffect(() => {
    const runtime = createRuntime();
    runtimeRef.current = runtime;
    bootedRef.current = false;
    if (snapshotRef.current) boot(snapshotRef.current);
    return () => {
      runtime.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [createRuntime, boot]);

  // (Re)load the data snapshot, then boot Python or hand it the new data.
  const source = sources[sourceIndex] ?? sources[0];
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setData({ state: 'loading' });
    source.load().then(
      (snapshot) => {
        if (cancelled) return;
        snapshotRef.current = snapshot;
        setData({ state: 'ready', snapshot });
        if (bootedRef.current) runtimeRef.current?.updateSnapshot(snapshot);
        else boot(snapshot);
      },
      (err: unknown) => {
        if (cancelled) return;
        setData({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, reloadToken, boot]);

  const exampleCode = examples.find((e) => e.id === exampleId)?.code ?? '';
  const code = edits[exampleId] ?? exampleCode;

  const setCode = useCallback(
    (next: string) => setEdits((prev) => ({ ...prev, [exampleId]: next })),
    [exampleId],
  );

  const isRunning = pythonStatus === 'running';
  const canRun = pythonStatus === 'ready';

  const run = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || pythonStatus !== 'ready') return;
    setConsoleChunks([]);
    setPythonStatus('running');
    const started = now();
    let flightId: number | null = null;
    const result = await runtime.run(code, {
      onStdout: (text) => write('stdout', text),
      onStderr: (text) => write('stderr', text),
      onMission: (m) => {
        setMission(m);
        if (m.flightId !== flightId) setMissionId((id) => id + 1);
        flightId = m.flightId;
      },
      onPlanPatch: (plan) => {
        // Simulated plans.update_status: only the in-browser copy changes (until Reload).
        const current = snapshotRef.current;
        if (!current) return;
        const patched = patchPlan(current, plan);
        snapshotRef.current = patched;
        setData({ state: 'ready', snapshot: patched });
      },
    });
    if (runtimeRef.current !== runtime) return;
    const elapsedMs = now() - started;
    const elapsed = elapsedMs < 1000 ? `${Math.round(elapsedMs)} ms` : `${(elapsedMs / 1000).toFixed(1)} s`;
    if (result.ok) {
      write('system', `\n✓ Finished in ${elapsed}\n`);
      setPythonStatus('ready');
    } else if (result.stopped || result.timedOut) {
      write('system', `\n■ ${result.error ?? 'Stopped'}. Restarting Python…\n`);
      if (snapshotRef.current) boot(snapshotRef.current);
    } else {
      write('error', `\n${result.error ?? 'Error'}\n`);
      setPythonStatus('ready');
    }
  }, [boot, code, now, pythonStatus, write]);

  const stop = useCallback(() => {
    runtimeRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    const runtime = runtimeRef.current;
    runtime?.stop();
    setConsoleChunks([]);
    setMission(null);
    setEdits((prev) => {
      const next = { ...prev };
      delete next[exampleId];
      return next;
    });
    if (snapshotRef.current) boot(snapshotRef.current);
  }, [boot, exampleId]);

  const selectSource = useCallback(
    (index: number) => {
      if (index === sourceIndex || !sources[index]) return;
      setMission(null);
      setSourceIndex(index);
    },
    [sourceIndex, sources],
  );

  return {
    examples,
    exampleId,
    selectExample: setExampleId,
    code,
    setCode,
    consoleChunks,
    clearConsole: useCallback(() => setConsoleChunks([]), []),
    pythonStatus,
    pythonError,
    data,
    sources: sources.map((s) => ({ label: s.label, mode: s.mode })),
    sourceIndex,
    selectSource,
    reloadData: useCallback(() => setReloadToken((t) => t + 1), []),
    canRun,
    isRunning,
    run,
    stop,
    reset,
    mission,
    missionId,
  };
}
