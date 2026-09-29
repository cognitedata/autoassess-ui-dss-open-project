import { act, renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SnapshotSource } from '../../data/SnapshotSource';
import type { InspectionPlan, SandboxSnapshot } from '../../domain/types';
import type { PythonRuntime, RunHandlers, RunResult } from '../../python/PythonRuntime';
import type { MissionResult } from '../../sim/simulator';
import type { SandboxViewModel, SandboxViewModelDeps } from './useSandboxViewModel';
import { SandboxViewModelContext, useSandboxViewModel } from './useSandboxViewModel';

describe(useSandboxViewModel.name, () => {
  let runtime: FakeRuntime;
  let deps: SandboxViewModelDeps;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    runtime = new FakeRuntime();
    deps = {
      sources: [source('demo', SNAPSHOT)],
      createRuntime: () => runtime,
      examples: [
        { id: 'one', title: '1. One', code: 'print(1)' },
        { id: 'two', title: '2. Two', code: 'print(2)' },
      ],
      now: vi.fn(() => 0),
    };
    wrapper = ({ children }) => (
      <SandboxViewModelContext.Provider value={deps}>{children}</SandboxViewModelContext.Provider>
    );
  });

  it('should load data, then boot Python and become ready', async () => {
    const { result } = renderHook(() => useSandboxViewModel(), { wrapper });

    expect(result.current.data.state).toBe('loading');
    await waitFor(() => expect(result.current.pythonStatus).toBe('ready'));
    expect(result.current.data).toEqual({ state: 'ready', snapshot: SNAPSHOT });
    expect(runtime.start).toHaveBeenCalledWith(SNAPSHOT);
    expect(result.current.canRun).toBe(true);
  });

  it('should show a data error and not boot Python when the source fails', async () => {
    deps.sources = [{ mode: 'live', label: 'CDF', load: vi.fn(() => Promise.reject(new Error('403'))) }];

    const { result } = renderHook(() => useSandboxViewModel(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ state: 'error', message: '403' }));
    expect(runtime.start).not.toHaveBeenCalled();
    expect(result.current.canRun).toBe(false);
  });

  it('should report a Python boot failure', async () => {
    runtime.start.mockRejectedValue(new Error('CSP blocked wasm'));

    const { result } = renderHook(() => useSandboxViewModel(), { wrapper });

    await waitFor(() => expect(result.current.pythonStatus).toBe('error'));
    expect(result.current.pythonError).toBe('Python failed to start: CSP blocked wasm');
  });

  it('should load the selected example and keep edits per example', async () => {
    const { result } = renderHook(() => useSandboxViewModel(), { wrapper });
    expect(result.current.code).toBe('print(1)');

    act(() => result.current.setCode('print("edited")'));
    act(() => result.current.selectExample('two'));
    expect(result.current.code).toBe('print(2)');
    act(() => result.current.selectExample('one'));

    expect(result.current.code).toBe('print("edited")');
  });

  it('should run the code, stream output and record a dispatched mission', async () => {
    runtime.runImpl = async (_code, handlers) => {
      handlers.onStdout('hello\n');
      handlers.onMission(MISSION);
      return { ok: true };
    };
    const { result } = await renderReady();

    await act(() => result.current.run());

    expect(runtime.run).toHaveBeenCalledWith('print(1)', expect.anything());
    expect(text(result.current)).toContain('hello\n');
    expect(text(result.current)).toContain('✓ Finished');
    expect(result.current.mission).toBe(MISSION);
    expect(result.current.missionId).toBe(1);
    expect(result.current.pythonStatus).toBe('ready');
  });

  it('should update the mission without restarting playback for later steps of the same flight', async () => {
    const inFlight = mission({ flightId: 1, status: 'in-flight' });
    const landed = mission({ flightId: 1, status: 'landed' });
    runtime.runImpl = async (_code, handlers) => {
      handlers.onMission(inFlight);
      handlers.onMission(landed);
      return { ok: true };
    };
    const { result } = await renderReady();

    await act(() => result.current.run());

    expect(result.current.mission).toBe(landed);
    expect(result.current.missionId).toBe(1);
  });

  it('should restart playback for a new flight in the same run', async () => {
    runtime.runImpl = async (_code, handlers) => {
      handlers.onMission(mission({ flightId: 1 }));
      handlers.onMission(mission({ flightId: 2 }));
      return { ok: true };
    };
    const { result } = await renderReady();

    await act(() => result.current.run());

    expect(result.current.missionId).toBe(2);
  });

  it('should restart playback for the first mission of every run', async () => {
    runtime.runImpl = async (_code, handlers) => {
      handlers.onMission(mission({ flightId: 1 }));
      return { ok: true };
    };
    const { result } = await renderReady();

    await act(() => result.current.run());
    await act(() => result.current.run());

    expect(result.current.missionId).toBe(2);
  });

  it('should apply a simulated plan status change to the data (never to the source)', async () => {
    deps.sources = [source('demo', SNAPSHOT_WITH_PLAN)];
    runtime.runImpl = async (_code, handlers) => {
      handlers.onPlanPatch({ ...READY_PLAN, status: 'Complete' });
      return { ok: true };
    };
    const { result } = await renderReady();

    await act(() => result.current.run());

    expect(readyPlans(result.current)).toEqual([expect.objectContaining({ externalId: 'p1', status: 'Complete' })]);
    expect(SNAPSHOT_WITH_PLAN.plans[0].status).toBe('Ready');
  });

  it('should drop simulated plan changes on reload', async () => {
    deps.sources = [source('demo', SNAPSHOT_WITH_PLAN)];
    runtime.runImpl = async (_code, handlers) => {
      handlers.onPlanPatch({ ...READY_PLAN, status: 'Complete' });
      return { ok: true };
    };
    const { result } = await renderReady();
    await act(() => result.current.run());

    act(() => result.current.reloadData());

    await waitFor(() => expect(readyPlans(result.current)[0]?.status).toBe('Ready'));
    expect(runtime.updateSnapshot).toHaveBeenLastCalledWith(SNAPSHOT_WITH_PLAN);
  });

  it('should show a Python error in the console', async () => {
    runtime.runImpl = async () => ({ ok: false, error: 'Traceback…\nValueError: boom' });
    const { result } = await renderReady();

    await act(() => result.current.run());

    expect(result.current.consoleChunks.at(-1)).toMatchObject({ stream: 'error' });
    expect(text(result.current)).toContain('ValueError: boom');
    expect(result.current.pythonStatus).toBe('ready');
  });

  it('should be running while a script executes, and reboot Python after stop', async () => {
    let finish: (r: RunResult) => void = () => {};
    runtime.runImpl = () => new Promise<RunResult>((resolve) => (finish = resolve));
    runtime.stop.mockImplementation(() => finish({ ok: false, stopped: true, error: 'Stopped by user' }));
    const { result } = await renderReady();

    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current.run();
    });
    expect(result.current.isRunning).toBe(true);
    await act(async () => {
      result.current.stop();
      await running;
    });

    expect(text(result.current)).toContain('Stopped by user');
    expect(runtime.start).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.pythonStatus).toBe('ready'));
  });

  it('should reset: fresh interpreter, cleared console and mission, original example code', async () => {
    runtime.runImpl = async (_code, handlers) => {
      handlers.onMission(MISSION);
      return { ok: true };
    };
    const { result } = await renderReady();
    act(() => result.current.setCode('print("edited")'));
    await act(() => result.current.run());

    act(() => result.current.reset());

    expect(runtime.stop).toHaveBeenCalled();
    expect(result.current.consoleChunks).toEqual([]);
    expect(result.current.mission).toBeNull();
    expect(result.current.code).toBe('print(1)');
    await waitFor(() => expect(result.current.pythonStatus).toBe('ready'));
  });

  it('should switch data source and pass the new snapshot to the running interpreter', async () => {
    const live = { ...SNAPSHOT, mode: 'live' as const, sourceLabel: 'CDF project x' };
    deps.sources = [source('demo', SNAPSHOT), source('live', live)];
    const { result } = await renderReady();

    act(() => result.current.selectSource(1));

    await waitFor(() => expect(result.current.data).toEqual({ state: 'ready', snapshot: live }));
    expect(runtime.updateSnapshot).toHaveBeenCalledWith(live);
    expect(result.current.sources.map((s) => s.mode)).toEqual(['demo', 'live']);
  });

  it('should dispose the interpreter on unmount', async () => {
    const { unmount } = await renderReady();

    unmount();

    expect(runtime.dispose).toHaveBeenCalled();
  });

  async function renderReady() {
    const rendered = renderHook(() => useSandboxViewModel(), { wrapper });
    await waitFor(() => expect(rendered.result.current.pythonStatus).toBe('ready'));
    return rendered;
  }
});

