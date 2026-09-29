import { describe, expect, it } from 'vitest';

import type { PlanJson, PlanJsonTask } from '../domain/planJson';
import type { Bounds } from '../domain/types';
import type { Pose } from './simulator';
import {
  computeWaypoint,
  FlightRecorder,
  INSPECTION_DURATION_S,
  MissionError,
  preflightCheck,
  TAKEOFF_HEIGHT_M,
} from './simulator';

const BOUNDS: Bounds = { min: [0, -2, 0], max: [10, 2, 3] };

describe(preflightCheck.name, () => {
  it('should report no issues for a well-formed plan', () => {
    expect(preflightCheck(plan([regionTask('r1', [2, 0, 1])]), BOUNDS)).toEqual([]);
  });

  it('should flag an element task without a target element as an error', () => {
    const issues = preflightCheck(plan([{ id: 'e1', kind: 'element', inspectionType: 'visual' }]), BOUNDS);

    expect(issues).toEqual([expect.objectContaining({ taskId: 'e1', severity: 'error', code: 'no-pose' })]);
  });

  it('should flag a target outside the area bounds', () => {
    const issues = preflightCheck(plan([regionTask('r1', [15, 0, 1])]), BOUNDS);

    expect(issues[0]).toMatchObject({ code: 'out-of-bounds', severity: 'error' });
  });

  it('should skip the bounds check when the area has no bounds', () => {
    expect(preflightCheck(plan([regionTask('r1', [150, 0, 1])]), null)).toEqual([]);
  });

  it('should warn about a region task without a normal', () => {
    const task: PlanJsonTask = { id: 'r1', kind: 'region', inspectionType: 'visual', position3d: [1, 0, 1] };

    expect(preflightCheck(plan([task]), BOUNDS)[0]).toMatchObject({ code: 'missing-normal', severity: 'warning' });
  });
});

describe(computeWaypoint.name, () => {
  it('should back off along the region normal', () => {
    const task = regionTask('r', [2, 0, 1], [0, -2, 0]);

    expect(computeWaypoint(task, [2, 0, 1], [0, 0, 0], 0.5)).toEqual([2, -0.5, 1]);
  });

  it('should stop short of an element centre on the approach line', () => {
    const task = elementTask('e', [4, 0, 1]);

    expect(computeWaypoint(task, [4, 0, 1], [0, 0, 1], 1)).toEqual([3, 0, 1]);
  });

  it('should approach from above when there is no direction', () => {
    const task = elementTask('e', [4, 0, 1]);

    expect(computeWaypoint(task, [4, 0, 1], [4, 0, 1], 1)).toEqual([4, 0, 2]);
  });
});

