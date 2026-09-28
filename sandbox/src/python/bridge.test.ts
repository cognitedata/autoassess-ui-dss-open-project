import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDemoSnapshotSource } from '../data/DemoSnapshotSource';
import type { InspectionPlan, SandboxSnapshot } from '../domain/types';
import type { MissionResult } from '../sim/simulator';
import type { BridgeDeps, SandboxBridge } from './bridge';
import { createSandboxBridge, parseFlightOptions } from './bridge';

describe(createSandboxBridge.name, () => {
  let deps: BridgeDeps;
  let bridge: SandboxBridge;
  let resetRun: () => void;

  beforeEach(() => {
    deps = { getSnapshot: () => snapshotWithBox(), onMission: vi.fn(), onPlanPatch: vi.fn() };
    ({ module: bridge, resetRun } = createSandboxBridge(deps));
  });

  it('should serialise the current snapshot', async () => {
    const snapshot = await createDemoSnapshotSource().load();
    const { module } = createSandboxBridge({ ...deps, getSnapshot: () => snapshot });

    expect(JSON.parse(module.snapshot_json())).toEqual(snapshot);
  });

  it('should run the preflight check with the area bounds from the snapshot', () => {
    const issues = call(bridge.preflight(JSON.stringify(plan([50, 0, 0]))));

    expect(issues).toEqual([expect.objectContaining({ code: 'out-of-bounds', taskId: 't1' })]);
  });

  describe('flight steps', () => {
    it('should fly a whole mission step by step and notify the UI after every step', () => {
      call(bridge.sim_new(JSON.stringify({ speedMps: 1 })));

      const loaded = call(bridge.sim_load_plan(JSON.stringify(plan([1, 0, 1]))));
      call(bridge.sim_takeoff(JSON.stringify({ heightM: 1 })));
      call(bridge.sim_goto(JSON.stringify(pose(1, 0.8, 1))));
      call(bridge.sim_inspect(JSON.stringify({ taskId: 't1', seconds: null })));
      call(bridge.sim_return_home());
      call(bridge.sim_land());

      expect(loaded.result).toEqual([]);
      expect(deps.onMission).toHaveBeenCalledTimes(6);
      expect(lastMission()).toMatchObject({ status: 'landed', summary: { visited: 1, skipped: 0 } });
    });

    it('should tag posted missions with the plan status the data had when the plan was loaded', () => {
      loadAndTakeOff();

      expect(lastMission().planStatusAtStart).toBe('Ready');
    });

    it('should post partial missions while flying', () => {
      loadAndTakeOff();

      call(bridge.sim_goto(JSON.stringify(pose(1, 0.8, 1))));

      expect(lastMission()).toMatchObject({ status: 'in-flight', tasks: [{ id: 't1', status: 'pending' }] });
    });

    it('should return the reached pose, the drone state and the new events of a step', () => {
      loadAndTakeOff();

      const step = call(bridge.sim_goto(JSON.stringify(pose(1, 0.8, 1, 1.5))));

      expect(step.result).toEqual(pose(1, 0.8, 1, 1.5));
      expect(step.state).toMatchObject({ state: 'flying', pose: pose(1, 0.8, 1, 1.5) });
      expect(step.events).toEqual([expect.objectContaining({ kind: 'arrived' })]);
    });

    it('should report the drone state without changing anything', () => {
      loadAndTakeOff();

      const state = call(bridge.sim_state());

      expect(state).toMatchObject({ state: 'flying', pose: { z: 1 } });
      expect(deps.onMission).toHaveBeenCalledTimes(2);
    });

    it('should return the mission with telemetry as the report', () => {
      loadAndTakeOff();
      call(bridge.sim_land());

      const report = call(bridge.sim_report());

      expect(report.mission?.status).toBe('landed');
      expect(report.telemetry?.length).toBeGreaterThan(1);
    });

    it('should return errors as JSON with their kind instead of throwing', () => {
      expect(call(bridge.sim_load_plan('{"tasks": []}'))).toEqual({ error: 'plan.planExternalId must be a string', errorKind: 'invalid' });
      expect(call(bridge.sim_takeoff('{}'))).toMatchObject({ errorKind: 'state' });
      expect(deps.onMission).not.toHaveBeenCalled();
    });

    it('should report a battery refusal as its own error kind', () => {
      call(bridge.sim_new(JSON.stringify({ speedMps: 1, maxFlightTimeS: 3 })));
      call(bridge.sim_load_plan(JSON.stringify(plan([1, 0, 1]))));
      call(bridge.sim_takeoff('{}'));

      expect(call(bridge.sim_goto(JSON.stringify(pose(1.9, 0.9, 1.9))))).toMatchObject({ errorKind: 'battery' });
    });

    it('should still post the mission when a step fails after changing it (task skipped)', () => {
      call(bridge.sim_load_plan(JSON.stringify(plan([50, 0, 0]))));
      call(bridge.sim_takeoff('{}'));

      const result = call(bridge.sim_inspect(JSON.stringify({ taskId: 't1' })));

      expect(result.errorKind).toBe('invalid');
      expect(result.events).toEqual([expect.objectContaining({ kind: 'skipped', taskId: 't1' })]);
      expect(lastMission().tasks[0].status).toBe('skipped');
    });

    it('should start every run with a fresh drone', () => {
      loadAndTakeOff();

      resetRun();

      expect(call(bridge.sim_goto(JSON.stringify(pose(1, 0, 1))))).toMatchObject({ errorKind: 'state' });
    });

    it('should give a new SimDrone a fresh drone with its own options', () => {
      loadAndTakeOff();
      call(bridge.sim_land());

      call(bridge.sim_new(JSON.stringify({ speedMps: 2 })));

      expect(call(bridge.sim_takeoff('{}'))).toMatchObject({ errorKind: 'state' });
    });
  });

  describe('update_plan_status (simulated)', () => {
    it('should mark the plan Complete after a landed flight of it, without writing anywhere', () => {
      loadAndTakeOff();
      call(bridge.sim_land());

      const result = call(bridge.update_plan_status(JSON.stringify({ space: 's', externalId: 'p1', status: 'Complete' })));

      expect(result).toMatchObject({ externalId: 'p1', status: 'Complete' });
      expect(deps.onPlanPatch).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'p1', status: 'Complete' }));
    });

    it('should refuse before the plan has been flown', () => {
      const result = call(bridge.update_plan_status(JSON.stringify({ space: 's', externalId: 'p1', status: 'Complete' })));

      expect(result.errorKind).toBe('read-only');
      expect(result.error).toContain('land');
      expect(deps.onPlanPatch).not.toHaveBeenCalled();
    });

    it('should refuse any other status', () => {
      loadAndTakeOff();
      call(bridge.sim_land());

      const result = call(bridge.update_plan_status(JSON.stringify({ space: 's', externalId: 'p1', status: 'Draft' })));

      expect(result.errorKind).toBe('read-only');
      expect(deps.onPlanPatch).not.toHaveBeenCalled();
    });

    it('should forget landed flights on the next run', () => {
      loadAndTakeOff();
      call(bridge.sim_land());
      resetRun();

      const result = call(bridge.update_plan_status(JSON.stringify({ space: 's', externalId: 'p1', status: 'Complete' })));

      expect(result.errorKind).toBe('read-only');
    });

    it('should reject an unknown plan', () => {
      const result = call(bridge.update_plan_status(JSON.stringify({ space: 's', externalId: 'nope', status: 'Complete' })));

      expect(result).toMatchObject({ errorKind: 'invalid' });
    });
  });

  function loadAndTakeOff(): void {
    call(bridge.sim_load_plan(JSON.stringify(plan([1, 0, 1]))));
    call(bridge.sim_takeoff('{}'));
  }

  function lastMission(): MissionResult {
    const calls = vi.mocked(deps.onMission).mock.calls;
    const last = calls.at(-1);
    if (!last) throw new Error('no mission posted');
    return last[0];
  }
});

