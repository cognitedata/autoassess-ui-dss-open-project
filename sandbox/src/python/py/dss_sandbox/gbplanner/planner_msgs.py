"""planner_msgs (gbplanner3, NTNU ARL, BSD-3): the messages and services the sandbox supports.

Field names and constants are copied from planner_msgs/msg/*.msg and planner_msgs/srv/*.srv
(github.com/ntnu-arl/gbplanner_ros, branch gbplanner3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import ClassVar

from dss_sandbox.gbplanner.geometry_msgs import Point
from dss_sandbox.gbplanner.std_msgs import Header


@dataclass
class PlanningBound:
    use_z_val: bool = False  # False: change only x and y
    min_val: Point = field(default_factory=Point)  # bottom left corner
    max_val: Point = field(default_factory=Point)  # top right corner


@dataclass
class RobotStatus:
    header: Header = field(default_factory=Header)
    time_remaining: float = 0.0


@dataclass
class TriggerMode:
    kManual: ClassVar[int] = 0
    kAuto: ClassVar[int] = 1
    mode: int = 0


@dataclass
class BoundMode:
    kExtendedBound: ClassVar[int] = 0
    kRelaxedBound: ClassVar[int] = 1
    kMinBound: ClassVar[int] = 2
    kExactBound: ClassVar[int] = 3
    kNoBound: ClassVar[int] = 4
    mode: int = 0


@dataclass
class PlanningMode:
    kBasicExploration: ClassVar[int] = 0
    kNarrowEnvExploration: ClassVar[int] = 1
    kAdaptiveExploration: ClassVar[int] = 2
    mode: int = 0


@dataclass
class ExecutionPathMode:
    kLocalPath: ClassVar[int] = 0
    kHomingPath: ClassVar[int] = 1
    kGlobalPath: ClassVar[int] = 2
    mode: int = 0
    is_forward: bool = True


@dataclass
class PlannerStatus:
    header: Header = field(default_factory=Header)
    success: bool = False
    trigger_mode: TriggerMode = field(default_factory=TriggerMode)
    bound_mode: BoundMode = field(default_factory=BoundMode)
    planning_mode: PlanningMode = field(default_factory=PlanningMode)
    exe_path_mode: ExecutionPathMode = field(default_factory=ExecutionPathMode)
    max_vel: float = 0.0


class planner_set_global_bound:  # noqa: N801 (ROS service name)
    @dataclass
    class Request:
        get_current_bound: bool = False  # True: only return the current bound
        reset_to_default: bool = False
        bound: PlanningBound = field(default_factory=PlanningBound)

    @dataclass
    class Response:
        success: bool = False
        bound_ret: PlanningBound = field(default_factory=PlanningBound)


class planner_set_planning_mode:  # noqa: N801
    kManual: ClassVar[int] = 0
    kAuto: ClassVar[int] = 1

    @dataclass
    class Request:
        planning_mode: int = 0

    @dataclass
    class Response:
        success: bool = False


class pci_initialization:  # noqa: N801
    @dataclass
    class Request:
        pass

    @dataclass
    class Response:
        success: bool = False
