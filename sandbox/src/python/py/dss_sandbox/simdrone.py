"""SimDrone: the sandbox's simulated drone.

Its methods are the verbs a real drone driver has (take off, go to a pose, inspect, return home,
land). The kinematic simulator behind them runs in the browser (TypeScript), which draws every
step in the simulator panel. On a ground station you implement the same verbs for your drone.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from math import dist
from pathlib import Path
from typing import Any

import _sandbox_bridge  # JS module registered by the sandbox worker

from dss_sandbox.pose import Pose, pose_for_task, task_target


class BatteryLowError(RuntimeError):
    """The step would leave too little battery to get home. Call return_home() and land()."""


@dataclass(frozen=True)
class PreflightIssue:
    task_id: str
    severity: str  # "error" (the task can't be inspected) | "warning"
    code: str  # "no-pose" | "out-of-bounds" | "missing-normal"
    message: str


@dataclass(frozen=True)
class MissionEvent:
    t: float  # simulated seconds since take-off
    kind: str  # takeoff | arrived | inspected | skipped | battery-rth | return | landed
    message: str
    task_id: str | None = None


@dataclass(frozen=True)
class TelemetrySample:
    t: float
    x: float
    y: float
    z: float
    phase: str  # takeoff | transit | inspect | return | land | done


@dataclass(frozen=True)
class MissionReport:
    plan_external_id: str
    visited: list[str]
    skipped: dict[str, str]  # task id -> reason
    distance_m: float
    duration_s: float
    events: list[MissionEvent]
    telemetry: list[TelemetrySample]

    def summary(self) -> str:
        total = len(self.visited) + len(self.skipped)
        lines = [
            f"Mission {self.plan_external_id}: {len(self.visited)}/{total} tasks inspected, "
            f"{self.distance_m:.1f} m flown in {self.duration_s:.0f} s (simulated)",
        ]
        lines += [f"  skipped {tid}: {reason}" for tid, reason in self.skipped.items()]
        return "\n".join(lines)


EventCallback = Callable[[MissionEvent], None]
PlanInput = dict[str, Any] | str | Path


class SimDrone:
    """A simulated drone. Create one per mission script:

        sim_drone = SimDrone(speed_mps=0.5)
        sim_drone.load_plan(plan)
        sim_drone.takeoff()
        sim_drone.goto(pose_for_task(task))
        sim_drone.inspect(task["id"])
        sim_drone.return_home()
        sim_drone.land()

    Every call blocks until the step is done in simulated time and is drawn in the browser.
    """

    def __init__(
        self,
        speed_mps: float = 0.5,
        max_flight_time_s: float = 900.0,
        home: Sequence[float] | None = None,
    ) -> None:
        """home: take-off/landing point; None = the low -x end of the plan's area."""
        self._plan: dict[str, Any] | None = None
        self._callbacks: list[EventCallback] = []
        _call(
            "sim_new",
            {
                "speedMps": speed_mps,
                "maxFlightTimeS": max_flight_time_s,
                "home": [float(v) for v in home] if home is not None else None,
            },
        )

    # --- mission set-up --------------------------------------------------------------------

    @property
    def plan(self) -> dict[str, Any] | None:
        """The loaded plan.json dict."""
        return self._plan

    def load_plan(self, plan: PlanInput) -> list[PreflightIssue]:
        """Give the drone a plan (plan.json dict or path). Returns the pre-flight issues."""
        if isinstance(plan, (str, Path)):
            plan = json.loads(Path(plan).read_text())
        if not isinstance(plan, dict):
            raise TypeError("load_plan() expects a plan.json dict or a path to plan.json")
        raw = self._step("sim_load_plan", plan)
        self._plan = plan
        return [_issue(i) for i in raw]

    def preflight_check(self) -> list[PreflightIssue]:
        """Problems with the loaded plan: tasks without a pose, targets outside the area, ..."""
        if self._plan is None:
            raise RuntimeError("No plan loaded. Call sim_drone.load_plan(plan) first.")
        return [_issue(i) for i in _call("preflight", self._plan)]

    def on_event(self, callback: EventCallback) -> None:
        """Call `callback(MissionEvent)` synchronously for every event, as it happens."""
        self._callbacks.append(callback)

    # --- flight primitives (what a real drone driver implements) ---------------------------

    def takeoff(self, height_m: float = 1.0) -> Pose:
        """Climb straight up from home. Returns the reached pose."""
        return _pose(self._step("sim_takeoff", {"heightM": height_m}))

    def goto(self, pose: Pose) -> Pose:
        """Fly a straight line to `pose` (blocks until reached). Returns the reached pose.

        Raises BatteryLowError (without moving) if the leg would leave too little battery to get
        home.
        """
        if not isinstance(pose, Pose):
            raise TypeError("goto() expects a Pose, e.g. Pose(x, y, z, yaw=0.0)")
        return _pose(self._step("sim_goto", asdict(pose)))

    def inspect(self, task_id: str, seconds: float | None = None) -> None:
        """Hover and capture at the current pose; marks the task inspected.

        seconds: None = 3 s for visual, 8 s for ndt_thickness. Raises ValueError for a task with a
        pre-flight error (the task is recorded as skipped) and BatteryLowError if there isn't
        enough battery left.
        """
        self._step("sim_inspect", {"taskId": task_id, "seconds": seconds})

    def return_home(self) -> Pose:
        """Fly back to the point above home at take-off height."""
        return _pose(self._step("sim_return_home"))

    def land(self) -> Pose:
        """Descend and land. Tasks not inspected by now are reported as skipped."""
        return _pose(self._step("sim_land"))

    # --- state ----------------------------------------------------------------------------

    @property
    def pose(self) -> Pose:
        return _pose(_call("sim_state")["pose"])

    @property
    def state(self) -> str:
        """Either "landed" or "flying"."""
        return str(_call("sim_state")["state"])

    @property
    def flight_time_s(self) -> float:
        return float(_call("sim_state")["flightTimeS"])

    @property
    def distance_m(self) -> float:
        return float(_call("sim_state")["distanceM"])

    def report(self) -> MissionReport:
        """The flight so far: inspected and skipped tasks, distance, time, events, telemetry."""
        raw = _call("sim_report")
        mission = raw["mission"]
        return MissionReport(
            plan_external_id=mission["planExternalId"],
            visited=[t["id"] for t in mission["tasks"] if t["status"] == "visited"],
            skipped={
                t["id"]: t.get("skipReason", "") for t in mission["tasks"] if t["status"] == "skipped"
            },
            distance_m=mission["summary"]["distanceM"],
            duration_s=mission["summary"]["durationS"],
            events=[_event(e) for e in mission["events"]],
            telemetry=[
                TelemetrySample(s["t"], *s["position"], s["phase"]) for s in raw["telemetry"]
            ],
        )

    # --- reference mission ----------------------------------------------------------------

    def fly_plan(
        self, plan: PlanInput, order: list[str] | None = None, standoff_m: float = 0.8
    ) -> MissionReport:
        """Fly a whole plan with the primitives above; a template for a real drone driver.

        Tasks are flown in `order` (task ids; unlisted tasks are not flown) or greedy
        nearest-neighbour from the take-off point. Tasks with pre-flight errors are skipped. When
        the battery runs low the drone turns back; tasks not inspected are reported as skipped.
        """
        issues = self.load_plan(plan)
        assert self._plan is not None
        blocked = {i.task_id for i in issues if i.severity == "error"}
        self.takeoff()
        for task in _flight_order(self._plan["tasks"], order, start=self.pose):
            try:
                if task["id"] not in blocked:
                    self.goto(pose_for_task(task, standoff_m, approach_from=self.pose))
                self.inspect(task["id"])  # a task with a pre-flight error raises ValueError
            except ValueError:
                continue  # recorded as skipped (see the "skipped" event)
            except BatteryLowError:
                break  # not enough battery for this task: head home
        self.return_home()
        self.land()
        return self.report()

    # --- internals ------------------------------------------------------------------------

    def _step(self, name: str, payload: Any = None) -> Any:
        reply = json.loads(getattr(_sandbox_bridge, name)(*_args(payload)))
        for raw in reply.get("events", []):
            event = _event(raw)
            for callback in self._callbacks:
                callback(event)
        _raise_for(reply)
        return reply["result"]