describe(parseFlightOptions.name, () => {
  it('should pick the known options', () => {
    expect(parseFlightOptions({ speedMps: 2, maxFlightTimeS: 60, home: [1, 2, 3], junk: 1 })).toEqual({
      speedMps: 2,
      maxFlightTimeS: 60,
      home: [1, 2, 3],
    });
  });

  it('should treat a null home as the default', () => {
    expect(parseFlightOptions({ home: null })).toEqual({});
  });

  it('should reject a malformed home', () => {
    expect(() => parseFlightOptions({ home: [1, 2] })).toThrow('home');
  });

  it('should ignore a non-object', () => {
    expect(parseFlightOptions(null)).toEqual({});
  });
});

/** The shapes the bridge returns (JSON that crosses into Python). */
interface BridgeReply {
  result?: unknown;
  state?: unknown;
  events?: unknown;
  error?: string;
  errorKind?: string;
  mission?: MissionResult;
  telemetry?: unknown[];
}

function call(json: string): BridgeReply {
  return JSON.parse(json) as BridgeReply;
}

function pose(x: number, y: number, z: number, yaw = 0) {
  return { x, y, z, roll: 0, pitch: 0, yaw };
}

function snapshotWithBox(): SandboxSnapshot {
  const planRow: InspectionPlan = {
    space: 's',
    externalId: 'p1',
    areaExternalId: 'a1',
    status: 'Ready',
    createdTime: 0,
    name: 'P1',
    description: null,
    mapExternalId: null,
  };
  return {
    mode: 'demo',
    sourceLabel: 'test',
    loadedAt: '',
    vessels: [],
    areas: [{ space: 's', externalId: 'a1', name: 'A', areaType: '', vesselExternalId: 'v', bounds: { min: [0, -1, 0], max: [2, 1, 2] } }],
    plans: [planRow],
    tasks: [],
    elements: [],
  };
}

function plan(position3d: [number, number, number]) {
  return {
    planExternalId: 'p1',
    areaExternalId: 'a1',
    tasks: [{ id: 't1', kind: 'region', inspectionType: 'visual', position3d, normalVector: [0, 1, 0] }],
  };
}
