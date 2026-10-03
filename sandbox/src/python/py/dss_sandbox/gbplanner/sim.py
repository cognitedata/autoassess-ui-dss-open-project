"""SimGbPlanner: a simulated gbplanner3 / OmniPlanner (NTNU ARL, BSD-3) for the sandbox.

Not the real planner: a simplified, deterministic stand-in that runs in the browser, answers the
real service and topic names with ROS-shaped messages, and flies `sim_drone`:

    sim_gbplanner = SimGbPlanner(sim_drone, config="bwt_inspection")
    ros = sim_gbplanner.ros
    ros.subscribe("/gbplanner_path", on_path)
    ros.call("pci_initialization_trigger")
    ros.call("planner_control_interface/std_srvs/automatic_planning")
    ros.spin()

On a ground station the same calls go to the real planner through rospy (or roslibpy).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import _sandbox_bridge  # JS module registered by the sandbox worker

from dss_sandbox.gbplanner.autoassess import (
    BRIDGE_INPUT_TOPICS,
    BRIDGE_OUTPUT_TOPICS,
    FINDINGS_TOPIC,
    UPLOAD_MISSION_SERVICE,
    SimAutoassessBridge,
)
from dss_sandbox.gbplanner.geometry_msgs import Point, PoseStamped
from dss_sandbox.gbplanner.nav_msgs import Path
from dss_sandbox.gbplanner.planner_msgs import (
    ExecutionPathMode,
    PlannerStatus,
    PlanningBound,
    RobotStatus,
    TriggerMode,
    pci_initialization,
    planner_set_global_bound,
    planner_set_planning_mode,
)
from dss_sandbox.gbplanner.std_msgs import Bool, Header, String
from dss_sandbox.gbplanner.std_srvs import SetBool, Trigger
from dss_sandbox.gbplanner.transforms import to_pose_stamped, to_sandbox_pose
from dss_sandbox.pose import Pose
from dss_sandbox.simdrone import SimDrone, _raise_for

FRAME_ID = "world"
MAX_SPIN_STEPS = 5000

_TRIGGER = (Trigger.Request, Trigger.Response)

#: Service name -> (request type, response type).
SERVICES: dict[str, tuple[type, type]] = {
    "pci_initialization_trigger": (pci_initialization.Request, pci_initialization.Response),
    "planner_control_interface/std_srvs/automatic_planning": _TRIGGER,
    "planner_control_interface/std_srvs/single_planning": _TRIGGER,
    "planner_control_interface/std_srvs/homing_trigger": _TRIGGER,
    "planner_control_interface/std_srvs/go_to_waypoint": _TRIGGER,
    "planner_control_interface/std_srvs/stop": _TRIGGER,
    "planner_control_interface/std_srvs/inspection_srv_trigger": _TRIGGER,
    "gbplanner/set_global_bound": (planner_set_global_bound.Request, planner_set_global_bound.Response),
    "gbplanner/switch_operation_mode": (SetBool.Request, SetBool.Response),
    "gbplanner/set_planning_trigger_mode": (planner_set_planning_mode.Request, planner_set_planning_mode.Response),
    # Simulated autoassess_bridge (see dss_sandbox.gbplanner.autoassess).
    UPLOAD_MISSION_SERVICE: _TRIGGER,
}
#: Topics a script publishes to (the planner / bridge subscribe) -> message type.
INPUT_TOPICS: dict[str, type] = {
    "/move_base_simple/goal": PoseStamped,
    "/robot_status": RobotStatus,
    "planner_control_interface/stop_request": Bool,
    **BRIDGE_INPUT_TOPICS,
}
#: Topics a script can subscribe to -> message type.
OUTPUT_TOPICS: dict[str, type] = {
    "/gbplanner_path": Path,
    "/robot_status": RobotStatus,
    **BRIDGE_OUTPUT_TOPICS,
}


def _key(name: str) -> str:
    return name.lstrip("/")


_SERVICE_KEYS = {_key(n): n for n in SERVICES}
_INPUT_KEYS = {_key(n): n for n in INPUT_TOPICS}
_OUTPUT_KEYS = {_key(n): n for n in OUTPUT_TOPICS}


@dataclass(frozen=True)
class CompartmentCoverage:
    """One compartment of the BWT sequence (a slab between the tank's transverse frames)."""

    index: int  # 1-based, ordered along x
    x_min: float
    x_max: float
    explored_pct: float
    coverage_pct: float


@dataclass(frozen=True)
class GbPlannerReport:
    config: str
    mode: str  # idle | exploration | inspection | target-reach | waypoint | homing
    iterations: int  # planning iterations that published a /gbplanner_path
    explored_pct: float  # known voxels / voxels in the global bound
    surface_coverage_pct: float  # inspected / mapped surface voxels in the global bound
    distance_m: float
    duration_s: float
    viewpoints: int  # inspection viewpoints planned
    covered_tasks: dict[str, float]  # plan task id -> simulated time the camera covered it
    uncovered_tasks: list[str]
    voxel_resolution_m: float
    voxels: int
    synthetic_tank: str
    compartments: list[CompartmentCoverage]  # [] when the BWT flow never sequenced

    def summary(self) -> str:
        total = len(self.covered_tasks) + len(self.uncovered_tasks)
        return "\n".join(
            [
                f"gbplanner ({self.config}): {self.iterations} iterations, explored {self.explored_pct:.0f}%, "
                f"surface coverage {self.surface_coverage_pct:.0f}%, {self.viewpoints} inspection viewpoints",
                f"  {self.distance_m:.1f} m flown in {self.duration_s:.0f} s (simulated), mode {self.mode}",
                *(
                    [
                        f"    compartment {c.index} (x {c.x_min:.2f} – {c.x_max:.2f}): "
                        f"explored {c.explored_pct:.0f}%, coverage {c.coverage_pct:.0f}%"
                        for c in self.compartments
                    ]
                    if len(self.compartments) > 1
                    else []
                ),
                f"  plan tasks covered by the inspection camera: {len(self.covered_tasks)}/{total}",
                *[f"    {tid} at t={t:.1f} s" for tid, t in self.covered_tasks.items()],
                *[f"    not covered: {tid}" for tid in self.uncovered_tasks],
            ]
        )


class SimRos:
    """rospy-like handle on the simulated planner: call / publish / subscribe / spin."""

    def __init__(self, planner: SimGbPlanner) -> None:
        self._planner = planner
        self._subscribers: dict[str, list[Callable[[Any], None]]] = {}
        self._seq: dict[str, int] = {}

    def call(self, service: str, req: Any = None) -> Any:
        """Call a service (like rospy.ServiceProxy(service, type)(req)). Returns its Response."""
        name = _SERVICE_KEYS.get(_key(service))
        if name is None:
            raise ValueError(f"Unknown service '{service}'. Supported services: {', '.join(SERVICES)}")
        req_type, resp_type = SERVICES[name]
        if req is None:
            req = req_type()
        if not isinstance(req, req_type):
            raise TypeError(f"{name} expects {_type_name(req_type)}, got {type(req).__name__}")
        if name == UPLOAD_MISSION_SERVICE:  # handled by the simulated autoassess_bridge
            success, message = self._planner._autoassess.upload_mission()
            return resp_type(success=success, message=message)
        reply = self._planner._bridge("gb_call", {"service": name, "request": _encode_request(req)})
        return _decode_response(resp_type, reply["response"])

    def publish(self, topic: str, msg: Any) -> None:
        """Publish a message (like rospy.Publisher(topic, type).publish(msg))."""
        name = _INPUT_KEYS.get(_key(topic))
        if name is None:
            raise ValueError(f"Unknown topic '{topic}'. Topics you can publish: {', '.join(INPUT_TOPICS)}")
        if name == FINDINGS_TOPIC:  # std_msgs String, or a plain dict / list (sandbox nicety)
            if not isinstance(msg, (String, str, dict, list)):
                raise TypeError(f"{name} expects std_msgs.String (JSON), a dict or a list, got {type(msg).__name__}")
            self._planner._autoassess.handle_findings(msg)
            return
        msg_type = INPUT_TOPICS[name]
        if not isinstance(msg, msg_type):
            raise TypeError(f"{name} expects {_type_name(msg_type)}, got {type(msg).__name__}")
        self._planner._bridge("gb_publish", {"topic": name, "msg": _encode_message(msg)})

    def subscribe(self, topic: str, callback: Callable[[Any], None]) -> None:
        """Call `callback(msg)` for every message on `topic` (like rospy.Subscriber).

        The /autoassess/* topics are latched (as on the real bridge): the current plan or upload
        status is delivered to the callback immediately.
        """
        name = _OUTPUT_KEYS.get(_key(topic))
        if name is None:
            raise ValueError(f"Unknown topic '{topic}'. Topics you can subscribe to: {', '.join(OUTPUT_TOPICS)}")
        self._subscribers.setdefault(_key(name), []).append(callback)
        if name in BRIDGE_OUTPUT_TOPICS:
            for msg in self._planner._autoassess.latched(name):
                callback(msg)

    def _deliver_local(self, topic: str, msg: Any) -> None:
        """Hand a Python-side (bridge) message to this topic's subscribers."""
        for callback in self._subscribers.get(_key(topic), []):
            callback(msg)

    def spin(self, until_s: float | None = None) -> None:
        """Run the simulated clock until the planner is idle (or the flight time reaches until_s).

        Every planning iteration publishes /gbplanner_path and the drone flies it; subscriber
        callbacks run in between and may call services (e.g. homing_trigger).
        """
        for _ in range(MAX_SPIN_STEPS):
            reply = self._planner._bridge("gb_spin_step", {"untilS": until_s})
            if reply["idle"]:
                return
        raise RuntimeError(f"spin(): the planner was still busy after {MAX_SPIN_STEPS} steps")

    def _dispatch(self, messages: list[dict[str, Any]]) -> None:
        for raw in messages:
            key = _key(raw["topic"])
            callbacks = self._subscribers.get(key)
            if not callbacks:
                continue
            seq = self._seq.get(key, 0) + 1
            self._seq[key] = seq
            header = Header(seq=seq, stamp=float(raw["stamp"]), frame_id=FRAME_ID)
            if key == "gbplanner_path":
                msg: Any = Path(
                    header=header,
                    poses=[to_pose_stamped(_pose(p), FRAME_ID, header.stamp) for p in raw["poses"]],
                )
            else:
                msg = RobotStatus(header=header, time_remaining=float(raw["timeRemaining"]))
            for callback in callbacks:
                callback(msg)


class SimGbPlanner:
    """The simulated gbplanner, flying `sim_drone` (which must have a plan loaded: the area).

    config: "bwt_inspection" (explore, inspect the mapped surfaces, go home) or
    "cave_exploration" (explore, go home). seed: the planner's random sampling is deterministic.
    verbose: print the planner's log lines ("[gbplanner] ...") like a ROS node would.
    plan_name: the simulated autoassess_bridge's plan override (the real node's `plan_name`
    launch parameter): its /autoassess/* plan topics then relay only the Ready or Active plan
    with exactly that name; None (the default) follows the most recently updated Active plan,
    else the most recently updated Ready plan.
    """

    def __init__(
        self,
        sim_drone: SimDrone,
        config: str = "bwt_inspection",
        seed: int = 0,
        verbose: bool = True,
        plan_name: str | None = None,
    ) -> None:
        if not isinstance(sim_drone, SimDrone):
            raise TypeError("SimGbPlanner(sim_drone) expects the SimDrone that it should fly")
        self._drone = sim_drone
        self._verbose = verbose
        self._ros = SimRos(self)
        self._autoassess = SimAutoassessBridge(sim_drone, self._ros._deliver_local, plan_name=plan_name)
        info = self._bridge("gb_new", {"config": config, "seed": int(seed)})
        self.config: str = info["config"]
        self.synthetic_tank: str = info["tank"]

    @property
    def ros(self) -> SimRos:
        return self._ros

    @property
    def drone(self) -> SimDrone:
        return self._drone

    @property
    def mode(self) -> str:
        return str(self.report().mode)

    def report(self) -> GbPlannerReport:
        r = self._bridge("gb_report")
        return GbPlannerReport(
            config=r["config"],
            mode=r["mode"],
            iterations=int(r["iterations"]),
            explored_pct=float(r["exploredPct"]),
            surface_coverage_pct=float(r["surfaceCoveragePct"]),
            distance_m=float(r["distanceM"]),
            duration_s=float(r["durationS"]),
            viewpoints=int(r["viewpoints"]),
            covered_tasks={k: float(v) for k, v in r["coveredTasks"].items()},
            uncovered_tasks=list(r["uncoveredTasks"]),
            voxel_resolution_m=float(r["voxelResolutionM"]),
            voxels=int(r["voxels"]),
            synthetic_tank=r["syntheticTank"],
            compartments=[
                CompartmentCoverage(
                    index=int(c["index"]),
                    x_min=float(c["xMin"]),
                    x_max=float(c["xMax"]),
                    explored_pct=float(c["exploredPct"]),
                    coverage_pct=float(c["coveragePct"]),
                )
                for c in r.get("compartments", [])
            ],
        )

    def status(self) -> PlannerStatus:
        """planner_msgs/PlannerStatus for the current state (sandbox convenience)."""
        mode = self.mode
        speed = float(json.loads(_sandbox_bridge.sim_report())["mission"]["options"]["speedMps"])
        exe = {"homing": ExecutionPathMode.kHomingPath, "waypoint": ExecutionPathMode.kGlobalPath}
        return PlannerStatus(
            header=Header(stamp=self._drone.flight_time_s, frame_id=FRAME_ID),
            success=True,
            trigger_mode=TriggerMode(TriggerMode.kManual if mode == "idle" else TriggerMode.kAuto),
            exe_path_mode=ExecutionPathMode(exe.get(mode, ExecutionPathMode.kLocalPath)),
            max_vel=speed,
        )

    def _bridge(self, name: str, payload: Any = None) -> Any:
        args = [] if payload is None else [json.dumps(payload)]
        reply = json.loads(getattr(_sandbox_bridge, name)(*args))
        if isinstance(reply, dict):
            if self._verbose:
                for line in reply.get("log", []):
                    print(f"[gbplanner] {line}")
            _raise_for(reply)
            self._ros._dispatch(reply.get("messages", []))
        return reply


def _type_name(t: type) -> str:
    return t.__qualname__ if "." in t.__qualname__ else f"{t.__module__.rsplit('.', 1)[-1]}.{t.__qualname__}"


def _pose(raw: dict[str, Any]) -> Pose:
    return Pose(raw["x"], raw["y"], raw["z"], raw["roll"], raw["pitch"], raw["yaw"])


def _vec(p: Point) -> list[float]:
    return [float(p.x), float(p.y), float(p.z)]


def _encode_request(req: Any) -> dict[str, Any]:
    if isinstance(req, planner_set_global_bound.Request):
        return {
            "getCurrentBound": bool(req.get_current_bound),
            "resetToDefault": bool(req.reset_to_default),
            "bound": {
                "useZVal": bool(req.bound.use_z_val),
                "min": _vec(req.bound.min_val),
                "max": _vec(req.bound.max_val),
            },
        }
    if isinstance(req, SetBool.Request):
        return {"data": bool(req.data)}
    if isinstance(req, planner_set_planning_mode.Request):
        return {"planningMode": int(req.planning_mode)}
    return {}


def _decode_response(resp_type: type, raw: dict[str, Any]) -> Any:
    if resp_type is planner_set_global_bound.Response:
        b = raw.get("boundRet") or {}
        return resp_type(
            success=bool(raw["success"]),
            bound_ret=PlanningBound(
                use_z_val=bool(b.get("useZVal", True)),
                min_val=Point(*b.get("min", (0.0, 0.0, 0.0))),
                max_val=Point(*b.get("max", (0.0, 0.0, 0.0))),
            ),
        )
    if resp_type in (Trigger.Response, SetBool.Response):
        return resp_type(success=bool(raw["success"]), message=str(raw.get("message", "")))
    return resp_type(success=bool(raw["success"]))


def _encode_message(msg: Any) -> dict[str, Any]:
    if isinstance(msg, PoseStamped):
        p = to_sandbox_pose(msg)
        return {"pose": {"x": p.x, "y": p.y, "z": p.z, "roll": p.roll, "pitch": p.pitch, "yaw": p.yaw}}
    if isinstance(msg, RobotStatus):
        return {"timeRemaining": float(msg.time_remaining)}
    return {"data": bool(msg.data)}
