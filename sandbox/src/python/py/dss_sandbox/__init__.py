"""dss_sandbox — things that only exist in the sandbox: the simulated drone and area helpers.

    from dss_sandbox import SimDrone
    sim_drone = SimDrone(speed_mps=0.5)
    report = sim_drone.fly_plan(plan)   # plan.json dict or path; the browser animates the flight
    print(report.summary())

On a real ground station you drive your own drone with the same verbs: takeoff, goto(Pose),
inspect, return_home, land.
"""

from dss_sandbox.area import Bounds, ElementInfo, area_bounds, structural_elements
from dss_sandbox.simdrone import (
    BatteryLowError,
    MissionEvent,
    MissionReport,
    PreflightIssue,
    SimDrone,
    TelemetrySample,
)
from dss_sandbox.pose import Pose, pose_for_task

__all__ = [
    "BatteryLowError",
    "Bounds",
    "ElementInfo",
    "MissionEvent",
    "MissionReport",
    "Pose",
    "PreflightIssue",
    "SimDrone",
    "TelemetrySample",
    "area_bounds",
    "pose_for_task",
    "structural_elements",
]
