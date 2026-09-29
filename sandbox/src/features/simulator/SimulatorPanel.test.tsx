import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { PlanJson } from '../../domain/planJson';
import { flyAllTasks } from '../../__mocks__/missions';
import { plannerResult } from '../../__mocks__/planner';
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

  it('should point at the gbplanner examples when there is no mission', () => {
    renderPanel(null);

    expect(screen.getByText('5. gbplanner: explore + inspect')).toBeInTheDocument();
    expect(screen.getByText('6. gbplanner: target reach per task')).toBeInTheDocument();
  });

  it('should not show planner controls for a flight without a planner', () => {
    renderPanel(mission());

    expect(screen.queryByTestId('planner-status')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Planner layers' })).not.toBeInTheDocument();
  });

  it('should show the planner status strip at the playback time', () => {
    renderPanel(withPlanner());

    fireEvent.change(screen.getByRole('slider', { name: 'Mission time' }), { target: { value: '2' } });

    const strip = screen.getByTestId('planner-status');
    expect(strip).toHaveTextContent('gbplanner · bwt_inspection');
    expect(strip).toHaveTextContent('Exploring');
    expect(strip).toHaveTextContent('Iteration 1');
    expect(strip).toHaveTextContent('Explored 30%');
    expect(strip).toHaveTextContent('Coverage 10%');
    expect(strip).toHaveTextContent('Time left 98 s');
    expect(strip).toHaveTextContent('Compartment 1/2');
    expect(strip).toHaveTextContent('Covered 1 / 2');
  });

  it('should hide the compartment counter when the flow did not sequence compartments', () => {
    const single = withPlanner();
    single.planner!.progress = single.planner!.progress.map((p) => ({ ...p, compartment: 1, compartments: 1 }));
    renderPanel(single);

    fireEvent.change(screen.getByRole('slider', { name: 'Mission time' }), { target: { value: '2' } });

    expect(screen.getByTestId('planner-status')).not.toHaveTextContent('Compartment');
  });

  it('should toggle planner layers and list them in the legend', () => {
    renderPanel(withPlanner());

    const layers = screen.getByRole('group', { name: 'Planner layers' });
    const graph = within(layers).getByRole('checkbox', { name: 'Graph' });
    fireEvent.click(graph);

    expect(graph).not.toBeChecked();
    expect(within(layers).getByRole('checkbox', { name: 'Map' })).toBeChecked();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend).toHaveTextContent('Mapped structure');
    expect(legend).toHaveTextContent('Inspection viewpoint');
    expect(legend).toHaveTextContent('Covered by camera');
  });

  it('should count tasks covered by the planner camera in the summary', () => {
    renderPanel(withPlanner());

    fireEvent.change(screen.getByRole('slider', { name: 'Mission time' }), { target: { value: '1000' } });

    expect(screen.getByTestId('mission-summary')).toHaveTextContent('Covered by camera1 / 2');
  });

  it('should not report a task the planner camera covered as skipped', () => {
    renderPanel({ ...mission(), planner: plannerResult({ coveredTasks: { out: 2 } }) });

    fireEvent.change(screen.getByRole('slider', { name: 'Mission time' }), { target: { value: '1000' } });

    expect(screen.getByTestId('mission-summary')).toHaveTextContent('Skipped0');
    expect(within(screen.getByTestId('mission-summary')).queryByText(/outside the area bounds/)).not.toBeInTheDocument();
  });
});

function withPlanner(): MissionResult {
  return { ...mission(), planner: plannerResult({ coveredTasks: { in: 1.5 } }) };
}

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
