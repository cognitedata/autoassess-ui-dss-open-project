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

const FLY_MISSION = `"""3. Fly the mission — pick the plan the robot bridge would fly, fly it with the simulated drone."""
import json
from pathlib import Path

from dss_sandbox import SimDrone
from uidss import UidssClient

client = UidssClient.from_env()

# 1. The bridge's rule: an Active plan wins, else the most recently updated Ready plan (update
#    time first, created time as tie-break) — with tasks, across all vessels/areas (the web
#    app's "Set active" pins the plan the robot flies).
candidates = [
    (area, p)
    for vessel in client.vessels.list()
    for area in client.areas.list(vessel.space, vessel.external_id)
    for p in client.plans.list(area.space, area.external_id)
    if p.status in ("Active", "Ready")
]
counts = client.plans.count_tasks([p.external_id for _, p in candidates])
candidates = [(area, p) for area, p in candidates if counts[p.external_id] > 0]
if not candidates:
    raise SystemExit("No Active or Ready plan with tasks found. Add tasks to a plan and mark it Ready in the AutoAssess web app.")
area, plan_meta = max(candidates, key=lambda c: (c[1].status == "Active", c[1].last_updated_time, c[1].created_time))

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

# The plan the robot bridge would fly: Active first, else the most recently updated Ready plan
# (same pick as example 3).
candidates = [
    (area, p)
    for vessel in client.vessels.list()
    for area in client.areas.list(vessel.space, vessel.external_id)
    for p in client.plans.list(area.space, area.external_id)
    if p.status in ("Active", "Ready")
]
counts = client.plans.count_tasks([p.external_id for _, p in candidates])
candidates = [(area, p) for area, p in candidates if counts[p.external_id] > 0]
if not candidates:
    raise SystemExit("No Active or Ready plan with tasks found.")
area, plan_meta = max(candidates, key=lambda c: (c[1].status == "Active", c[1].last_updated_time, c[1].created_time))
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
    try:
        if task["id"] not in blocked:
            # Hover point facing the surface (element tasks: on the line from where the drone is now).
            print("goto", sim_drone.goto(pose_for_task(task, standoff_m=0.8, approach_from=sim_drone.pose)))
        sim_drone.inspect(task["id"])            # 3 s visual, 8 s ndt_thickness; blocked -> ValueError
    except ValueError as err:                    # pre-flight error: the task is recorded as skipped
        print(f"  skipped by pre-flight: {err}")
    except BatteryLowError as err:
        print("battery low:", err)
        break
sim_drone.return_home()
sim_drone.land()

print()
print(sim_drone.report().summary())
print(f"state={sim_drone.state}  flight time={sim_drone.flight_time_s:.0f} s  distance={sim_drone.distance_m:.1f} m")
`;

const PICK_PLAN = `client = UidssClient.from_env()

# The plan the robot bridge would fly: Active first, else the most recently updated Ready plan
# (same pick as example 3).
candidates = [
    (area, p)
    for vessel in client.vessels.list()
    for area in client.areas.list(vessel.space, vessel.external_id)
    for p in client.plans.list(area.space, area.external_id)
    if p.status in ("Active", "Ready")
]
counts = client.plans.count_tasks([p.external_id for _, p in candidates])
candidates = [(area, p) for area, p in candidates if counts[p.external_id] > 0]
if not candidates:
    raise SystemExit("No Active or Ready plan with tasks found.")
area, plan_meta = max(candidates, key=lambda c: (c[1].status == "Active", c[1].last_updated_time, c[1].created_time))
path = Path("plans") / f"{plan_meta.external_id}.json"
client.plans.download(plan_meta.space, plan_meta.external_id, area.name, path)
plan = json.loads(path.read_text())
print(f"Plan: {plan['name'] or '(unnamed)'} in {plan['areaName']} ({len(plan['tasks'])} tasks)")`;

