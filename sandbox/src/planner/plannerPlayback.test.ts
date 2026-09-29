import { describe, expect, it } from 'vitest';

import { plannerResult } from '../__mocks__/planner';
import { cameraPitchAt, samplePlanner, viewpointArrivals } from './plannerPlayback';

describe(samplePlanner.name, () => {
  it('should have no iteration before the first path was planned', () => {
    const s = samplePlanner(plannerResult(), 0.5);

    expect(s.iteration).toBeNull();
    expect(s.mode).toBe('initialization');
  });

  it('should pick the latest iteration planned at or before t, and take its mode', () => {
    const planner = plannerResult();

    expect(samplePlanner(planner, 1).iteration?.iteration).toBe(1);
    expect(samplePlanner(planner, 4.9).iteration?.iteration).toBe(1);
    expect(samplePlanner(planner, 6).iteration?.iteration).toBe(2);
    expect(samplePlanner(planner, 6).mode).toBe('inspection');
  });

  it('should interpolate explored %, coverage % and time remaining between progress records', () => {
    const s = samplePlanner(plannerResult(), 2);

    expect(s.exploredPct).toBe(30);
    expect(s.coveragePct).toBe(10);
    expect(s.timeRemainingS).toBe(98);
  });

  it('should carry the earlier record\'s compartment counters between records', () => {
    const planner = plannerResult();

    expect(samplePlanner(planner, 2)).toMatchObject({ compartment: 1, compartments: 2 });
    expect(samplePlanner(planner, 6)).toMatchObject({ compartment: 1, compartments: 2 });
    expect(samplePlanner(planner, 9)).toMatchObject({ compartment: 2, compartments: 2 });
  });

  it('should default the compartment counters to 1 without progress records', () => {
    expect(samplePlanner(plannerResult({ progress: [], timeline: [] }), 3)).toMatchObject({ compartment: 1, compartments: 1 });
  });

  it('should hold the last progress values after the last record', () => {
    const s = samplePlanner(plannerResult(), 50);

    expect(s.exploredPct).toBe(60);
    expect(s.coveragePct).toBe(80);
  });

  it('should report zeros for a planner without progress records', () => {
    const s = samplePlanner(plannerResult({ progress: [], timeline: [] }), 3);

    expect(s).toMatchObject({ mode: 'idle', exploredPct: 0, coveragePct: 0, timeRemainingS: 0 });
  });

  it('should only list viewpoints planned by t', () => {
    const planner = plannerResult();

    expect(samplePlanner(planner, 4).viewpoints).toEqual([]);
    expect(samplePlanner(planner, 5).viewpoints.map((v) => v.order)).toEqual([1, 2]);
  });

  it('should only count tasks covered by t', () => {
    const planner = plannerResult();

    expect([...samplePlanner(planner, 2).coveredTaskIds]).toEqual([]);
    expect([...samplePlanner(planner, 3).coveredTaskIds]).toEqual(['task-a']);
    expect([...samplePlanner(planner, 9).coveredTaskIds].sort()).toEqual(['task-a', 'task-b']);
  });
});

describe(cameraPitchAt.name, () => {
  it('should use the pitch of the planned viewpoint the drone is at', () => {
    expect(cameraPitchAt(plannerResult(), [2.5, 1.52, 1.5], 6)).toBe(0.6);
  });

  it('should look level away from viewpoints and before they are planned', () => {
    expect(cameraPitchAt(plannerResult(), [1, 1, 1], 6)).toBe(0);
    expect(cameraPitchAt(plannerResult(), [2.5, 1.5, 1.5], 4)).toBe(0);
  });
});

describe(viewpointArrivals.name, () => {
  it('should find when the drone first got to each viewpoint after it was planned', () => {
    const segments = [
      { t1: 2, to: [2.5, 1.5, 1.5] as [number, number, number] },
      { t1: 6, to: [2.5, 1.5, 1.5] as [number, number, number] },
      { t1: 9, to: [3.5, 1.51, 1.5] as [number, number, number] },
    ];

    expect(viewpointArrivals(plannerResult(), segments)).toEqual([6, 9]);
  });

  it('should leave viewpoints the drone never got to as -1', () => {
    expect(viewpointArrivals(plannerResult(), [])).toEqual([-1, -1]);
  });
});

describe('samplePlanner with arrivals', () => {
  it('should mark the viewpoints reached by t', () => {
    const s = samplePlanner(plannerResult(), 7, [6, 9]);

    expect([...s.reachedViewpoints]).toEqual([1]);
  });
});
