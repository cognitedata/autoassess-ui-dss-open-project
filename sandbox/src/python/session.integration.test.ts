// @vitest-environment node
// Integration test: boots the real Pyodide (from node_modules) under Node and runs the sandbox
// Python packages + starter examples against the demo snapshot. No mocks.
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDemoSnapshotSource } from '../data/DemoSnapshotSource';
import type { InspectionPlan, SandboxSnapshot } from '../domain/types';
import { STARTER_EXAMPLES } from '../examples/examples';
import type { MissionResult } from '../sim/simulator';
import { PYTHON_FILES } from './pythonFiles';
import type { RunOutcome } from './session';
import { PythonSession } from './session';

describe('PythonSession (real Pyodide)', () => {
  let session: PythonSession;
  let snapshot: SandboxSnapshot;

  beforeAll(async () => {
    snapshot = await createDemoSnapshotSource().load();
    // Explicit indexURL: under vitest, source-mapped stacks break Pyodide's self-location.
    const indexURL = fileURLToPath(new URL('../../node_modules/pyodide/', import.meta.url));
    session = await PythonSession.create({ loadPyodide, indexURL, files: PYTHON_FILES, snapshot });
  }, 60_000);

  // A simulated plans.update_status patches the session's snapshot; start each test clean.
  beforeEach(() => session.setSnapshot(snapshot));

  it('should capture print output', async () => {
    const { stdout, outcome } = await run(session, 'print("hello", 1 + 1)');

    expect(outcome).toEqual({ ok: true });
    expect(stdout).toBe('hello 2\n');
  });

  it('should return a traceback that points at the user code only', async () => {
    const { outcome } = await run(session, 'x = 1\nraise ValueError("boom")');

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('File "main.py", line 2');
    expect(outcome.error).toContain('ValueError: boom');
    expect(outcome.error).not.toContain('/lib/python');
  });

  it('should not leak globals between runs', async () => {
    await run(session, 'leaked = 42');

    const { outcome } = await run(session, 'print(leaked)');

    expect(outcome.error).toContain("NameError: name 'leaked' is not defined");
  });

  it('should expose the SDK with the same shapes as the real uidss', async () => {
    const { stdout, outcome } = await run(
      session,
      [
        'from uidss import UidssClient',
        'c = UidssClient.from_env()',
        'v = c.vessels.list()[0]',
        'a = c.areas.list(v.space, v.external_id)[0]',
        'plans = c.plans.list(a.space, a.external_id)',
        'print(type(plans[0]).__name__, plans[0].created_time >= plans[-1].created_time)',
        't = c.plans.list_tasks("demo-plan-followup")[0]',
        'print(type(t).__name__, t.kind, t.target_element.center)',
      ].join('\n'),
    );

    expect(outcome).toEqual({ ok: true });
    expect(stdout).toContain('InspectionPlan True');
    expect(stdout).toContain('InspectionTask element (4.171, 0.237, 0.845)');
  });

  it('should write plan.json in the real SDK download format', async () => {
    const { stdout } = await run(
      session,
      [
        'import json',
        'from pathlib import Path',
        'from uidss import UidssClient',
        'c = UidssClient.from_env()',
        'c.plans.download("autoassess", "demo-plan-followup", "BWT 3P", Path("out/p.json"))',
        'd = json.loads(Path("out/p.json").read_text())',
        'print(sorted(d))',
        'print(d["tasks"][5])',
      ].join('\n'),
    );

    expect(stdout).toContain(
      "['areaExternalId', 'areaName', 'description', 'downloadedAt', 'mapExternalId', 'name', 'planExternalId', 'tasks']",
    );
    expect(stdout).toContain("'kind': 'region', 'inspectionType': 'ndt_thickness', 'position3d': [2.2, 1.09, 0.92]");
  });

  it('should refuse CDF writes (status update of a plan that was not flown)', async () => {
    const { outcome } = await run(
      session,
      'from uidss import UidssClient\nUidssClient.from_env().plans.update_status("autoassess", "demo-plan-followup", "Complete")',
    );

    expect(outcome.error).toContain('SandboxReadOnlyError');
    expect(outcome.error).toContain('landed');
  });

  it('should refuse services that upload to CDF', async () => {
    const { outcome } = await run(session, 'from uidss import UidssClient\nUidssClient.from_env().campaigns');

    expect(outcome.error).toContain('AttributeError: client.campaigns is not available in the sandbox');
  });

  it('should keep hasattr/getattr working for services the sandbox lacks', async () => {
    const { stdout, outcome } = await run(
      session,
      'from uidss import UidssClient\nc = UidssClient.from_env()\nprint(hasattr(c, "campaigns"), getattr(c, "threed", None))',
    );

    expect(outcome).toEqual({ ok: true });
    expect(stdout.trim()).toBe('False None');
  });

  it('should have no module-level drone singleton', async () => {
    const { outcome } = await run(session, 'from dss_sandbox import drone');

    expect(outcome.error).toContain('ImportError');
  });

  describe('SimDrone primitives', () => {
    const LOAD = [
      'from uidss import UidssClient',
      'from dss_sandbox import SimDrone, Pose, BatteryLowError, pose_for_task',
      'UidssClient.from_env().plans.download("autoassess", "demo-plan-ndt-sweep", "BWT 3P", "p.json")',
    ].join('\n');

    it('should take off, fly to a pose, inspect, return home and land', async () => {
      const { stdout, outcome, missions } = await run(
        session,
        [
          LOAD,
          'sim_drone = SimDrone(speed_mps=1.0)',
          'print("issues", sim_drone.load_plan("p.json"))',
          'home = sim_drone.pose',
          'print("before", sim_drone.state)',
          'up = sim_drone.takeoff(height_m=1.0)',
          'print("up", round(up.z - home.z, 3), sim_drone.state)',
          'reached = sim_drone.goto(Pose(1.0, -1.0, 1.2, yaw=-1.5708))',
          'print("reached", reached == Pose(1.0, -1.0, 1.2, yaw=-1.5708))',
          'sim_drone.inspect("demo-plan-ndt-sweep-task-1")',
          'sim_drone.return_home()',
          'down = sim_drone.land()',
          'print("down", sim_drone.state, down.position == home.position)',
          'r = sim_drone.report()',
          'print("visited", r.visited, "t", sim_drone.flight_time_s > 8, "d", sim_drone.distance_m > 2)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('issues []');
      expect(stdout).toContain('before landed');
      expect(stdout).toContain('up 1.0 flying');
      expect(stdout).toContain('reached True');
      expect(stdout).toContain('down landed True');
      expect(stdout).toContain("visited ['demo-plan-ndt-sweep-task-1'] t True d True");
      expect(missions.at(-1)).toMatchObject({ status: 'landed', planExternalId: 'demo-plan-ndt-sweep' });
    });

    it('should call on_event synchronously for every step', async () => {
      const { stdout } = await run(
        session,
        [
          LOAD,
          'sim_drone = SimDrone()',
          'sim_drone.on_event(lambda e: print("event", e.kind, e.task_id))',
          'sim_drone.load_plan("p.json")',
          'sim_drone.takeoff()',
          'print("after takeoff")',
          'sim_drone.land()',
        ].join('\n'),
      );

      expect(stdout.indexOf('event takeoff None')).toBeLessThan(stdout.indexOf('after takeoff'));
      expect(stdout).toContain('event skipped demo-plan-ndt-sweep-task-1');
      expect(stdout).toContain('event landed None');
    });

    it('should raise RuntimeError when moving on the ground', async () => {
      const { outcome } = await run(session, `${LOAD}\nsim_drone = SimDrone()\nsim_drone.load_plan("p.json")\nsim_drone.goto(Pose(1, 0, 1))`);

      expect(outcome.error).toContain('RuntimeError: Cannot goto: the drone is not flying');
    });

    it('should raise a clear error when taking off without a plan', async () => {
      const { outcome } = await run(session, `${LOAD}\nSimDrone().takeoff()`);

      expect(outcome.error).toContain('RuntimeError: Cannot take off: no plan loaded');
    });

    it('should raise BatteryLowError when a leg would not leave enough battery to get home', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          LOAD,
          'sim_drone = SimDrone(max_flight_time_s=10)',
          'sim_drone.load_plan("p.json")',
          'sim_drone.takeoff()',
          'try:',
          '    sim_drone.goto(Pose(11.0, -1.0, 1.2))',
          'except BatteryLowError as err:',
          '    print("low:", err)',
          'print(sim_drone.pose.x == sim_drone.report().telemetry[0].x)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('low: Not enough battery');
      expect(stdout).toContain('True');
    });

    it('should refuse to inspect a task with a pre-flight error (ValueError) and record it as skipped', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          'from uidss import UidssClient',
          'from dss_sandbox import SimDrone',
          'UidssClient.from_env().plans.download("autoassess", "demo-plan-draft", "BWT 3P", "d.json")',
          'sim_drone = SimDrone()',
          'sim_drone.load_plan("d.json")',
          'sim_drone.takeoff()',
          'try:',
          '    sim_drone.inspect("demo-plan-draft-task-1")',
          'except ValueError as err:',
          '    print("refused:", err)',
          'print(sim_drone.report().skipped)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('refused: Task demo-plan-draft-task-1 cannot be inspected');
      expect(stdout).toContain("{'demo-plan-draft-task-1': 'element task has no targetElement centre'}");
    });

    it('should only accept a Pose in goto', async () => {
      const { outcome } = await run(session, `${LOAD}\nSimDrone().goto((1, 2, 3))`);

      expect(outcome.error).toContain('TypeError: goto() expects a Pose');
    });

    it('should reject a malformed plan', async () => {
      const { outcome } = await run(session, 'from dss_sandbox import SimDrone\nSimDrone().load_plan({"tasks": 3})');

      expect(outcome.error).toContain('ValueError: plan.tasks must be a list');
    });

    it('should compute a pose facing the task surface', async () => {
      const { stdout } = await run(
        session,
        [
          'from math import degrees',
          'from dss_sandbox import Pose, pose_for_task',
          'region = {"id": "r", "kind": "region", "inspectionType": "visual", "position3d": [2, 0, 1], "normalVector": [0, 2, 0]}',
          'p = pose_for_task(region, standoff_m=0.5)',
          'print("region", p.position, round(degrees(p.yaw)), round(degrees(p.pitch)))',
          'element = {"id": "e", "kind": "element", "inspectionType": "visual", "targetElement": {"externalId": "x", "type": "wall", "center": [4, 0, 1]}}',
          'print("above", pose_for_task(element, standoff_m=1).position, round(degrees(pose_for_task(element).pitch)))',
          'print("approach", pose_for_task(element, standoff_m=1, approach_from=Pose(0, 0, 1)).position)',
          'print("facing", Pose.facing((0, 0, 0), (1, 0, 0), 2).position)',
        ].join('\n'),
      );

      expect(stdout).toContain('region (2.0, 0.5, 1.0) -90 0');
      expect(stdout).toContain('above (4.0, 0.0, 2.0) -90');
      expect(stdout).toContain('approach (3.0, 0.0, 1.0)');
      expect(stdout).toContain('facing (2.0, 0.0, 0.0)');
    });
  });

  describe('SimDrone.fly_plan', () => {
    it('should fly every task of a valid plan and land', async () => {
      const { stdout, outcome, missions } = await run(
        session,
        [
          'from uidss import UidssClient',
          'from dss_sandbox import SimDrone',
          'UidssClient.from_env().plans.download("autoassess", "demo-plan-followup", "BWT 3P", "p.json")',
          'report = SimDrone().fly_plan("p.json")',
          'print(report.summary())',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('Mission demo-plan-followup: 8/8 tasks inspected');
      expect(missions.at(-1)).toMatchObject({ status: 'landed', summary: { visited: 8, skipped: 0 } });
    });

    it('should skip tasks with pre-flight errors and keep flying', async () => {
      const { stdout, outcome, missions } = await run(
        session,
        [
          'from uidss import UidssClient',
          'from dss_sandbox import SimDrone',
          'UidssClient.from_env().plans.download("autoassess", "demo-plan-draft", "BWT 3P", "d.json")',
          'print(SimDrone().fly_plan("d.json").summary())',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('Mission demo-plan-draft: 2/4 tasks inspected');
      expect(stdout).toContain('skipped demo-plan-draft-task-2');
      expect(missions.at(-1)?.status).toBe('landed');
    });

    it('should turn back when the battery runs low and report the rest as skipped', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          'from uidss import UidssClient',
          'from dss_sandbox import SimDrone',
          'UidssClient.from_env().plans.download("autoassess", "demo-plan-ndt-sweep", "BWT 3P", "p.json")',
          'report = SimDrone(max_flight_time_s=40).fly_plan("p.json")',
          'print(len(report.visited), set(report.skipped.values()))',
          'print(report.events[-1].kind)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toMatch(/^[1-5] \{'battery reserve reached'\}$/m);
      expect(stdout).toContain('landed');
    });

    it('should fly tasks in a given order', async () => {
      const { stdout } = await run(
        session,
        [
          'from uidss import UidssClient',
          'from dss_sandbox import SimDrone',
          'UidssClient.from_env().plans.download("autoassess", "demo-plan-ndt-sweep", "BWT 3P", "p.json")',
          'order = ["demo-plan-ndt-sweep-task-3", "demo-plan-ndt-sweep-task-1"]',
          'r = SimDrone().fly_plan("p.json", order=order)',
          'print([e.task_id for e in r.events if e.kind == "inspected"], len(r.skipped))',
        ].join('\n'),
      );

      expect(stdout).toContain("['demo-plan-ndt-sweep-task-3', 'demo-plan-ndt-sweep-task-1'] 4");
    });
  });

  describe('simulated plans.update_status', () => {
    it('should mark a flown plan Complete in the browser only, and later reads see it', async () => {
      const { stdout, outcome, planPatches } = await run(
        session,
        [
          'from uidss import UidssClient',
          'from dss_sandbox import SimDrone',
          'client = UidssClient.from_env()',
          'client.plans.download("autoassess", "demo-plan-ndt-sweep", "BWT 3P", "p.json")',
          'SimDrone().fly_plan("p.json")',
          'client.plans.update_status("autoassess", "demo-plan-ndt-sweep", "Complete")',
          'same = {p.external_id: p.status for p in client.plans.list("autoassess", "demo-area-bwt3p")}',
          'fresh = {p.external_id: p.status for p in UidssClient.from_env().plans.list("autoassess", "demo-area-bwt3p")}',
          'print(same["demo-plan-ndt-sweep"], fresh["demo-plan-ndt-sweep"])',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('simulated: plan demo-plan-ndt-sweep → Complete (not written to CDF)');
      expect(stdout).toContain('Complete Complete');
      expect(planPatches).toEqual([expect.objectContaining({ externalId: 'demo-plan-ndt-sweep', status: 'Complete' })]);
      expect(session.getSnapshot().plans.find((p) => p.externalId === 'demo-plan-ndt-sweep')?.status).toBe('Complete');
    });

    it('should refuse any status other than Complete', async () => {
      const { outcome, planPatches } = await run(
        session,
        [
          'from uidss import UidssClient',
          'from dss_sandbox import SimDrone',
          'client = UidssClient.from_env()',
          'client.plans.download("autoassess", "demo-plan-ndt-sweep", "BWT 3P", "p.json")',
          'SimDrone().fly_plan("p.json")',
          'client.plans.update_status("autoassess", "demo-plan-ndt-sweep", "Draft")',
        ].join('\n'),
      );

      expect(outcome.error).toContain('SandboxReadOnlyError');
      expect(planPatches).toEqual([]);
    });
  });

  it('should run the "list plans" starter example', async () => {
    const { stdout, outcome } = await run(session, example('list-plans'));

    expect(outcome).toEqual({ ok: true });
    expect(stdout).toContain('Vessel: Demo Vessel (sandbox)');
    expect(stdout).toMatch(/Ready\s+Tank 3 follow-up\s+8 tasks/);
  });

  it('should run the "verify a plan" starter example and flag the broken draft', async () => {
    const { stdout, outcome } = await run(session, example('verify-plan'));

    expect(outcome).toEqual({ ok: true });
    expect(stdout).toContain('[PASS] BWT 3P / Tank 3 follow-up');
    expect(stdout).toContain('[FAIL (3)] BWT 3P / Draft – needs review');
    expect(stdout).toContain('demo-plan-draft-task-1: no pose');
  });

  it('should run the "fly the mission" starter example and mark the plan Complete (simulated)', async () => {
    const { stdout, outcome, missions, planPatches } = await run(session, example('fly-mission'));

    expect(outcome).toEqual({ ok: true });
    expect(missions.at(-1)).toMatchObject({ planExternalId: 'demo-plan-followup', status: 'landed', summary: { visited: 8 } });
    expect(stdout).toContain('Mission demo-plan-followup: 8/8 tasks inspected');
    expect(stdout).toMatch(/t=\s*0\.0s\s+Take-off/);
    expect(stdout).toContain('simulated: plan demo-plan-followup → Complete (not written to CDF)');
    expect(planPatches).toEqual([expect.objectContaining({ externalId: 'demo-plan-followup', status: 'Complete' })]);
  });

  it('should run the "hand-fly with poses" starter example', async () => {
    const { stdout, outcome, missions } = await run(session, example('hand-fly'));

    expect(outcome).toEqual({ ok: true });
    expect(missions.at(-1)).toMatchObject({ status: 'landed' });
    expect(missions.at(-1)?.summary.visited).toBeGreaterThan(0);
    expect(stdout).toContain('goto Pose(');
    expect(stdout).toMatch(/inspected\s+demo-plan-followup-task-1/);
    expect(stdout).toContain('Mission demo-plan-followup: 8/8 tasks inspected');
  });

  describe('with real-project quirks: a newer empty Ready plan and an unnamed plan', () => {
    let quirkySession: PythonSession;
    let quirky: SandboxSnapshot;

    beforeEach(() => quirkySession.setSnapshot(quirky));

    beforeAll(async () => {
      const followup = snapshot.plans.find((p) => p.externalId === 'demo-plan-followup')!;
      const emptyReady = { ...followup, externalId: 'empty-ready', name: null, createdTime: followup.createdTime + 1 };
      quirky = { ...snapshot, plans: [...snapshot.plans, emptyReady] };
      const indexURL = fileURLToPath(new URL('../../node_modules/pyodide/', import.meta.url));
      quirkySession = await PythonSession.create({ loadPyodide, indexURL, files: PYTHON_FILES, snapshot: quirky });
    }, 60_000);

    it('should fly the newest Ready plan that has tasks, not an empty one', async () => {
      const { outcome, missions } = await run(quirkySession, example('fly-mission'));

      expect(outcome).toEqual({ ok: true });
      expect(missions.at(-1)?.planExternalId).toBe('demo-plan-followup');
    });

    it('should label an unnamed plan in the fly-mission example', async () => {
      const renamed = await run(quirkySession, example('fly-mission').replace("key=lambda c: c[1].created_time", "key=lambda c: c[1].external_id == 'empty-ready'").replace('counts[p.external_id] > 0', 'True'));

      expect(renamed.stdout).toContain('Plan: (unnamed) in BWT 3P');
    });

    it('should label unnamed plans in the verify example', async () => {
      const { stdout } = await run(quirkySession, example('verify-plan'));

      expect(stdout).toContain('BWT 3P / (unnamed) [Ready]');
      expect(stdout).not.toContain('/ None [');
    });
  });
});

async function run(
  session: PythonSession,
  code: string,
): Promise<{ stdout: string; stderr: string; outcome: RunOutcome; missions: MissionResult[]; planPatches: InspectionPlan[] }> {
  let stdout = '';
  let stderr = '';
  const missions: MissionResult[] = [];
  const planPatches: InspectionPlan[] = [];
  const outcome = await session.run(code, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    mission: (m) => missions.push(m),
    planPatch: (p) => planPatches.push(p),
  });
  return { stdout, stderr, outcome, missions, planPatches };
}

function example(id: string): string {
  const found = STARTER_EXAMPLES.find((e) => e.id === id);
  if (!found) throw new Error(`no example ${id}`);
  return found.code;
}