const GB_EXPLORE = `"""5. gbplanner: explore + inspect — the simulated gbplanner3 (NTNU ARL) in BWT mode.

It works the tank one compartment at a time, like the real BWT behaviour tree
(SetNextCompartment -> explore -> inspect -> pass the manhole -> repeat), then flies home; the
report says which of the plan's tasks the inspection camera covered on the way, and the
explored / coverage percentages per compartment. The tank is synthetic (generated from the
area bounds and structural elements), the planner a simplified simulation: the *interface* is
gbplanner's. On a ground station the same calls are (rospy):

    rospy.ServiceProxy("gbplanner/set_global_bound", planner_set_global_bound)(req)
    rospy.ServiceProxy("pci_initialization_trigger", pci_initialization)()
    rospy.Subscriber("/gbplanner_path", Path, on_path)
    rospy.ServiceProxy("planner_control_interface/std_srvs/automatic_planning", Trigger)()
    rospy.spin()
"""
import json
from pathlib import Path

from dss_sandbox import SimDrone, area_bounds
from dss_sandbox.gbplanner import SimGbPlanner, geometry_msgs, planner_msgs
from uidss import UidssClient

${PICK_PLAN}

sim_drone = SimDrone(speed_mps=1.0, max_flight_time_s=1800)   # gbplanner bwt v_max: 1.0 m/s
sim_drone.load_plan(plan)                                        # the area = the tank
sim_gbplanner = SimGbPlanner(sim_drone, config="bwt_inspection")
ros = sim_gbplanner.ros

# 1. AutoAssess area bounds -> gbplanner's global planning bound.
b = area_bounds(plan["areaExternalId"])
if b is not None:
    req = planner_msgs.planner_set_global_bound.Request(
        bound=planner_msgs.PlanningBound(
            use_z_val=True, min_val=geometry_msgs.Point(*b.min), max_val=geometry_msgs.Point(*b.max)
        )
    )
    print("set_global_bound:", ros.call("gbplanner/set_global_bound", req).success)

# 2. Watch the planner: one /gbplanner_path per planning iteration.
ros.subscribe("/gbplanner_path", lambda path: print(f"  path t={path.header.stamp:6.1f}s  {len(path.poses)} poses"))

# 3. Initialise (take off, move in), start the BWT behaviour, run until it is back home.
ros.call("pci_initialization_trigger")
ros.call("planner_control_interface/std_srvs/automatic_planning")
ros.spin()
sim_drone.land()

print()
print(sim_gbplanner.report().summary())
`;

const GB_TARGET_REACH = `"""6. gbplanner: target reach per task — one gbplanner goal per AutoAssess plan task.

WP (waypoint) operation mode: the planner explores towards each goal through unknown space. When
the drone is there, the script inspects the task, then asks for the next goal; finally homing.
On a ground station (rospy):

    rospy.ServiceProxy("gbplanner/switch_operation_mode", SetBool)(True)          # WP mode
    goal_pub = rospy.Publisher("/move_base_simple/goal", PoseStamped, queue_size=1)
    goal_pub.publish(goal)                   # then wait until the robot's pose reaches the goal
    rospy.ServiceProxy("planner_control_interface/std_srvs/homing_trigger", Trigger)()
"""
import json
from pathlib import Path

from dss_sandbox import SimDrone, pose_for_task
from dss_sandbox.gbplanner import SimGbPlanner, std_srvs, to_pose_stamped
from uidss import UidssClient

${PICK_PLAN}

sim_drone = SimDrone(speed_mps=1.0, max_flight_time_s=1800)
issues = sim_drone.load_plan(plan)
blocked = {i.task_id for i in issues if i.severity == "error"}
sim_gbplanner = SimGbPlanner(sim_drone, verbose=False)
ros = sim_gbplanner.ros

ros.call("gbplanner/switch_operation_mode", std_srvs.SetBool.Request(data=True))   # WP mode
ros.call("pci_initialization_trigger")
ros.call("planner_control_interface/std_srvs/automatic_planning")


def goals_for(task):
    """Standoff poses to try, best first. The planner refuses a goal inside the (mapped) structure."""
    if task["kind"] == "region":
        return [pose_for_task(task, standoff_m=s) for s in (0.8, 1.1, 0.6)]
    x, y, z = task["targetElement"]["center"]
    sides = [sim_drone.pose, (x, y, z + 1), (x, y + 1, z), (x, y - 1, z), (x + 1, y, z), (x - 1, y, z)]
    return [pose_for_task(task, standoff_m=0.8, approach_from=side) for side in sides]


for task in plan["tasks"]:
    if task["id"] in blocked:
        continue
    for goal in goals_for(task):
        ros.publish("/move_base_simple/goal", to_pose_stamped(goal))
        ros.spin()                               # until the goal is reached (or given up)
        if sim_drone.pose.distance_to(goal) < 0.05:
            break
    else:
        print(f"not reached {task['id']:<26} (the planner gave up on every standoff pose)")
        continue
    sim_drone.inspect(task["id"])
    print(f"inspected {task['id']:<28} t={sim_drone.flight_time_s:6.1f}s")

ros.call("planner_control_interface/std_srvs/homing_trigger")
ros.spin()
sim_drone.land()

print()
print(sim_drone.report().summary())
print(sim_gbplanner.report().summary())
`;

