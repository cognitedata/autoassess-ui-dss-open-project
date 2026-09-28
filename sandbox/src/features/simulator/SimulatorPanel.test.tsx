import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { PlanJson } from '../../domain/planJson';
import { flyAllTasks } from '../../__mocks__/missions';
import type { InspectionPlan } from '../../domain/types';
import type { MissionResult } from '../../sim/simulator';
import { FlightRecorder } from '../../sim/simulator';
import { SimulatorPanel } from './SimulatorPanel';
import type { PlaybackDeps } from './useMissionPlaybackViewModel';
import { MissionPlaybackContext } from './useMissionPlaybackViewModel';

describe(SimulatorPanel.name, () => {
  it('should explain how to fly the simulated drone when there is no mission', () => {
    renderPanel(null);

    expect(screen.getByText('No mission yet')).toBeInTheDocument();
    expect(screen.getByText(/sim_drone = SimDrone\(\)/)).toBeInTheDocument();
  });

  it('should list the plan tasks with the plan status from the data', () => {
    renderPanel(mission(), [{ ...PLAN_ROW, status: 'Complete' }]);

    expect(screen.getByRole('list', { name: 'Plan tasks' })).toBeInTheDocument();
    expect(screen.getByTestId('plan-status')).toHaveTextContent('Complete');
  });

  it('should not claim the drone landed when the flight so far ends in the air', () => {
    const rec = new FlightRecorder();
    rec.loadPlan(PLAN, { min: [0, -2, 0], max: [10, 2, 3] });
    rec.takeoff();
    renderPanel(rec.snapshot());

    fireEvent.change(screen.getByRole('slider', { name: 'Mission time' }), { target: { value: '1000' } });

    expect(screen.getByTestId('flight-phase')).toHaveTextContent('In flight');
  });

  it('should show the plan, both views, controls and the first log entry', () => {
    renderPanel(mission());

    expect(screen.getByRole('heading', { name: /Drone simulator · Tank test/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Top view/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Side view/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByTestId('flight-phase')).toHaveTextContent('Taking off');
    expect(screen.getByRole('list', { name: 'Mission log' })).toHaveTextContent('Take-off');
  });

  it('should show the final summary with skipped tasks once the mission is scrubbed to the end', () => {
    renderPanel(mission());

    fireEvent.change(screen.getByRole('slider', { name: 'Mission time' }), { target: { value: '1000' } });

    expect(screen.getByTestId('flight-phase')).toHaveTextContent('Landed');
    expect(screen.getByTestId('mission-summary')).toHaveTextContent('Mission summary');
    expect(screen.getByTestId('mission-summary')).toHaveTextContent('Tasks inspected1 / 2');
    expect(within(screen.getByTestId('mission-summary')).getByText(/outside the area bounds/)).toBeInTheDocument();
  });
});

const PLAN: PlanJson = {
  planExternalId: 'p',
  name: 'Tank test',
  description: null,
  areaExternalId: 'a',
  areaName: 'BWT 1',
  mapExternalId: null,
  downloadedAt: '',
  tasks: [
    { id: 'in', kind: 'region', inspectionType: 'visual', position3d: [2, 0, 1], normalVector: [0, 1, 0] },
    { id: 'out', kind: 'region', inspectionType: 'visual', position3d: [50, 0, 1], normalVector: [0, 1, 0] },
  ],
};

const PLAN_ROW: InspectionPlan = {
  space: 's',
  externalId: 'p',
  areaExternalId: 'a',
  status: 'Ready',
  createdTime: 0,
  name: 'Tank test',
  description: null,
  mapExternalId: null,
};

let cached: MissionResult | null = null;
function mission(): MissionResult {
  cached ??= flyAllTasks(PLAN, { min: [0, -2, 0], max: [10, 2, 3] });
  return cached;
}

function renderPanel(m: MissionResult | null, plans: InspectionPlan[] = [PLAN_ROW]) {
  const frames: PlaybackDeps = { requestFrame: () => 0, cancelFrame: () => {} };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MissionPlaybackContext.Provider value={frames}>{children}</MissionPlaybackContext.Provider>
  );
  return render(<SimulatorPanel mission={m} missionId={1} elements={[]} plans={plans} />, { wrapper: Wrapper });
}
