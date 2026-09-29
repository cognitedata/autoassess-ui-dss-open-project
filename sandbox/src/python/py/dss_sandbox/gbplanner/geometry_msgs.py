"""geometry_msgs (ROS) as plain dataclasses, same field names as the .msg files."""

from __future__ import annotations

from dataclasses import dataclass, field

from dss_sandbox.gbplanner.std_msgs import Header

__all__ = ["Header", "Point", "Pose", "PoseArray", "PoseStamped", "Quaternion"]


@dataclass
class Point:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


@dataclass
class Quaternion:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    w: float = 1.0


@dataclass
class Pose:
    position: Point = field(default_factory=Point)
    orientation: Quaternion = field(default_factory=Quaternion)


@dataclass
class PoseStamped:
    header: Header = field(default_factory=Header)
    pose: Pose = field(default_factory=Pose)


@dataclass
class PoseArray:
    header: Header = field(default_factory=Header)
    poses: list[Pose] = field(default_factory=list)