const BRIDGE = `"""7. bridge: plans in, findings out — integrate with the autoassess_bridge ROS node.

On the robot, AutoAssess is reached only through the autoassess_bridge node's topics: the plan
comes in latched on /autoassess/plan, your detection stack publishes findings on
/autoassess/findings, and at mission end the bridge uploads the mission and reports on
/autoassess/upload_status. The sandbox answers the same topics on sim_gbplanner.ros; on the
ground station this exact flow is rospy against the real node:

    rospy.Subscriber("/autoassess/plan", String, on_plan)          # latched plan.json
    pub = rospy.Publisher("/autoassess/findings", String, queue_size=10)
    pub.publish(String(data=json.dumps({"x": 1.0, "y": 2.0, "z": 0.9, "id": "corr-001"})))
"""
import json
from pathlib import Path

from dss_sandbox import BatteryLowError, SimDrone, pose_for_task
from dss_sandbox.gbplanner import SimGbPlanner, std_msgs
from uidss import UidssClient

${PICK_PLAN}

# The bridge picks its plan by itself: the most recently updated Active plan, else the most
# recently updated Ready plan (SimGbPlanner's plan_name= narrows it to one plan name, like the
# real node's override). The sandbox still loads the plan into sim_drone to fly it.
sim_drone = SimDrone(speed_mps=1.0, max_flight_time_s=1800)
issues = sim_drone.load_plan(plan)
for issue in issues:                          # blocked tasks are visible up front
    print(f"preflight {issue.severity}: {issue.task_id}: {issue.message}")
blocked = {i.task_id for i in issues if i.severity == "error"}
sim_gbplanner = SimGbPlanner(sim_drone, verbose=False)
ros = sim_gbplanner.ros

# 1. The bridge's plan topics are latched: subscribing delivers the current value at once.
plan_msgs, targets, statuses = [], [], []
ros.subscribe("/autoassess/plan", plan_msgs.append)                     # std_msgs/String (plan.json)
ros.subscribe("/autoassess/plan_id", lambda m: print("plan_id:", m.data))
ros.subscribe("/autoassess/inspection_targets", targets.append)         # geometry_msgs/PoseArray
ros.subscribe("/autoassess/upload_status", lambda m: statuses.append(json.loads(m.data)))

bridge_plan = json.loads(plan_msgs[-1].data)                            # same text as plan.json
print(f"bridge plan: {bridge_plan['name']} — {len(bridge_plan['tasks'])} tasks, "
      f"{len(targets[-1].poses)} inspection target poses, upload {statuses[-1]['state']}")

# 2. Fly the plan (your drone driver; examples 5 and 6 let the simulated gbplanner fly instead).
#    Tasks blocked by pre-flight (e.g. outside the geofence) are skipped, as the real robot would.
sim_drone.takeoff()
for task in bridge_plan["tasks"]:
    try:
        if task["id"] not in blocked:
            sim_drone.goto(pose_for_task(task, standoff_m=0.8, approach_from=sim_drone.pose))
        sim_drone.inspect(task["id"])            # a blocked task raises: recorded as skipped
    except ValueError as err:
        print(f"  skipped by pre-flight: {err}")
    except BatteryLowError as err:
        print(f"  battery low, turning back: {err}")
        break

# 3. Report findings like a detection stack: JSON on /autoassess/findings, one object or an
#    array. x, y, z are required; bad entries are skipped and logged, exactly as on the robot.
p = sim_drone.pose
ros.publish("/autoassess/findings", std_msgs.String(data=json.dumps([
    {"id": "corr-001", "x": p.x, "y": p.y, "z": p.z, "class": "corrosion",
     "confidence": 0.87, "description": "pitting near the weld"},
    {"id": "corr-bad", "x": 1.0, "y": 2.0},                             # no z: skipped + logged
])))
ros.publish("/autoassess/findings", {"id": "crack-002", "x": p.x + 0.4, "y": p.y, "z": p.z,
                                     "nx": 0.0, "ny": -1.0, "nz": 0.0, "radius": 0.2,
                                     "inspection_type": "ndt_thickness"})

# 4. Landing ends the mission: the bridge "uploads" and turns the findings into defect
#    detections on the campaign (simulated here; nothing is written to CDF).
sim_drone.return_home()
sim_drone.land()

print("upload_status:", " -> ".join(s["state"] for s in statuses))
final = statuses[-1]
print(f"defects: {final['findings']['count']} created:", ", ".join(final["findings"]["defectExternalIds"]))
# In the real AutoAssess app these appear in the Defects tab (status New, source ml) for the
# inspector to review — confirmed ones become inspection tasks through the Suggestions flow.
`;

export const STARTER_EXAMPLES: StarterExample[] = [
  { id: 'list-plans', title: '1. List plans', code: LIST_PLANS },
  { id: 'verify-plan', title: '2. Verify a plan', code: VERIFY_PLAN },
  { id: 'fly-mission', title: '3. Fly the mission', code: FLY_MISSION },
  { id: 'hand-fly', title: '4. Hand-fly with poses', code: HAND_FLY },
  { id: 'gb-explore', title: '5. gbplanner: explore + inspect', code: GB_EXPLORE },
  { id: 'gb-target-reach', title: '6. gbplanner: target reach per task', code: GB_TARGET_REACH },
  { id: 'bridge', title: '7. bridge: plans in, findings out', code: BRIDGE },
];
