import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDemoSnapshotSource } from '../../data/DemoSnapshotSource';
import { parsePlanJson } from '../../domain/planJson';
import type { PythonRuntime, RunHandlers, RunResult } from '../../python/PythonRuntime';
import { flyAllTasks } from '../../__mocks__/missions';
import type { PlaybackDeps } from '../simulator/useMissionPlaybackViewModel';
import { MissionPlaybackContext } from '../simulator/useMissionPlaybackViewModel';
import { SandboxPage } from './SandboxPage';
import type { SandboxViewModelDeps } from './useSandboxViewModel';
import { SandboxViewModelContext } from './useSandboxViewModel';

// Integration: page + view models + demo data source; only the Python worker is faked.
describe(SandboxPage.name, () => {
  let runtime: PythonRuntime;
  let runImpl: (code: string, h: RunHandlers) => Promise<RunResult>;
  let deps: SandboxViewModelDeps;

  beforeEach(() => {
    runImpl = async () => ({ ok: true });
    runtime = {
      start: vi.fn(() => Promise.resolve()),
      updateSnapshot: vi.fn(),
      run: vi.fn((code: string, h: RunHandlers) => runImpl(code, h)),
      stop: vi.fn(),
      dispose: vi.fn(),
    };
    deps = {
      sources: [createDemoSnapshotSource()],
      createRuntime: () => runtime,
      examples: [
        { id: 'a', title: '1. List plans', code: 'print("plans")' },
        { id: 'b', title: '3. Fly the mission', code: 'SimDrone().fly_plan(plan)' },
      ],
      now: () => 0,
    };
  });

  it('should show the demo data source and become ready to run', async () => {
    renderPage(deps);

    expect(screen.getByText('Demo data (bundled)')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('python-status')).toHaveTextContent('Python: ready'));
    expect(screen.getByTestId('data-summary')).toHaveTextContent('4 plans · 2 areas');
    expect(screen.getByRole('button', { name: '▶ Run' })).toBeEnabled();
  });

  it('should list the starter examples', () => {
    renderPage(deps);

    const select = screen.getByRole('combobox', { name: 'Starter example' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '1. List plans',
      '3. Fly the mission',
    ]);
  });

  it('should run the selected example and show its output in the console', async () => {
    runImpl = async (_code, h) => {
      h.onStdout('Vessel: Demo Vessel (sandbox)\n');
      return { ok: true };
    };
    const user = userEvent.setup();
    renderPage(deps);
    await waitFor(() => expect(screen.getByRole('button', { name: '▶ Run' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: '▶ Run' }));

    expect(runtime.run).toHaveBeenCalledWith('print("plans")', expect.anything());
    await waitFor(() => expect(screen.getByTestId('console-output')).toHaveTextContent('Vessel: Demo Vessel (sandbox)'));
  });

  it('should animate a dispatched mission in the simulator', async () => {
    const snapshot = await createDemoSnapshotSource().load();
    const mission = flyAllTasks(
      parsePlanJson({
        planExternalId: 'demo-plan-ndt-sweep',
        name: 'NDT sweep – port side',
        areaExternalId: 'demo-area-bwt3p',
        tasks: [{ id: 't1', kind: 'region', inspectionType: 'visual', position3d: [1, -1.8, 1.2], normalVector: [0, 1, 0] }],
      }),
      snapshot.areas[0].bounds,
    );
    runImpl = async (_code, h) => {
      h.onMission(mission);
      return { ok: true };
    };
    const user = userEvent.setup();
    renderPage(deps);
    expect(screen.getByText('No mission yet')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '▶ Run' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: '▶ Run' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: /Drone simulator · NDT sweep – port side/ })).toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Top view (x–y) of the drone mission' })).toBeInTheDocument();
    expect(screen.getByTestId('mission-summary')).toHaveTextContent('Tasks inspected0 / 1');
    expect(screen.getByTestId('plan-status')).toHaveTextContent('Ready');
  });

  it('should flip the plan status pill when the script marks the plan Complete (simulated)', async () => {
    const snapshot = await createDemoSnapshotSource().load();
    const planRow = snapshot.plans.find((p) => p.externalId === 'demo-plan-ndt-sweep');
    if (!planRow) throw new Error('fixture changed');
    const mission = flyAllTasks(
      parsePlanJson({
        planExternalId: 'demo-plan-ndt-sweep',
        name: 'NDT sweep – port side',
        areaExternalId: 'demo-area-bwt3p',
        tasks: [{ id: 't1', kind: 'region', inspectionType: 'visual', position3d: [1, -1.8, 1.2], normalVector: [0, 1, 0] }],
      }),
      snapshot.areas[0].bounds,
    );
    runImpl = async (_code, h) => {
      h.onMission({ ...mission, planStatusAtStart: 'Ready' });
      h.onStdout('simulated: plan demo-plan-ndt-sweep → Complete (not written to CDF)\n');
      h.onPlanPatch({ ...planRow, status: 'Complete' });
      return { ok: true };
    };
    const user = userEvent.setup();
    renderPage(deps);
    await waitFor(() => expect(screen.getByRole('button', { name: '▶ Run' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: '▶ Run' }));

    await waitFor(() => expect(screen.getByTestId('console-output')).toHaveTextContent('not written to CDF'));
    expect(screen.getByTestId('plan-status')).toHaveTextContent('Ready'); // replay still in the air
    fireEvent.change(screen.getByRole('slider', { name: 'Mission time' }), { target: { value: '100000' } });
    expect(screen.getByTestId('plan-status')).toHaveTextContent('Complete');
  });

  it('should show a data error with retry', async () => {
    deps.sources = [{ mode: 'live', label: 'CDF project x (read-only)', load: vi.fn(() => Promise.reject(new Error('401 Unauthorized'))) }];

    renderPage(deps);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load plans: 401 Unauthorized');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('should show a notice when given one', () => {
    renderPage(deps, 'Could not connect to Fusion');

    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Could not connect to Fusion');
  });
});

function renderPage(deps: SandboxViewModelDeps, notice?: string) {
  const frames: PlaybackDeps = { requestFrame: () => 0, cancelFrame: () => {} };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SandboxViewModelContext.Provider value={deps}>
      <MissionPlaybackContext.Provider value={frames}>{children}</MissionPlaybackContext.Provider>
    </SandboxViewModelContext.Provider>
  );
  return render(<SandboxPage notice={notice} />, { wrapper: Wrapper });
}