def _flight_order(
    tasks: list[dict[str, Any]], order: list[str] | None, start: Pose
) -> list[dict[str, Any]]:
    if order is not None:
        by_id = {t["id"]: t for t in tasks}
        unknown = [tid for tid in order if tid not in by_id]
        if unknown:
            raise ValueError(f"order contains unknown task ids: {unknown}")
        if len(set(order)) != len(order):
            raise ValueError("order contains a task id twice")
        return [by_id[tid] for tid in order]
    # Greedy nearest neighbour; tasks without a pose go last (they will be skipped).
    remaining = [t for t in tasks if task_target(t) is not None]
    here, ordered = start.position, []
    while remaining:
        nearest = min(remaining, key=lambda t: dist(here, task_target(t) or here))
        ordered.append(nearest)
        here = task_target(nearest) or here
        remaining.remove(nearest)
    return ordered + [t for t in tasks if task_target(t) is None]


def _args(payload: Any) -> list[str]:
    return [] if payload is None else [json.dumps(payload)]


def _call(name: str, payload: Any = None) -> Any:
    reply = json.loads(getattr(_sandbox_bridge, name)(*_args(payload)))
    _raise_for(reply)
    return reply


def _raise_for(reply: Any) -> None:
    if not (isinstance(reply, dict) and "error" in reply):
        return
    kind = reply.get("errorKind")
    if kind == "battery":
        raise BatteryLowError(reply["error"])
    if kind == "state":
        raise RuntimeError(reply["error"])
    raise ValueError(reply["error"])


def _pose(raw: dict[str, Any]) -> Pose:
    return Pose(raw["x"], raw["y"], raw["z"], raw["roll"], raw["pitch"], raw["yaw"])


def _event(raw: dict[str, Any]) -> MissionEvent:
    return MissionEvent(raw["t"], raw["kind"], raw["message"], raw.get("taskId"))


def _issue(raw: dict[str, Any]) -> PreflightIssue:
    return PreflightIssue(raw["taskId"], raw["severity"], raw["code"], raw["message"])
