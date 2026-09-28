import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PlanJson } from '../../domain/planJson';
import type { InspectionPlan } from '../../domain/types';
import { sampleMission } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import { FlightRecorder } from '../../sim/simulator';
import { TaskListPanel } from './TaskListPanel';

describe(TaskListPanel.name, () => {
  it('should show the plan name and its status', () => {
    renderAt(0, READY);

    expect(screen.getByRole('heading', { name: /Tasks · Tank test/ })).toBeInTheDocument();
    expect(screen.getByTestId('plan-status')).toHaveTextContent('Ready');
  });

  it('should show a Complete plan status', () => {
    renderAt(0, { ...READY, status: 'Complete' });

    expect(screen.getByTestId('plan-status')).toHaveTextContent('Complete');
  });

  it('should show the status the plan had at take-off until the replay has landed', () => {
    renderAt(3, { ...READY, status: 'Complete' }, 'Ready');

    expect(screen.getByTestId('plan-status')).toHaveTextContent('Ready');
    expect(screen.queryByText('simulated')).not.toBeInTheDocument();
  });

  it('should flip to the new status after landing and mark it as simulated', () => {
    renderAt(1000, { ...READY, status: 'Complete' }, 'Ready');

    expect(screen.getByTestId('plan-status')).toHaveTextContent('Complete');
    expect(screen.getByText('simulated')).toHaveAttribute('title', expect.stringContaining('not written to CDF'));
  });

  it('should fall back to the mission plan name without a status when the plan is not in the data', () => {
    renderAt(0, null);

    expect(screen.getByRole('heading', { name: /Tank test/ })).toBeInTheDocument();
    expect(screen.queryByTestId('plan-status')).not.toBeInTheDocument();
  });

  it('should list every task with its short id and type, pending before take-off', () => {
    renderAt(0, READY);

    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringMatching(/task-1.*region · visual.*pending/),
      expect.stringMatching(/task-2.*region · ndt_thickness.*pending/),
      expect.stringMatching(/task-3.*region · visual.*pending/),
    ]);
  });

  it('should mark the task the drone flies to as en route and highlight it', () => {
    renderAt(2, READY); // takeoff 0-1 s, leg 1-3 s

    const row = rowFor('task-1');
    expect(row).toHaveTextContent('en route');
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('should show inspecting while the drone hovers at the task', () => {
    renderAt(4, READY); // inspecting 3-6 s

    expect(rowFor('task-1')).toHaveTextContent('inspecting');
  });

  it('should show inspected with the time it finished', () => {
    renderAt(6.5, READY);

    expect(rowFor('task-1')).toHaveTextContent('inspected');
    expect(rowFor('task-1')).toHaveTextContent('6.0 s');
    expect(rowFor('task-1')).not.toHaveAttribute('aria-current');
  });

  it('should show skipped tasks with the reason once the drone gave up on them', () => {
    renderAt(1000, READY);

    expect(rowFor('task-3')).toHaveTextContent('skipped');
    expect(rowFor('task-3')).toHaveTextContent('outside the area bounds');
  });

  it('should say when the plan has no tasks', () => {
    const rec = new FlightRecorder();
    rec.loadPlan({ ...PLAN, tasks: [] }, null);
    const mission = rec.snapshot();

    render(<TaskListPanel mission={mission} sample={sampleMission(mission, 0)} plan={READY} />);

    expect(screen.getByText('This plan has no tasks.')).toBeInTheDocument();
  });
});

function rows(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Plan tasks' })).getAllByRole('listitem');
}

function rowFor(shortId: string): HTMLElement {
  const row = rows().find((r) => within(r).queryByText(shortId));
  if (!row) throw new Error(`no row for ${shortId}`);
  return row;
}

function renderAt(t: number, plan: InspectionPlan | null, statusAtStart?: InspectionPlan['status']) {
  const mission = { ...flight(), planStatusAtStart: statusAtStart ?? plan?.status ?? null };
  return render(<TaskListPanel mission={mission} sample={sampleMission(mission, t)} plan={plan} />);
}

/** task-1 inspected (3-6 s), task-2 in the plan but never flown, task-3 refused (outside the area). */
function flight(): MissionResult {
  const rec = new FlightRecorder({ speedMps: 1, home: [0, 0, 0] });
  rec.loadPlan(PLAN, { min: [0, -2, 0], max: [10, 2, 3] });
  rec.takeoff();
  rec.goto({ x: 2, y: 0, z: 1, roll: 0, pitch: 0, yaw: 0 });
  rec.inspect('p-task-1');
  try {
    rec.inspect('p-task-3');
  } catch {
    // expected: outside the area
  }
  rec.returnHome();
  rec.land();
  return rec.snapshot();
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
    { id: 'p-task-1', kind: 'region', inspectionType: 'visual', position3d: [2, -1, 1], normalVector: [0, 1, 0] },
    { id: 'p-task-2', kind: 'region', inspectionType: 'ndt_thickness', position3d: [4, -1, 1], normalVector: [0, 1, 0] },
    { id: 'p-task-3', kind: 'region', inspectionType: 'visual', position3d: [50, 0, 1], normalVector: [0, 1, 0] },
  ],
};

const READY: InspectionPlan = {
  space: 's',
  externalId: 'p',
  areaExternalId: 'a',
  status: 'Ready',
  createdTime: 0,
  name: 'Tank test',
  description: null,
  mapExternalId: null,
};
