import { describe, expect, it } from 'vitest';

import type { PlanJson } from '../domain/planJson';
import type { Bounds, Vec3 } from '../domain/types';
import { FlightRecorder } from '../sim/simulator';
import { GBPLANNER_CONFIGS } from './configs';
import type { GbPlannerSetup, SpinOutput } from './pci';
import { GBPLANNER_SERVICES, GbPlannerSim } from './pci';
import type { TankElement } from './syntheticTank';

/** Two compartments split by a frame at x = 3 with a manhole: small enough to run fast. */
const BOUNDS: Bounds = { min: [0, -1.5, 0], max: [6, 1.5, 2.6] };
const ELEMENTS: TankElement[] = [
  { elementType: 'compartment', center: [1.5, 0, 1.3] },
  { elementType: 'compartment', center: [4.5, 0, 1.3] },
  { elementType: 'manhole', center: [3, 0, 1.1] },
];
const TASKS = [
  { id: 'near', target: [1.5, 1.4, 1.2] as Vec3, normal: [0, -1, 0] as Vec3 },
  { id: 'far', target: [5.5, -1.45, 1.0] as Vec3, normal: [0, 1, 0] as Vec3 },
];

describe(GbPlannerSim.name, () => {
  it('should run the BWT behaviour: init -> auto exploration -> exhausted -> inspection -> homing -> idle', () => {
    const { planner, recorder } = setup();

    expect(planner.call('pci_initialization_trigger', {}).response).toEqual({ success: true });
    expect(planner.call('planner_control_interface/std_srvs/automatic_planning', {}).response).toMatchObject({ success: true });
    const { steps, log, paths } = spinUntilIdle(planner);

    const modes = planner.result().timeline.map((it) => it.mode);
    expect(modes[0]).toBe('exploration');
    expect(modes).toContain('inspection');
    expect(modes.at(-1)).toBe('homing');
    // Per compartment: explore, then inspect (the compartment test pins the full sequence).
    expect(modes.indexOf('inspection')).toBeGreaterThan(modes.indexOf('exploration'));
    expect(log.join('\n')).toMatch(/Exploration exhausted/);
    expect(log.join('\n')).toMatch(/Homing complete/);
    expect(planner.mode).toBe('idle');
    expect(steps).toBeLessThan(400);
    expect(paths).toBe(planner.report().iterations);

    const report = planner.report();
    expect(report.exploredPct).toBeGreaterThan(60);
    expect(report.surfaceCoveragePct).toBeGreaterThan(50);
    expect(report.viewpoints).toBeGreaterThan(0);
    // Explored through the manhole into the second compartment.
    const map = planner.result().map;
    expect(map.seenAt.some((t, i) => t >= 0 && i % map.dims[0] > map.dims[0] * 0.8)).toBe(true);
    // Back above home.
    const { pose, state } = recorder.state();
    expect(state).toBe('flying');
    expect(Math.hypot(pose.x - 0, pose.y - 0)).toBeLessThan(0.05);
    expect(report.coveredTasks).toHaveProperty('near');
  });

  it('should be deterministic for a seed', () => {
    const a = runAuto(setup({ seed: 3 }).planner);
    const b = runAuto(setup({ seed: 3 }).planner);

    expect(a).toEqual(b);
  });

  it('should stop on stop and stay idle', () => {
    const { planner } = setup();
    planner.call('pci_initialization_trigger', {});
    planner.call('planner_control_interface/std_srvs/automatic_planning', {});
    planner.spinStep(null);

    expect(planner.call('planner_control_interface/std_srvs/stop', {}).response).toMatchObject({ success: true });

    expect(planner.spinStep(null).idle).toBe(true);
    expect(planner.mode).toBe('idle');
  });

  it('should go home by itself when the time remaining gets low', () => {
    const { planner } = setup({ maxFlightTimeS: 30 });
    planner.call('pci_initialization_trigger', {});
    planner.call('planner_control_interface/std_srvs/automatic_planning', {});

    const { log } = spinUntilIdle(planner);

    expect(log.join('\n')).toMatch(/time remaining/i);
    expect(planner.result().timeline.at(-1)?.mode).toBe('homing');
    expect(planner.result().timeline.some((it) => it.mode === 'inspection')).toBe(false);
  });

  it('should honour a low time_remaining published on /robot_status', () => {
    const { planner } = setup();
    planner.call('pci_initialization_trigger', {});
    planner.call('planner_control_interface/std_srvs/automatic_planning', {});
    planner.spinStep(null);

    planner.publish('/robot_status', { timeRemaining: 5 });
    spinUntilIdle(planner);

    expect(planner.result().timeline.at(-1)?.mode).toBe('homing');
    expect(planner.result().timeline.filter((it) => it.mode === 'exploration').length).toBe(1);
  });

  it('should refuse go_to_waypoint into unknown space, while target reach gets there', () => {
    const goal = { x: 5, y: 0, z: 1.2, roll: 0, pitch: 0, yaw: 0 };
    const wp = setup();
    wp.planner.call('pci_initialization_trigger', {});
    wp.planner.publish('/move_base_simple/goal', { pose: goal });

    const refused = wp.planner.call('planner_control_interface/std_srvs/go_to_waypoint', {});

    expect(refused.response).toMatchObject({ success: false });
    expect(String(refused.response['message'])).toMatch(/known/);

    const tr = setup();
    tr.planner.call('gbplanner/switch_operation_mode', { data: true });
    tr.planner.call('pci_initialization_trigger', {});
    tr.planner.call('planner_control_interface/std_srvs/automatic_planning', {});
    tr.planner.publish('/move_base_simple/goal', { pose: goal });
    const { log } = spinUntilIdle(tr.planner);

    const { pose } = tr.recorder.state();
    expect(Math.hypot(pose.x - 5, pose.y, pose.z - 1.2)).toBeLessThan(1e-6);
    expect(log.join('\n')).toMatch(/Target reached/);
    expect(tr.planner.result().timeline.every((it) => it.mode === 'target-reach')).toBe(true);
  });

  it('should fly a go_to_waypoint through known space once the map is there', () => {
    const { planner, recorder } = setup();
    planner.call('pci_initialization_trigger', {});
    planner.publish('/move_base_simple/goal', { pose: { x: 1.8, y: 0.3, z: 1.2, roll: 0, pitch: 0, yaw: 1 } });

    expect(planner.call('planner_control_interface/std_srvs/go_to_waypoint', {}).response).toMatchObject({ success: true });
    spinUntilIdle(planner);

    expect(recorder.state().pose).toMatchObject({ x: 1.8, y: 0.3, z: 1.2, yaw: 1 });
    expect(planner.result().timeline.at(-1)?.mode).toBe('waypoint');
  });

  it('should give up on a target inside a wall', () => {
    const { planner } = setup();
    planner.call('gbplanner/switch_operation_mode', { data: true });
    planner.call('pci_initialization_trigger', {});
    planner.call('planner_control_interface/std_srvs/automatic_planning', {});
    planner.publish('/move_base_simple/goal', { pose: { x: 3, y: -1.2, z: 2.2, roll: 0, pitch: 0, yaw: 0 } });

    const { log, steps } = spinUntilIdle(planner);

    expect(log.join('\n')).toMatch(/gave up|collision/i);
    expect(steps).toBeLessThan(60);
  });

  it('should set, clip and reset the global bound', () => {
    const { planner } = setup();

    const set = planner.call('gbplanner/set_global_bound', {
      getCurrentBound: false,
      resetToDefault: false,
      bound: { useZVal: true, min: [-10, -1, 0.5], max: [3, 1, 2] },
    });
    const xyOnly = planner.call('gbplanner/set_global_bound', {
      getCurrentBound: false,
      resetToDefault: false,
      bound: { useZVal: false, min: [0, -1, 99], max: [2, 1, 99] },
    });
    const reset = planner.call('gbplanner/set_global_bound', { getCurrentBound: false, resetToDefault: true, bound: null });

    expect(set.response).toEqual({ success: true, boundRet: { useZVal: true, min: [0, -1, 0.5], max: [3, 1, 2] } });
    expect(xyOnly.response).toMatchObject({ boundRet: { min: [0, -1, 0.5], max: [2, 1, 2] } });
    expect(reset.response).toMatchObject({ boundRet: { min: BOUNDS.min } });
    expect(planner.result().globalBound.min).toEqual(BOUNDS.min);
  });

  it('should keep exploration inside a smaller global bound', () => {
    const { planner } = setup();
    planner.call('gbplanner/set_global_bound', { getCurrentBound: false, resetToDefault: false, bound: { useZVal: true, min: [0, -1.5, 0], max: [2.8, 1.5, 2.6] } });
    planner.call('pci_initialization_trigger', {});
    planner.call('planner_control_interface/std_srvs/single_planning', {});
    spinUntilIdle(planner);
    planner.call('planner_control_interface/std_srvs/automatic_planning', {});
    spinUntilIdle(planner);

    const xs = planner.result().timeline.flatMap((it) => it.bestPath.map((p) => p[0]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(2.8);
  });

  it('should do one iteration for single_planning', () => {
    const { planner } = setup();
    planner.call('pci_initialization_trigger', {});
    planner.call('planner_control_interface/std_srvs/single_planning', {});

    spinUntilIdle(planner);

    expect(planner.report().iterations).toBe(1);
  });

  describe('compartment sequencing (BWT, like le_insp_opening)', () => {
    it('should finish one compartment at a time: explore + inspect 1, pass the manhole, then 2, then home', () => {
      const { planner } = setup();
      planner.call('pci_initialization_trigger', {});
      const auto = planner.call('planner_control_interface/std_srvs/automatic_planning', {});

      const { log } = spinUntilIdle(planner);

      const text = [...auto.log, ...log].join('\n');
      expect(text).toMatch(/Compartments: 2/);
      expect(text).toMatch(/passing the manhole/i);
      expect(text).toMatch(/Compartment 2\/2/);
      const timeline = planner.result().timeline;
      // No deep compartment-2 flying before compartment 1's inspection is done.
      const firstInspection = timeline.findIndex((it) => it.mode === 'inspection');
      const firstDeep2 = timeline.findIndex((it) => it.bestPath.some((p) => p[0] > 3.7));
      expect(firstInspection).toBeGreaterThan(-1);
      expect(firstDeep2).toBeGreaterThan(firstInspection);
      // Both compartments get their own inspection pass, then homing ends the run.
      const inspections = timeline.filter((it) => it.mode === 'inspection').length;
      expect(inspections).toBeGreaterThanOrEqual(2);
      expect(timeline.at(-1)?.mode).toBe('homing');
      const report = planner.report();
      expect(report.compartments).toHaveLength(2);
      expect(report.compartments[0].xMax).toBeCloseTo(3, 1);
      for (const c of report.compartments) {
        expect(c.exploredPct).toBeGreaterThan(50);
        expect(c.coveragePct).toBeGreaterThan(40);
      }
      expect(report.coveredTasks).toHaveProperty('near');
      expect(report.coveredTasks).toHaveProperty('far');
    });

    it('should record the compartment counters in the progress samples', () => {
      const { planner } = setup();
      planner.call('pci_initialization_trigger', {});
      planner.call('planner_control_interface/std_srvs/automatic_planning', {});
      spinUntilIdle(planner);

      // The initialization record predates the sequencing; every later record carries it.
      const progress = planner.result().progress;
      const counters = progress.filter((p) => p.compartments === 2).map((p) => p.compartment);
      expect(counters.length).toBeGreaterThan(0);
      expect(new Set(counters)).toEqual(new Set([1, 2]));
      // The compartment counter never goes backwards.
      expect([...counters].sort((a, b) => a - b)).toEqual(counters);
      expect(progress.at(-1)?.compartment).toBe(2);
    });

    it('should treat a tank without frames as a single compartment', () => {
      const { planner } = setup({ elements: [] });
      planner.call('pci_initialization_trigger', {});
      planner.call('planner_control_interface/std_srvs/automatic_planning', {});

      const { log } = spinUntilIdle(planner);

      expect(log.join('\n')).not.toMatch(/Compartments:|passing the manhole/);
      const report = planner.report();
      expect(report.compartments).toHaveLength(1);
      expect(planner.result().progress.every((p) => p.compartments === 1 && p.compartment === 1)).toBe(true);
    });

    it('should not sequence compartments in WP (target reach) mode', () => {
      const { planner } = setup();
      planner.call('gbplanner/switch_operation_mode', { data: true });
      planner.call('pci_initialization_trigger', {});
      planner.call('planner_control_interface/std_srvs/automatic_planning', {});
      planner.publish('/move_base_simple/goal', { pose: { x: 5, y: 0, z: 1.2, roll: 0, pitch: 0, yaw: 0 } });

      const { log } = spinUntilIdle(planner);

      expect(log.join('\n')).not.toMatch(/Compartments:/);
      expect(planner.report().compartments).toHaveLength(0);
    });
  });

  it('should refuse planning on the ground and name unknown services', () => {
    const { planner } = setup();

    expect(planner.call('planner_control_interface/std_srvs/automatic_planning', {}).response).toMatchObject({ success: false });
    expect(() => planner.call('planner_control_interface/std_srvs/automatic_plan', {})).toThrow(/Unknown service.*automatic_planning/s);
    expect(() => planner.publish('/goal', {})).toThrow(/Unknown topic.*move_base_simple/s);
    expect(GBPLANNER_SERVICES).toContain('pci_initialization_trigger');
    // Leading slashes are optional, as in ROS' root namespace.
    expect(planner.call('/pci_initialization_trigger', {}).response).toEqual({ success: true });
  });
});

function setup(options: { seed?: number; maxFlightTimeS?: number; elements?: TankElement[] } = {}): {
  planner: GbPlannerSim;
  recorder: FlightRecorder;
} {
  const recorder = new FlightRecorder({ speedMps: 1, maxFlightTimeS: options.maxFlightTimeS ?? 900, home: [0, 0, 0] });
  recorder.loadPlan(PLAN, BOUNDS);
  const config = { ...GBPLANNER_CONFIGS.bwt_inspection, sim: { ...GBPLANNER_CONFIGS.bwt_inspection.sim, inspectionCandidates: 150 } };
  const s: GbPlannerSetup = {
    drone: recorder,
    config,
    seed: options.seed ?? 1,
    bounds: BOUNDS,
    elements: options.elements ?? ELEMENTS,
    home: [0, 0, 0],
    speedMps: 1,
    maxFlightTimeS: options.maxFlightTimeS ?? 900,
    tasks: TASKS,
  };
  return { planner: new GbPlannerSim(s), recorder };
}

function spinUntilIdle(planner: GbPlannerSim): { steps: number; log: string[]; paths: number } {
  const log: string[] = [];
  let paths = 0;
  for (let steps = 0; steps < 1000; steps++) {
    const out: SpinOutput = planner.spinStep(null);
    log.push(...out.log);
    paths += out.messages.filter((m) => m.topic === '/gbplanner_path').length;
    if (out.idle) return { steps, log, paths };
  }
  throw new Error('planner never went idle');
}

function runAuto(planner: GbPlannerSim) {
  planner.call('pci_initialization_trigger', {});
  planner.call('planner_control_interface/std_srvs/automatic_planning', {});
  spinUntilIdle(planner);
  return planner.result().timeline.map((it) => it.bestPath);
}

const PLAN: PlanJson = {
  planExternalId: 'p',
  name: 'p',
  description: null,
  areaExternalId: 'a',
  areaName: 'A',
  mapExternalId: null,
  downloadedAt: '2026-01-01T00:00:00Z',
  tasks: [],
};
