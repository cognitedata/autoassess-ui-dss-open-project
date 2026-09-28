export interface StarterExample {
  id: string;
  title: string;
  code: string;
}

const LIST_PLANS = `"""1. List plans — the same calls as \`dss plan list\` on the ground station."""
from uidss import UidssClient

client = UidssClient.from_env()

for vessel in client.vessels.list():
    print(f"Vessel: {vessel.name}")
    for area in client.areas.list(vessel.space, vessel.external_id):
        plans = client.plans.list(area.space, area.external_id)
        counts = client.plans.count_tasks([p.external_id for p in plans])
        print(f"  Area: {area.name}  ({len(plans)} plans)")
        for p in plans:
            name = p.name or "(unnamed)"
            print(f"    {p.status:<8} {name:<28} {counts[p.external_id]:>3} tasks   {p.external_id}")
`;

const VERIFY_PLAN = `"""2. Verify plans — download each plan.json and run the checks a ground station would."""
import json
from collections import Counter
from math import isclose, sqrt
from pathlib import Path

from dss_sandbox import area_bounds
from uidss import UidssClient

client = UidssClient.from_env()


def pose(task: dict) -> list[float] | None:
    """Where the drone must go: element centre or region position."""
    if task["kind"] == "element":
        return task.get("targetElement", {}).get("center")
    return task.get("position3d")


def verify(plan: dict) -> list[str]:
    problems = []
    bounds = area_bounds(plan["areaExternalId"])
    for task in plan["tasks"]:
        p = pose(task)
        if p is None:
            problems.append(f"{task['id']}: no pose")
        elif bounds and not bounds.contains(p):
            problems.append(f"{task['id']}: {p} is outside the area bounds")
        if task["kind"] == "region":
            n = task.get("normalVector")
            if n is None or not isclose(sqrt(sum(v * v for v in n)), 1.0, abs_tol=1e-3):
                problems.append(f"{task['id']}: normalVector missing or not unit length")
    return problems


for vessel in client.vessels.list():
    for area in client.areas.list(vessel.space, vessel.external_id):
        for p in client.plans.list(area.space, area.external_id):
            path = Path("plans") / f"{p.external_id}.json"
            client.plans.download(p.space, p.external_id, area.name, path)
            plan = json.loads(path.read_text())

            by_type = Counter(f"{t['kind']}/{t['inspectionType']}" for t in plan["tasks"])
            problems = verify(plan)
            verdict = "PASS" if not problems else f"FAIL ({len(problems)})"
            print(f"[{verdict}] {area.name} / {plan['name'] or '(unnamed)'} [{p.status}]  {dict(by_type)}")
            for problem in problems:
                print(f"         - {problem}")
`;

const FLY_MISSION = `"""3. Fly the mission — pick up the newest Ready plan, fly it with the simulated drone."""
import json
from pathlib import Path

from dss_sandbox import SimDrone
from uidss import UidssClient

client = UidssClient.from_env()

# 1. Newest Ready plan that has tasks, across all vessels/areas.
candidates = [
    (area, p)
    for vessel in client.vessels.list()
    for area in client.areas.list(vessel.space, vessel.external_id)
    for p in client.plans.list(area.space, area.external_id)
    if p.status == "Ready"
]
counts = client.plans.count_tasks([p.external_id for _, p in candidates])
candidates = [(area, p) for area, p in candidates if counts[p.external_id] > 0]
if not candidates:
    raise SystemExit("No Ready plan with tasks found. Add tasks to a plan and mark it Ready in the AutoAssess web app.")
area, plan_meta = max(candidates, key=lambda c: c[1].created_time)

# 2. Download plan.json, exactly as on the ground station.
path = Path("plans") / f"{plan_meta.external_id}.json"
client.plans.download(plan_meta.space, plan_meta.external_id, area.name, path)
plan = json.loads(path.read_text())
print(f"Plan: {plan['name'] or '(unnamed)'} in {plan['areaName']} ({len(plan['tasks'])} tasks)")

# 3. Fly it. fly_plan = load_plan -> takeoff -> goto + inspect per task -> return_home -> land
#    (see example 4 for the same loop written out). The browser animates every step.
sim_drone = SimDrone(speed_mps=0.5)
sim_drone.on_event(lambda e: print(f"  t={e.t:6.1f}s  {e.message}"))
report = sim_drone.fly_plan(plan)

print()
print(report.summary())

# 4. Mission done: mark the plan Complete. On a ground station \`dss campaign upload\` runs
#    first; in the sandbox this is simulated (the status pill flips, nothing is written to CDF).
if report.skipped:
    print(f"{len(report.skipped)} task(s) skipped: plan left {plan_meta.status}")
else:
    client.plans.update_status(plan_meta.space, plan_meta.external_id, "Complete")
`;