describe(FlightRecorder.name, () => {
  describe('loadPlan', () => {
    it('should return the preflight issues and list every task as pending', () => {
      const rec = new FlightRecorder();

      const issues = rec.loadPlan(plan([regionTask('r1', [2, 0, 1]), regionTask('out', [50, 0, 1])]), BOUNDS);

      expect(issues).toEqual([expect.objectContaining({ taskId: 'out', code: 'out-of-bounds' })]);
      const mission = rec.snapshot();
      expect(mission.status).toBe('planned');
      expect(mission.tasks.map((t) => [t.id, t.status])).toEqual([
        ['r1', 'pending'],
        ['out', 'pending'],
      ]);
      expect(mission.segments).toEqual([]);
    });

    it('should put the drone on the ground at the default home derived from the bounds', () => {
      const rec = new FlightRecorder();

      rec.loadPlan(plan([]), BOUNDS);

      expect(rec.state()).toMatchObject({ state: 'landed', pose: pose(0, 0, 0), flightTimeS: 0, distanceM: 0 });
      expect(rec.snapshot().home).toEqual([0, 0, 0]);
    });

    it('should use a configured home', () => {
      const rec = new FlightRecorder({ home: [1, 1, 0] });

      rec.loadPlan(plan([]), BOUNDS);

      expect(rec.snapshot().home).toEqual([1, 1, 0]);
    });

    it('should refuse a new plan while flying', () => {
      const rec = flying();

      expect(() => rec.loadPlan(plan([]), BOUNDS)).toThrow(expect.objectContaining({ kind: 'state' }));
    });

    it('should start a new flight with a new flight id after landing', () => {
      const rec = flying();
      rec.land();
      const first = rec.snapshot().flightId;

      rec.loadPlan(plan([]), BOUNDS);

      expect(rec.snapshot().flightId).toBe(first + 1);
      expect(rec.snapshot().segments).toEqual([]);
    });
  });

  describe('options', () => {
    it('should reject a non-positive speed', () => {
      expect(() => new FlightRecorder({ speedMps: 0 })).toThrow('speed');
    });

    it('should reconfigure a landed drone and forget its plan', () => {
      const rec = flying();
      rec.land();

      rec.configure({ speedMps: 2 });

      expect(() => rec.takeoff()).toThrow(expect.objectContaining({ kind: 'state' }));
      rec.loadPlan(plan([]), BOUNDS);
      rec.takeoff();
      expect(rec.state().flightTimeS).toBeCloseTo(TAKEOFF_HEIGHT_M / 2);
    });

    it('should refuse to reconfigure while flying', () => {
      expect(() => flying().configure({})).toThrow(expect.objectContaining({ kind: 'state' }));
    });

    it('should reject a malformed home', () => {
      expect(() => new FlightRecorder({ home: [1, 2, Number.NaN] })).toThrow('home');
    });
  });

  describe('takeoff', () => {
    it('should climb straight up and report flying', () => {
      const rec = new FlightRecorder({ speedMps: 1 });
      rec.loadPlan(plan([]), BOUNDS);

      const reached = rec.takeoff(1.5);

      expect(reached).toEqual(pose(0, 0, 1.5));
      expect(rec.state()).toMatchObject({ state: 'flying', flightTimeS: 1.5, distanceM: 1.5 });
      expect(rec.snapshot().status).toBe('in-flight');
      expect(rec.snapshot().segments[0]).toMatchObject({ phase: 'takeoff', from: [0, 0, 0], to: [0, 0, 1.5] });
      expect(rec.snapshot().events[0]).toMatchObject({ kind: 'takeoff', t: 0 });
    });

    it('should need a plan first', () => {
      expect(() => new FlightRecorder().takeoff()).toThrow(expect.objectContaining({ kind: 'state', message: expect.stringContaining('load_plan') }));
    });

    it('should refuse a second takeoff', () => {
      const rec = flying();

      expect(() => rec.takeoff()).toThrow(expect.objectContaining({ kind: 'state' }));
    });
  });

  describe('goto', () => {
    it('should fly a straight leg at the configured speed and return the reached pose', () => {
      const rec = flying({ speedMps: 2 });

      const reached = rec.goto(pose(4, 0, 1, Math.PI / 2));

      expect(reached).toEqual(pose(4, 0, 1, Math.PI / 2));
      expect(rec.state().flightTimeS).toBeCloseTo(TAKEOFF_HEIGHT_M / 2 + 2);
      expect(rec.state().distanceM).toBeCloseTo(TAKEOFF_HEIGHT_M + 4);
      expect(rec.snapshot().segments.at(-1)).toMatchObject({ phase: 'transit', to: [4, 0, 1], yaw: Math.PI / 2 });
      expect(rec.snapshot().events.at(-1)).toMatchObject({ kind: 'arrived' });
    });

    it('should refuse to move on the ground', () => {
      const rec = new FlightRecorder();
      rec.loadPlan(plan([]), BOUNDS);

      expect(() => rec.goto(pose(1, 0, 1))).toThrow(expect.objectContaining({ kind: 'state' }));
    });

    it('should reject a non-finite pose', () => {
      const rec = flying();

      expect(() => rec.goto(pose(Number.NaN, 0, 1))).toThrow(expect.objectContaining({ kind: 'invalid' }));
    });

    it('should refuse a leg that would leave too little battery to get home, without moving', () => {
      const rec = flying({ speedMps: 1, maxFlightTimeS: 10 });

      // 1 s takeoff + 9 s out + 9 s back + 1 s down > 10 s
      expect(() => rec.goto(pose(9, 0, 1))).toThrow(expect.objectContaining({ kind: 'battery' }));
      expect(rec.state().pose).toEqual(pose(0, 0, 1));
      expect(rec.snapshot().events.at(-1)).toMatchObject({ kind: 'battery-rth' });
    });
  });

  describe('inspect', () => {
    it('should hover for the inspection time of the task type and mark it inspected', () => {
      const rec = flying({ speedMps: 1 }, [regionTask('r1', [2, -1, 1]), ndtTask('n1', [3, -1, 1])]);
      rec.goto(pose(2, 0, 1));

      rec.inspect('r1');
      rec.goto(pose(3, 0, 1));
      rec.inspect('n1');

      const [r1, n1] = rec.snapshot().tasks;
      expect(r1).toMatchObject({ status: 'visited', waypoint: [2, 0, 1], visitedAt: 1 + 2 + INSPECTION_DURATION_S.visual });
      expect(n1).toMatchObject({ status: 'visited', visitedAt: 1 + 2 + 3 + 1 + INSPECTION_DURATION_S.ndt_thickness });
      expect(rec.snapshot().events.filter((e) => e.kind === 'inspected').map((e) => e.taskId)).toEqual(['r1', 'n1']);
    });

    it('should accept a custom inspection time', () => {
      const rec = flying({ speedMps: 1 }, [regionTask('r1', [2, -1, 1])]);

      rec.inspect('r1', 0.5);

      expect(rec.snapshot().tasks[0].visitedAt).toBeCloseTo(1.5);
    });

    it('should attribute the legs flown since the last inspection to the inspected task (en route)', () => {
      const rec = flying({ speedMps: 1 }, [regionTask('r1', [2, -1, 1])]);
      rec.goto(pose(1, 0, 1));
      rec.goto(pose(2, 0, 1));

      rec.inspect('r1');

      const segments = rec.snapshot().segments;
      expect(segments.map((s) => [s.phase, s.taskId])).toEqual([
        ['takeoff', undefined],
        ['transit', 'r1'],
        ['transit', 'r1'],
        ['inspect', 'r1'],
      ]);
      expect(rec.snapshot().events.filter((e) => e.kind === 'arrived').map((e) => e.taskId)).toEqual(['r1', 'r1']);
    });

    it('should refuse a task with a preflight error and mark it skipped with the reason', () => {
      const rec = flying({}, [regionTask('out', [50, 0, 1])]);

      expect(() => rec.inspect('out')).toThrow(expect.objectContaining({ kind: 'invalid', message: expect.stringContaining('outside the area bounds') }));
      expect(rec.snapshot().tasks[0]).toMatchObject({ status: 'skipped', skippedAt: rec.state().flightTimeS });
      expect(rec.snapshot().tasks[0].skipReason).toContain('outside the area bounds');
      expect(rec.snapshot().events.at(-1)).toMatchObject({ kind: 'skipped', taskId: 'out' });
    });

    it('should reject an unknown task id', () => {
      const rec = flying();

      expect(() => rec.inspect('zzz')).toThrow(MissionError);
      expect(() => rec.inspect('zzz')).toThrow(expect.objectContaining({ kind: 'invalid', message: expect.stringContaining('zzz') }));
    });

    it('should refuse to inspect when the battery would not last until home', () => {
      const rec = flying({ speedMps: 1, maxFlightTimeS: 4 }, [ndtTask('n1', [0, -1, 1])]);

      expect(() => rec.inspect('n1')).toThrow(expect.objectContaining({ kind: 'battery' }));
      expect(rec.snapshot().tasks[0].status).toBe('pending');
    });
  });

  describe('returnHome and land', () => {
    it('should fly back above home, descend, and summarise the flight', () => {
      const rec = flying({ speedMps: 1 }, [regionTask('r1', [2, -1, 1])]);
      rec.goto(pose(2, 0, 1));
      rec.inspect('r1');

      rec.returnHome();
      const landed = rec.land();

      const mission = rec.snapshot();
      expect(landed).toMatchObject({ x: 0, y: 0, z: 0 });
      expect(mission.status).toBe('landed');
      expect(mission.segments.slice(-2).map((s) => s.phase)).toEqual(['return', 'land']);
      expect(mission.events.map((e) => e.kind)).toEqual(['takeoff', 'arrived', 'inspected', 'return', 'landed']);
      expect(mission.summary).toEqual({ tasksTotal: 1, visited: 1, skipped: 0, distanceM: 6, durationS: 6 + INSPECTION_DURATION_S.visual });
      expect(rec.state().state).toBe('landed');
    });

    it('should mark tasks left pending at landing as skipped', () => {
      const rec = flying({}, [regionTask('a', [2, 0, 1]), elementTaskWithoutCentre('e')]);

      rec.land();

      const [a, e] = rec.snapshot().tasks;
      expect(a).toMatchObject({ status: 'skipped', skipReason: 'not inspected' });
      expect(e.status).toBe('skipped');
      expect(e.skipReason).toContain('no targetElement');
      expect(rec.snapshot().summary).toMatchObject({ visited: 0, skipped: 2 });
    });

    it('should give battery as the reason when the drone had to turn back', () => {
      const rec = flying({ speedMps: 1, maxFlightTimeS: 10 }, [regionTask('far', [9, -1, 1])]);
      expect(() => rec.goto(pose(9, 0, 1))).toThrow();

      rec.returnHome();
      rec.land();

      expect(rec.snapshot().tasks[0]).toMatchObject({ status: 'skipped', skipReason: 'battery reserve reached' });
    });

    it('should remember which plans landed in this recorder', () => {
      const rec = flying();
      expect(rec.hasLanded('plan-1')).toBe(false);

      rec.land();

      expect(rec.hasLanded('plan-1')).toBe(true);
    });

    it('should refuse to land on the ground', () => {
      const rec = new FlightRecorder();
      rec.loadPlan(plan([]), BOUNDS);

      expect(() => rec.land()).toThrow(expect.objectContaining({ kind: 'state' }));
    });
  });

  it('should be deterministic', () => {
    const fly = () => {
      const rec = flying({}, [regionTask('a', [2, 0, 1])]);
      rec.goto(pose(2, -0.8, 1));
      rec.inspect('a');
      rec.returnHome();
      rec.land();
      return rec.snapshot();
    };

    expect(fly()).toEqual(fly());
  });
});

