import type { PlanJson } from '../domain/planJson';
import type { Bounds } from '../domain/types';
import type { FlightOptions, MissionResult } from '../sim/simulator';
import { computeWaypoint, FlightRecorder, preflightCheck, taskTarget } from '../sim/simulator';

/**
 * Test fixture: flies every flyable task of `plan` in plan order (what `SimDrone.fly_plan` does
 * in Python, minus the nearest-neighbour ordering) and returns the landed mission.
 */
export function flyAllTasks(
  plan: PlanJson,
  bounds: Bounds | null,
  options: Partial<FlightOptions> & { standoffM?: number } = {},
): MissionResult {
  const { standoffM = 0.8, ...flight } = options;
  const recorder = new FlightRecorder(flight);
  recorder.loadPlan(plan, bounds);
  const blocked = new Set(preflightCheck(plan, bounds).filter((i) => i.severity === 'error').map((i) => i.taskId));
  recorder.takeoff();
  for (const task of plan.tasks) {
    const target = taskTarget(task);
    if (blocked.has(task.id) || !target) {
      try {
        recorder.inspect(task.id);
      } catch {
        // expected: the recorder refuses and marks the task skipped
      }
      continue;
    }
    const { pose } = recorder.state();
    const [x, y, z] = computeWaypoint(task, target, [pose.x, pose.y, pose.z], standoffM);
    recorder.goto({ x, y, z, roll: 0, pitch: 0, yaw: Math.atan2(target[1] - y, target[0] - x) });
    recorder.inspect(task.id);
  }
  recorder.returnHome();
  recorder.land();
  return recorder.snapshot();
}