const HAND_FLY = `"""4. Hand-fly with poses — the explicit mission loop; the template for a real drone driver.

On your ground station, replace sim_drone with your own drone class that has the same verbs:
takeoff(), goto(Pose), inspect(task_id), return_home(), land().
"""
import json
from pathlib import Path

from dss_sandbox import BatteryLowError, SimDrone, pose_for_task
from uidss import UidssClient

client = UidssClient.from_env()

# Newest Ready plan with tasks (same pick as example 3).
candidates = [
    (area, p)
    for vessel in client.vessels.list()
    for area in client.areas.list(vessel.space, vessel.external_id)
    for p in client.plans.list(area.space, area.external_id)
    if p.status == "Ready"
]
counts = client.plans.count_tasks([p.external_id for _, p in candidates])
candidates = [(area, p) for area, p in candidates if counts[p.external_id] > 0]
if not candidates:
    raise SystemExit("No Ready plan with tasks found.")
area, plan_meta = max(candidates, key=lambda c: c[1].created_time)
path = Path("plans") / f"{plan_meta.external_id}.json"
client.plans.download(plan_meta.space, plan_meta.external_id, area.name, path)
plan = json.loads(path.read_text())
print(f"Plan: {plan['name'] or '(unnamed)'} ({len(plan['tasks'])} tasks)")

sim_drone = SimDrone(speed_mps=0.5, max_flight_time_s=900)
sim_drone.on_event(lambda e: print(f"  t={e.t:6.1f}s  {e.kind:<11} {e.task_id or ''}"))

issues = sim_drone.load_plan(plan)
blocked = {i.task_id for i in issues if i.severity == "error"}
for issue in issues:
    print(f"preflight {issue.severity}: {issue.task_id}: {issue.message}")

print("takeoff", sim_drone.takeoff(height_m=1.0))
for task in plan["tasks"]:              # plan order; the robot may choose any order
    if task["id"] in blocked:
        continue
    # Hover point facing the surface (element tasks: on the line from where the drone is now).
    pose = pose_for_task(task, standoff_m=0.8, approach_from=sim_drone.pose)
    try:
        print("goto", sim_drone.goto(pose))
        sim_drone.inspect(task["id"])            # 3 s visual, 8 s ndt_thickness
    except BatteryLowError as err:
        print("battery low:", err)
        break
sim_drone.return_home()
sim_drone.land()

print()
print(sim_drone.report().summary())
print(f"state={sim_drone.state}  flight time={sim_drone.flight_time_s:.0f} s  distance={sim_drone.distance_m:.1f} m")
`;

export const STARTER_EXAMPLES: StarterExample[] = [
  { id: 'list-plans', title: '1. List plans', code: LIST_PLANS },
  { id: 'verify-plan', title: '2. Verify a plan', code: VERIFY_PLAN },
  { id: 'fly-mission', title: '3. Fly the mission', code: FLY_MISSION },
  { id: 'hand-fly', title: '4. Hand-fly with poses', code: HAND_FLY },
];