class FakeRuntime implements PythonRuntime {
  runImpl: (code: string, handlers: RunHandlers) => Promise<RunResult> = async () => ({ ok: true });
  start = vi.fn<PythonRuntime['start']>(() => Promise.resolve());
  updateSnapshot = vi.fn<PythonRuntime['updateSnapshot']>();
  run = vi.fn<PythonRuntime['run']>((code, handlers) => this.runImpl(code, handlers));
  stop = vi.fn<PythonRuntime['stop']>();
  dispose = vi.fn<PythonRuntime['dispose']>();
}

function source(mode: 'demo' | 'live', snapshot: SandboxSnapshot): SnapshotSource {
  return { mode, label: snapshot.sourceLabel, load: vi.fn(() => Promise.resolve(snapshot)) };
}

function text(vm: { consoleChunks: Array<{ text: string }> }): string {
  return vm.consoleChunks.map((c) => c.text).join('');
}

const SNAPSHOT: SandboxSnapshot = {
  mode: 'demo',
  sourceLabel: 'Demo data',
  loadedAt: '2026-09-26T00:00:00Z',
  vessels: [],
  areas: [],
  plans: [],
  tasks: [],
  elements: [],
};

const MISSION = mission({});

function mission(overrides: Partial<MissionResult>): MissionResult {
  return { planExternalId: 'p', flightId: 1, status: 'landed', ...overrides } as MissionResult;
}

function readyPlans(vm: SandboxViewModel): InspectionPlan[] {
  return vm.data.state === 'ready' ? vm.data.snapshot.plans : [];
}

const READY_PLAN: InspectionPlan = {
  space: 's',
  externalId: 'p1',
  areaExternalId: 'a',
  status: 'Ready',
  createdTime: 0,
  name: 'P1',
  description: null,
  mapExternalId: null,
};

const SNAPSHOT_WITH_PLAN: SandboxSnapshot = { ...SNAPSHOT, plans: [READY_PLAN] };
