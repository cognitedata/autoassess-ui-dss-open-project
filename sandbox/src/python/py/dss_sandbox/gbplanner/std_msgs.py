"""std_msgs (ROS) as plain dataclasses: the fields gbplanner's messages use."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Header:
    seq: int = 0
    stamp: float = 0.0  # seconds of simulated flight time (rospy: rospy.Time)
    frame_id: str = ""


@dataclass
class Bool:
    data: bool = False


@dataclass
class String:
    data: str = ""
