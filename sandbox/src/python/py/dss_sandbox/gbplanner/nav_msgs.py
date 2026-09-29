"""nav_msgs (ROS): Path, as published on /gbplanner_path."""

from __future__ import annotations

from dataclasses import dataclass, field

from dss_sandbox.gbplanner.geometry_msgs import PoseStamped
from dss_sandbox.gbplanner.std_msgs import Header


@dataclass
class Path:
    header: Header = field(default_factory=Header)
    poses: list[PoseStamped] = field(default_factory=list)
