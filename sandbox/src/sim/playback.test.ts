import { describe, expect, it } from 'vitest';

import type { PlanJson } from '../domain/planJson';
import { flyAllTasks } from '../__mocks__/missions';
import { distanceAt, sampleMission, sampleTelemetry, taskStateAt } from './playback';
import { FlightRecorder } from './simulator';

describe(sampleMission.name, () => {
  const mission = flyAllTasks(planWithOneTask(), { min: [0, -2, 0], max: [10, 2, 3] }, {
    speedMps: 1,
    standoffM: 1,
    home: [0, 0, 0],
  });

  it('should start at home in the takeoff phase', () => {
    const s = sampleMission(mission, 0);

    expect(s.position).toEqual([0, 0, 0]);
    expect(s.phase).toBe('takeoff');
    expect(s.done).toBe(false);
  });

  it('should interpolate along a segment', () => {
    const s = sampleMission(mission, 0.5);

    expect(s.position).toEqual([0, 0, 0.5]);
  });

  it('should report the task the drone is flying to as active (en route)', () => {
    const s = sampleMission(mission, 2);

    expect(s.phase).toBe('transit');
    expect(s.activeTaskId).toBe('r1');
  });

  it('should report the heading of the current segment', () => {
    // waypoint (2,0,1) faces the target (2,-1,1): yaw -90°
    expect(sampleMission(mission, 2).yaw).toBeCloseTo(-Math.PI / 2);
  });

  it('should report the active task while inspecting', () => {
    // takeoff 1 s + transit 2 s -> inspecting from t=3
    const s = sampleMission(mission, 4);

    expect(s.phase).toBe('inspect');
    expect(s.activeTaskId).toBe('r1');
    expect(s.visitedTaskIds.has('r1')).toBe(false);
  });

  it('should mark the task visited after its inspection', () => {
    const s = sampleMission(mission, 7);

    expect(s.visitedTaskIds.has('r1')).toBe(true);
    expect(s.events.map((e) => e.kind)).toContain('inspected');
  });

  it('should clamp past the end and report done at home', () => {
    const s = sampleMission(mission, 1e6);

    expect(s.done).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.position).toEqual([0, 0, 0]);
    expect(s.events).toHaveLength(mission.events.length);
  });
});

describe(taskStateAt.name, () => {
  const mission = flyAllTasks(planWithOneTask(), null, { speedMps: 1, standoffM: 1, home: [0, 0, 0] });
  const task = mission.tasks[0];

  it.each([
    [0.5, 'pending'],
    [2, 'en-route'],
    [4, 'inspecting'],
    [7, 'inspected'],
  ] as const)('should be %s s -> %s', (t, state) => {
    expect(taskStateAt(task, sampleMission(mission, t))).toBe(state);
  });

  it('should be skipped only from the moment the drone gave the task up', () => {
    const rec = new FlightRecorder({ speedMps: 1, home: [0, 0, 0] });
    rec.loadPlan(planWithOneTask(), null);
    rec.takeoff();
    rec.land();
    const landed = rec.snapshot();

    expect(taskStateAt(landed.tasks[0], sampleMission(landed, 0.5))).toBe('pending');
    expect(taskStateAt(landed.tasks[0], sampleMission(landed, 2))).toBe('skipped');
  });
});

describe(sampleTelemetry.name, () => {
  it('should sample every dt seconds and end with the final position', () => {
    const mission = flyAllTasks(planWithOneTask(), null, { speedMps: 1, standoffM: 1, home: [0, 0, 0] });

    const samples = sampleTelemetry(mission, 1);

    expect(samples[0]).toMatchObject({ t: 0, phase: 'takeoff' });
    expect(samples.at(-1)).toMatchObject({ t: mission.summary.durationS, phase: 'done', position: [0, 0, 0] });
    expect(samples.length).toBe(Math.ceil(mission.summary.durationS) + 1);
  });

  it('should reject a non-positive interval', () => {
    const mission = flyAllTasks(planWithOneTask(), null);

    expect(() => sampleTelemetry(mission, 0)).toThrow('dt');
  });
});

describe(distanceAt.name, () => {
  const mission = flyAllTasks(planWithOneTask(), null, { speedMps: 1, standoffM: 1, home: [0, 0, 0] });

  it('should be zero before take-off and the total at the end', () => {
    expect(distanceAt(mission, 0)).toBe(0);
    expect(distanceAt(mission, 1e6)).toBeCloseTo(mission.summary.distanceM);
  });

  it('should interpolate within a segment', () => {
    expect(distanceAt(mission, 2)).toBeCloseTo(2);
  });
});

function planWithOneTask(): PlanJson {
  return {
    planExternalId: 'p',
    name: null,
    description: null,
    areaExternalId: 'a',
    areaName: 'A',
    mapExternalId: null,
    downloadedAt: '',
    tasks: [{ id: 'r1', kind: 'region', inspectionType: 'visual', position3d: [2, -1, 1], normalVector: [0, 1, 0] }],
  };
}