function flying(options: ConstructorParameters<typeof FlightRecorder>[0] = {}, tasks: PlanJsonTask[] = []): FlightRecorder {
  const rec = new FlightRecorder({ home: [0, 0, 0], ...options });
  rec.loadPlan(plan(tasks), BOUNDS);
  rec.takeoff();
  return rec;
}

function pose(x: number, y: number, z: number, yaw = 0): Pose {
  return { x, y, z, roll: 0, pitch: 0, yaw };
}

function plan(tasks: PlanJsonTask[]): PlanJson {
  return {
    planExternalId: 'plan-1',
    name: 'Test plan',
    description: null,
    areaExternalId: 'area-1',
    areaName: 'BWT 1',
    mapExternalId: null,
    downloadedAt: '2026-09-26T00:00:00Z',
    tasks,
  };
}

function regionTask(id: string, position3d: [number, number, number], normalVector: [number, number, number] = [0, 1, 0]): PlanJsonTask {
  return { id, kind: 'region', inspectionType: 'visual', position3d, normalVector, radiusM: 0.3 };
}

function ndtTask(id: string, position3d: [number, number, number]): PlanJsonTask {
  return { ...regionTask(id, position3d), inspectionType: 'ndt_thickness' };
}

function elementTask(id: string, center: [number, number, number]): PlanJsonTask {
  return { id, kind: 'element', inspectionType: 'visual', targetElement: { externalId: `el-${id}`, type: 'longitudinal', center } };
}

function elementTaskWithoutCentre(id: string): PlanJsonTask {
  return { id, kind: 'element', inspectionType: 'visual' };
}
