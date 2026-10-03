// @vitest-environment node
// Integration test: boots the real Pyodide (from node_modules) under Node and runs the sandbox
// Python packages + starter examples against the demo snapshot. No mocks.
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDemoSnapshotSource } from '../data/DemoSnapshotSource';
import type { InspectionPlan, InspectionTask, SandboxSnapshot } from '../domain/types';
import { STARTER_EXAMPLES } from '../examples/examples';
import type { MissionResult } from '../sim/simulator';
import { PYTHON_FILES } from './pythonFiles';
import type { RunOutcome } from './session';
import { PythonSession } from './session';

/** The bridge's pick key as written in the starter examples (Active first, then recency). */
const EXAMPLES_PICK_KEY =
  'key=lambda c: (c[1].status == "Active", c[1].last_updated_time, c[1].created_time)';

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
        'print("updated", plans[0].last_updated_time == plans[0].created_time > 0)',
        't = c.plans.list_tasks("demo-plan-followup")[0]',
        'print(type(t).__name__, t.kind, t.target_element.center)',
      ].join('\n'),
    );

    expect(outcome).toEqual({ ok: true });
    expect(stdout).toContain('InspectionPlan True');
    expect(stdout).toContain('updated True');
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

  describe('simulated gbplanner (dss_sandbox.gbplanner)', () => {
    const SETUP = [
      'from uidss import UidssClient',
      'from dss_sandbox import SimDrone, Pose',
      'from dss_sandbox.gbplanner import SimGbPlanner',
      'UidssClient.from_env().plans.download("autoassess", "demo-plan-followup", "BWT 3P", "p.json")',
      'sim_drone = SimDrone(speed_mps=1.0, max_flight_time_s=1800)',
      'sim_drone.load_plan("p.json")',
    ].join('\n');

    it('should build ROS-shaped messages with gbplanner field names and defaults', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          'from dss_sandbox.gbplanner import geometry_msgs, nav_msgs, planner_msgs, std_msgs, std_srvs',
          'print(geometry_msgs.PoseStamped())',
          'print(nav_msgs.Path().poses, std_msgs.Bool().data)',
          'print(planner_msgs.planner_set_global_bound.Request())',
          'print(planner_msgs.PlannerStatus().trigger_mode.kAuto, planner_msgs.ExecutionPathMode.kHomingPath)',
          'print(std_srvs.Trigger.Response(), std_srvs.TriggerRequest is std_srvs.Trigger.Request)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain(
        "PoseStamped(header=Header(seq=0, stamp=0.0, frame_id=''), pose=Pose(position=Point(x=0.0, y=0.0, z=0.0), orientation=Quaternion(x=0.0, y=0.0, z=0.0, w=1.0)))",
      );
      expect(stdout).toContain('[] False');
      expect(stdout).toContain(
        'Request(get_current_bound=False, reset_to_default=False, bound=PlanningBound(use_z_val=False, min_val=Point(x=0.0, y=0.0, z=0.0), max_val=Point(x=0.0, y=0.0, z=0.0)))',
      );
      expect(stdout).toContain('1 1');
      expect(stdout).toContain("Response(success=False, message='') True");
    });

    it('should round-trip a sandbox Pose through a quaternion, with ROS pitch = -sandbox pitch', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          'from dss_sandbox import Pose',
          'from dss_sandbox.gbplanner import euler_from_quaternion, quaternion_from_euler, to_pose_stamped, to_sandbox_pose',
          'p = Pose(1.0, 2.0, 3.0, roll=0.1, pitch=0.3, yaw=-2.0)',
          'msg = to_pose_stamped(p, stamp=4.5)',
          'q = msg.pose.orientation',
          'print("frame", msg.header.frame_id, msg.header.stamp)',
          'print("ros", [round(a, 6) for a in euler_from_quaternion(q)])',
          'back = to_sandbox_pose(msg)',
          'print("back", [round(v, 6) for v in (back.x, back.y, back.z, back.roll, back.pitch, back.yaw)])',
          'yaw90 = quaternion_from_euler(0, 0, 1.5707963267948966)',
          'print("yaw90", round(yaw90.z, 6), round(yaw90.w, 6))',
          'down = to_pose_stamped(Pose(0, 0, 0, pitch=-0.5)).pose.orientation',
          'print("nose-down ros pitch", round(euler_from_quaternion(down)[1], 6))',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('frame world 4.5');
      expect(stdout).toContain('ros [0.1, -0.3, -2.0]');
      expect(stdout).toContain('back [1.0, 2.0, 3.0, 0.1, 0.3, -2.0]');
      expect(stdout).toContain('yaw90 0.707107 0.707107');
      expect(stdout).toContain('nose-down ros pitch 0.5');
    });

    it('should raise ValueError listing the supported names for an unknown service or topic', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          SETUP,
          'sim_gbplanner = SimGbPlanner(sim_drone, verbose=False)',
          'for fn in (lambda: sim_gbplanner.ros.call("gbplanner/explore"), lambda: sim_gbplanner.ros.subscribe("/octomap", print)):',
          '    try:',
          '        fn()',
          '    except ValueError as err:',
          '        print("ValueError:", err)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain("ValueError: Unknown service 'gbplanner/explore'. Supported services: pci_initialization_trigger, ");
      expect(stdout).toContain('planner_control_interface/std_srvs/automatic_planning');
      expect(stdout).toContain('gbplanner/set_global_bound');
      expect(stdout).toContain("ValueError: Unknown topic '/octomap'. Topics you can subscribe to: /gbplanner_path, /robot_status");
    });

    it('should raise TypeError for a request of the wrong type', async () => {
      const { outcome } = await run(
        session,
        [
          SETUP,
          'from dss_sandbox.gbplanner import std_srvs',
          'SimGbPlanner(sim_drone).ros.call("gbplanner/set_global_bound", std_srvs.SetBool.Request(data=True))',
        ].join('\n'),
      );

      expect(outcome.error).toContain('TypeError: gbplanner/set_global_bound expects planner_set_global_bound.Request, got Request');
    });

    it('should stop planning on a std_msgs/Bool on planner_control_interface/stop_request', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          SETUP,
          'from dss_sandbox.gbplanner import std_msgs',
          'sim_gbplanner = SimGbPlanner(sim_drone, verbose=False)',
          'ros = sim_gbplanner.ros',
          'ros.call("pci_initialization_trigger")',
          'ros.call("planner_control_interface/std_srvs/automatic_planning")',
          'ros.publish("planner_control_interface/stop_request", std_msgs.Bool(data=True))',
          'ros.spin()',
          'print("after stop", sim_gbplanner.mode, sim_gbplanner.report().iterations)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('after stop idle 0');
    });

    it('should need a plan loaded (the area) before creating the planner', async () => {
      const { outcome } = await run(
        session,
        'from dss_sandbox import SimDrone\nfrom dss_sandbox.gbplanner import SimGbPlanner\nSimGbPlanner(SimDrone())',
      );

      expect(outcome.error).toContain('RuntimeError: SimGbPlanner needs the area: call sim_drone.load_plan(plan) first');
    });

    it('should call a /gbplanner_path subscriber once per planning iteration', async () => {
      const { stdout, outcome, missions } = await run(
        session,
        [
          SETUP,
          'sim_gbplanner = SimGbPlanner(sim_drone, config="cave_exploration", verbose=False)',
          'paths = []',
          'sim_gbplanner.ros.subscribe("/gbplanner_path", paths.append)',
          'print("init", sim_gbplanner.ros.call("pci_initialization_trigger").success, sim_drone.state)',
          'for _ in range(3):',
          '    sim_gbplanner.ros.call("planner_control_interface/std_srvs/single_planning")',
          '    sim_gbplanner.ros.spin()',
          'r = sim_gbplanner.report()',
          'print("count", len(paths), r.iterations)',
          'print("seq", [p.header.seq for p in paths])',
          'print("types", type(paths[0]).__name__, type(paths[0].poses[0]).__name__, paths[0].header.frame_id)',
          'print("mode", sim_gbplanner.mode)',
          'st = sim_gbplanner.status()',
          'print("status", type(st).__name__, st.trigger_mode.mode, st.max_vel, st.header.stamp == sim_drone.flight_time_s)',
          'statuses = []',
          'sim_gbplanner.ros.subscribe("robot_status", statuses.append)',
          'sim_gbplanner.ros.call("planner_control_interface/std_srvs/single_planning")',
          'sim_gbplanner.ros.spin()',
          'print("robot_status", type(statuses[-1]).__name__, 0 < statuses[-1].time_remaining < 1800)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('init True flying');
      expect(stdout).toContain('count 3 3');
      expect(stdout).toContain('seq [1, 2, 3]');
      expect(stdout).toContain('types Path PoseStamped world');
      expect(stdout).toContain('mode idle');
      expect(stdout).toContain('status PlannerStatus 0 1.0 True');
      expect(stdout).toContain('robot_status RobotStatus True');
      expect(missions.at(-1)?.planner?.timeline).toHaveLength(4);
    });

    it('should run example 5 (explore + inspect) one compartment at a time, cover the demo tasks and land, well inside the run timeout', async () => {
      const started = performance.now();
      const { stdout, outcome, missions } = await run(session, example('gb-explore'));
      const elapsedMs = performance.now() - started;
      console.info(`example 5 in Pyodide: ${elapsedMs.toFixed(0)} ms`);

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('set_global_bound: True');
      expect(stdout).toMatch(/path t=\s*\d+\.\ds\s+\d+ poses/);
      const covered = Number(/plan tasks covered by the inspection camera: (\d+)\/8/.exec(stdout)?.[1]);
      expect(covered).toBeGreaterThanOrEqual(6);
      // The BWT flow works the demo tank's 5 compartments in turn, passing the manholes.
      expect(stdout).toContain('[gbplanner] Compartments: 5');
      expect(stdout).toMatch(/passing the manhole at .* to compartment 2\/5/);
      expect(stdout).toMatch(/Compartment 5\/5/);
      // The report prints per-compartment exploration and coverage.
      const perCompartment = stdout.match(/compartment \d \(x [-\d. –]+\): explored \d+%, coverage \d+%/g) ?? [];
      expect(perCompartment).toHaveLength(5);
      for (const line of perCompartment) {
        expect(Number(/coverage (\d+)%/.exec(line)?.[1])).toBeGreaterThanOrEqual(60);
      }
      const mission = missions.at(-1);
      expect(mission).toMatchObject({ status: 'landed', planExternalId: 'demo-plan-followup' });
      expect(mission?.planner?.viewpoints.length).toBeGreaterThan(0);
      expect(Object.keys(mission?.planner?.coveredTasks ?? {})).toHaveLength(covered);
      expect(mission?.planner?.progress.at(-1)).toMatchObject({ compartments: 5 });
      // CI runners are slower than dev machines; keep the strict budget locally
      // while staying well inside the 30s test timeout on CI.
      expect(elapsedMs).toBeLessThan(process.env.CI ? 20_000 : 7_000);
    });

    it('should run example 6 (target reach per task) and inspect the tasks', async () => {
      const { stdout, outcome, missions } = await run(session, example('gb-target-reach'));

      expect(outcome).toEqual({ ok: true });
      expect(stdout.match(/^inspected demo-plan-followup-task-\d+/gm)?.length ?? 0).toBeGreaterThanOrEqual(5);
      expect(missions.at(-1)).toMatchObject({ status: 'landed', planExternalId: 'demo-plan-followup' });
      expect(missions.at(-1)?.summary.visited).toBeGreaterThanOrEqual(5);
    });
  });

  describe('simulated autoassess_bridge (/autoassess/* on sim_gbplanner.ros)', () => {
    const SETUP = [
      'import json',
      'from uidss import UidssClient',
      'from dss_sandbox import SimDrone',
      'from dss_sandbox.gbplanner import SimGbPlanner, std_msgs',
      'UidssClient.from_env().plans.download("autoassess", "demo-plan-followup", "BWT 3P", "p.json")',
      'sim_drone = SimDrone(speed_mps=1.0, max_flight_time_s=1800)',
      'sim_drone.load_plan("p.json")',
      'sim_gbplanner = SimGbPlanner(sim_drone, verbose=False)',
      'ros = sim_gbplanner.ros',
    ].join('\n');

    it('should run example 7 (bridge: plans in, findings out) end to end', async () => {
      const { stdout, outcome, missions } = await run(session, example('bridge'));

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('plan_id: demo-plan-followup');
      expect(stdout).toMatch(/bridge plan: .* — 8 tasks, 8 inspection target poses, upload idle/);
      expect(stdout).toContain('[autoassess_bridge] skipping finding: entry 1: z is missing');
      expect(stdout).toContain('upload_status: idle -> exporting_mesh -> uploading -> complete');
      expect(stdout).toContain('simulated: 2 defect detections created on the campaign (not written to CDF)');
      expect(stdout).toContain('defects: 2 created: defect-corr-001, defect-crack-002');
      expect(missions.at(-1)).toMatchObject({ status: 'landed', summary: { visited: 8 } });
    });

    it('should serve the latched plan topics with the real bridge message shapes', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          SETUP,
          'plans, ids, targets, statuses = [], [], [], []',
          'ros.subscribe("/autoassess/plan", plans.append)',
          'ros.subscribe("autoassess/plan_id", ids.append)  # leading slash optional, as in ROS',
          'ros.subscribe("/autoassess/inspection_targets", targets.append)',
          'ros.subscribe("/autoassess/upload_status", statuses.append)',
          'print("types", type(plans[0]).__name__, type(ids[0]).__name__, type(targets[0]).__name__)',
          'plan = json.loads(plans[0].data)',
          'print("plan", plan["planExternalId"], len(plan["tasks"]), ids[0].data)',
          'print("targets", len(targets[0].poses), targets[0].header.frame_id)',
          'print("status", json.loads(statuses[0].data)["state"], json.loads(statuses[0].data)["findings"])',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('types String String PoseArray');
      expect(stdout).toContain('plan demo-plan-followup 8 demo-plan-followup');
      expect(stdout).toContain('targets 8 world');
      expect(stdout).toContain('status idle None');
    });

    it('should validate findings with the real bridge rules: bad entries skipped and logged, ids deduped', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          SETUP,
          'statuses = []',
          'ros.subscribe("/autoassess/upload_status", lambda m: statuses.append(json.loads(m.data)))',
          'ros.publish("/autoassess/findings", {"id": "a", "x": 1.0, "y": 0.0, "z": 1.0})',
          'ros.publish("/autoassess/findings", {"id": "a", "x": 9.0, "y": 9.0, "z": 9.0})  # dup: first wins',
          'ros.publish("/autoassess/findings", std_msgs.String(data="not json"))',
          'ros.publish("/autoassess/findings", [',
          '    {"id": "b+c", "x": 1, "y": 1, "z": 1},',
          '    {"id": "c", "x": 1, "y": 1, "z": 1, "nx": 0.0, "ny": 0.0},',
          '    {"id": "d", "x": 1, "y": 1, "z": 1, "radius": -1},',
          '    {"id": "e", "x": 1, "y": 1, "z": 1, "confidence": 2},',
          '    {"id": "f", "x": 1, "y": 1, "z": 1, "inspection_type": "sonar"},',
          '    {"id": "g", "x": float("nan"), "y": 1, "z": 1},',
          '    {"id": "ok-2", "x": 2.0, "y": 0.5, "z": 1.0, "inspection_type": "ndt_thickness"},',
          '])',
          'try:',
          '    ros.publish("/autoassess/findings", 42)',
          'except TypeError as err:',
          '    print("TypeError:", err)',
          'sim_drone.takeoff()',
          'sim_drone.return_home()',
          'sim_drone.land()',
          'print("final", statuses[-1]["state"], statuses[-1]["findings"])',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('[autoassess_bridge] skipping finding: not JSON:');
      expect(stdout).toContain("entry 0: id 'b+c' must not contain '+'");
      expect(stdout).toContain('entry 1: nx, ny and nz must all be set or all be missing');
      expect(stdout).toContain('entry 2: radius must be a positive number of metres, got -1');
      expect(stdout).toContain('entry 3: confidence must be between 0 and 1, got 2');
      expect(stdout).toContain("entry 4: inspection_type must be visual or ndt_thickness, got 'sonar'");
      expect(stdout).toContain('entry 5: x nan is not a finite number');
      expect(stdout).toContain('TypeError:');
      expect(stdout).toContain(
        "final complete {'count': 2, 'defectExternalIds': ['defect-a', 'defect-ok-2']}",
      );
    });

    it('should answer the upload_mission service and start a new mission on the next take-off', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          SETUP,
          'states = []',
          'ros.subscribe("/autoassess/upload_status", lambda m: states.append(json.loads(m.data)))',
          'ros.publish("/autoassess/findings", {"id": "m1", "x": 1.0, "y": 0.0, "z": 1.0})',
          'resp = ros.call("autoassess_bridge/upload_mission")',
          'print("resp", resp.success, resp.message)',
          '# Each flight is its own mission: the next landing ends mission-002 (no findings).',
          'sim_drone.load_plan("p.json")  # a landed flight needs the plan loaded again',
          'sim_drone.takeoff()',
          'sim_drone.return_home()',
          'sim_drone.land()',
          'print("missions", [s["missionId"] for s in states if s["state"] == "complete"])',
          'print("no findings", states[-1]["findings"])',
          'sim_drone.load_plan("p.json")',
          'sim_drone.takeoff()',
          'ros.publish("/autoassess/findings", {"id": "m2", "x": 1.0, "y": 0.5, "z": 1.0})',
          'sim_drone.return_home()',
          'sim_drone.land()',
          'print("mission 3", states[-1]["missionId"], states[-1]["findings"])',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('resp True Simulated upload of mission-001: campaign result-sim-mission-001, 1 defect detection(s)');
      expect(stdout).toContain("missions ['mission-001', 'mission-002']");
      expect(stdout).toContain('no findings None');
      expect(stdout).toContain("mission 3 mission-003 {'count': 1, 'defectExternalIds': ['defect-m2']}");
    });
  });

  describe('with a Ready plan whose task target lies outside the area bounds (live-project case)', () => {
    let oobSession: PythonSession;
    let oob: SandboxSnapshot;

    beforeEach(() => oobSession.setSnapshot(oob));

    beforeAll(async () => {
      // The newest Ready plan: the followup plan's 8 tasks plus one outside the geofence.
      const followup = snapshot.plans.find((p) => p.externalId === 'demo-plan-followup')!;
      const plan = { ...followup, externalId: 'oob-ready', name: 'OOB plan', createdTime: followup.createdTime + 1 };
      const tasks = snapshot.tasks
        .filter((t) => t.planExternalId === 'demo-plan-followup')
        .map((t) => ({ ...t, externalId: t.externalId.replace('demo-plan-followup', 'oob-ready'), planExternalId: 'oob-ready' }));
      const outside: InspectionTask = {
        ...tasks[0],
        externalId: 'oob-task',
        kind: 'region',
        inspectionType: 'visual',
        targetElement: null,
        position3d: [20, 0, 1],
        normalVector: [0, 0, 1],
        radiusM: 0.3,
      };
      oob = { ...snapshot, plans: [...snapshot.plans, plan], tasks: [...snapshot.tasks, ...tasks, outside] };
      const indexURL = fileURLToPath(new URL('../../node_modules/pyodide/', import.meta.url));
      oobSession = await PythonSession.create({ loadPyodide, indexURL, files: PYTHON_FILES, snapshot: oob });
    }, 60_000);

    it('should run example 7 to completion: the blocked task is skipped, the mission end still completes', async () => {
      const { stdout, outcome, missions } = await run(oobSession, example('bridge'));

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('preflight error: oob-task:');
      expect(stdout).toContain('outside the area bounds');
      expect(stdout).toContain('skipped by pre-flight: Task oob-task cannot be inspected');
      expect(stdout).toContain('upload_status: idle -> exporting_mesh -> uploading -> complete');
      expect(stdout).toContain('defects: 2 created: defect-corr-001, defect-crack-002');
      const mission = missions.at(-1);
      expect(mission).toMatchObject({ status: 'landed', planExternalId: 'oob-ready', summary: { visited: 8 } });
      expect(mission?.tasks.find((t) => t.id === 'oob-task')).toMatchObject({ status: 'skipped' });
    });

    it('should run example 4 to completion with the blocked task skipped', async () => {
      const { stdout, outcome, missions } = await run(oobSession, example('hand-fly'));

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('preflight error: oob-task:');
      expect(stdout).toContain('skipped by pre-flight: Task oob-task cannot be inspected');
      const mission = missions.at(-1);
      expect(mission).toMatchObject({ status: 'landed', planExternalId: 'oob-ready', summary: { visited: 8 } });
      expect(mission?.tasks.find((t) => t.id === 'oob-task')).toMatchObject({ status: 'skipped' });
    });
  });

  describe('with real-project quirks: a newer empty Ready plan and an unnamed plan', () => {
    let quirkySession: PythonSession;
    let quirky: SandboxSnapshot;

    beforeEach(() => quirkySession.setSnapshot(quirky));

    beforeAll(async () => {
      const followup = snapshot.plans.find((p) => p.externalId === 'demo-plan-followup')!;
      const emptyReady = {
        ...followup,
        externalId: 'empty-ready',
        name: null,
        createdTime: followup.createdTime + 1,
        lastUpdatedTime: followup.lastUpdatedTime + 1,
      };
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
      // Guard: the patch below must track the examples' pick key; fail loudly when it changes.
      const code = example('fly-mission');
      expect(code).toContain(EXAMPLES_PICK_KEY);

      const renamed = await run(quirkySession, code.replace(EXAMPLES_PICK_KEY, "key=lambda c: c[1].external_id == 'empty-ready'").replace('counts[p.external_id] > 0', 'True'));

      expect(renamed.stdout).toContain('Plan: (unnamed) in BWT 3P');
    });

    it('should label unnamed plans in the verify example', async () => {
      const { stdout } = await run(quirkySession, example('verify-plan'));

      expect(stdout).toContain('BWT 3P / (unnamed) [Ready]');
      expect(stdout).not.toContain('/ None [');
    });
  });

  describe('with an Active plan (the robot bridge rule: Active wins, else the most recently updated Ready)', () => {
    it('should fly the Active plan in the fly-mission example even when a Ready plan is newer', async () => {
      // The Active plan is older-created AND older-updated than demo-plan-followup but must win.
      const followup = snapshot.plans.find((p) => p.externalId === 'demo-plan-followup')!;
      const active: InspectionPlan = {
        ...followup,
        externalId: 'active-plan',
        name: 'Active plan',
        status: 'Active',
        createdTime: followup.createdTime - 1_000_000,
        lastUpdatedTime: followup.lastUpdatedTime - 1_000_000,
      };
      session.setSnapshot({
        ...snapshot,
        plans: [...snapshot.plans, active],
        tasks: [...snapshot.tasks, ...clonedTasks(snapshot, 'active-plan')],
      });

      const { outcome, missions } = await run(session, example('fly-mission'));

      expect(outcome).toEqual({ ok: true });
      expect(missions.at(-1)?.planExternalId).toBe('active-plan');
    });

    it('should fly the most recently updated Ready plan, not the most recently created', async () => {
      // Created before demo-plan-followup but updated after it: the update time must decide.
      const followup = snapshot.plans.find((p) => p.externalId === 'demo-plan-followup')!;
      const updated: InspectionPlan = {
        ...followup,
        externalId: 'recently-updated',
        name: 'Recently updated',
        createdTime: followup.createdTime - 5_000,
        lastUpdatedTime: followup.lastUpdatedTime + 5_000,
      };
      session.setSnapshot({
        ...snapshot,
        plans: [...snapshot.plans, updated],
        tasks: [...snapshot.tasks, ...clonedTasks(snapshot, 'recently-updated')],
      });

      const { outcome, missions } = await run(session, example('fly-mission'));

      expect(outcome).toEqual({ ok: true });
      expect(missions.at(-1)?.planExternalId).toBe('recently-updated');
    });
  });

  describe('simulated autoassess_bridge plan selection (the real bridge rule on /autoassess/*)', () => {
    const SELECT_SETUP = [
      'import json',
      'from uidss import UidssClient',
      'from dss_sandbox import SimDrone',
      'from dss_sandbox.gbplanner import SimGbPlanner',
      'UidssClient.from_env().plans.download("autoassess", "demo-plan-followup", "BWT 3P", "p.json")',
      'sim_drone = SimDrone(speed_mps=1.0, max_flight_time_s=1800)',
      'sim_drone.load_plan("p.json")',
    ].join('\n');

    it('should follow the most recently updated Active plan and warn when several are Active', async () => {
      // Both Actives are updated before the newest Ready plan, and the newest-updated Active was
      // created first: Active must beat Ready, and update time must beat creation time.
      const followup = snapshot.plans.find((p) => p.externalId === 'demo-plan-followup')!;
      const activeOld: InspectionPlan = {
        ...followup,
        externalId: 'active-old',
        name: 'Active old',
        status: 'Active',
        createdTime: followup.createdTime + 10_000,
        lastUpdatedTime: followup.lastUpdatedTime - 20_000,
      };
      const activeNew: InspectionPlan = {
        ...followup,
        externalId: 'active-new',
        name: 'Active new',
        status: 'Active',
        createdTime: followup.createdTime - 10_000,
        lastUpdatedTime: followup.lastUpdatedTime - 10_000,
      };
      session.setSnapshot({ ...snapshot, plans: [...snapshot.plans, activeOld, activeNew] });

      const { stdout, outcome } = await run(
        session,
        [
          SELECT_SETUP,
          'ros = SimGbPlanner(sim_drone, verbose=False).ros',
          'ids = []',
          'ros.subscribe("/autoassess/plan_id", ids.append)',
          'print("followed", ids[0].data)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('followed active-new');
      expect(stdout).toContain(
        '[autoassess_bridge] 2 Active plans (active-old, active-new) although the viewer keeps '
          + 'at most one per area; following the most recently updated',
      );
    });

    it('should follow only the plan named by plan_name', async () => {
      const { stdout, outcome } = await run(
        session,
        [
          SELECT_SETUP,
          'ros = SimGbPlanner(sim_drone, verbose=False, plan_name="NDT sweep – port side").ros',
          'ids, plans = [], []',
          'ros.subscribe("/autoassess/plan_id", ids.append)',
          'ros.subscribe("/autoassess/plan", plans.append)',
          'print("followed", ids[0].data, len(json.loads(plans[0].data)["tasks"]))',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      // Without the override the newest Ready plan (demo-plan-followup) would win.
      expect(stdout).toContain('followed demo-plan-ndt-sweep 6');
    });

    it('should relay nothing and warn on every poll when no Ready or Active plan has the name', async () => {
      // "Hold 2 visual" exists in the demo data but is Complete: never followed.
      const { stdout, outcome } = await run(
        session,
        [
          SELECT_SETUP,
          'ros = SimGbPlanner(sim_drone, verbose=False, plan_name="Hold 2 visual").ros',
          'msgs = []',
          'ros.subscribe("/autoassess/plan", msgs.append)',
          'ros.subscribe("/autoassess/plan_id", msgs.append)',
          'print("delivered", len(msgs))',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      expect(stdout).toContain('delivered 0');
      const warnings =
        stdout.match(/\[autoassess_bridge\] No Ready or Active plan named 'Hold 2 visual' — relaying nothing/g) ?? [];
      expect(warnings).toHaveLength(2); // one per poll (every latched subscribe)
    });

    it('should warn and follow the most recently updated when several Ready or Active plans share the name', async () => {
      const followup = snapshot.plans.find((p) => p.externalId === 'demo-plan-followup')!;
      const activeSweep: InspectionPlan = {
        ...followup,
        externalId: 'active-sweep',
        name: 'Sweep',
        status: 'Active',
        lastUpdatedTime: followup.lastUpdatedTime - 10_000,
      };
      const readySweep: InspectionPlan = {
        ...followup,
        externalId: 'ready-sweep',
        name: 'Sweep',
        status: 'Ready',
        createdTime: followup.createdTime - 10_000,
        lastUpdatedTime: followup.lastUpdatedTime + 10_000,
      };
      session.setSnapshot({ ...snapshot, plans: [...snapshot.plans, activeSweep, readySweep] });

      const { stdout, outcome } = await run(
        session,
        [
          SELECT_SETUP,
          'ros = SimGbPlanner(sim_drone, verbose=False, plan_name="Sweep").ros',
          'ids = []',
          'ros.subscribe("/autoassess/plan_id", ids.append)',
          'print("followed", ids[0].data)',
        ].join('\n'),
      );

      expect(outcome).toEqual({ ok: true });
      // In the plan_name branch Active does not beat Ready: the most recently updated wins.
      expect(stdout).toContain('followed ready-sweep');
      expect(stdout).toContain(
        "[autoassess_bridge] 2 Ready or Active plans named 'Sweep' (active-sweep, ready-sweep); "
          + 'following the most recently updated',
      );
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

/** demo-plan-followup's tasks cloned onto another plan, so that plan is flyable. */
function clonedTasks(snapshot: SandboxSnapshot, planExternalId: string): InspectionTask[] {
  return snapshot.tasks
    .filter((t) => t.planExternalId === 'demo-plan-followup')
    .map((t) => ({
      ...t,
      externalId: t.externalId.replace('demo-plan-followup', planExternalId),
      planExternalId,
    }));
}
