"""Poses: where the drone is and which way it looks."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class Pose:
    """Position in metres (the area's map frame, `mapExternalId`) and attitude in radians.

    yaw:   heading in the x-y plane, counter-clockwise from +x.
    pitch: camera elevation; positive looks up, -pi/2 looks straight down.
    roll:  0 for a level drone.
    """

    x: float
    y: float
    z: float
    roll: float = 0.0
    pitch: float = 0.0
    yaw: float = 0.0

    @property
    def position(self) -> Vec3:
        return (self.x, self.y, self.z)

    def distance_to(self, other: Pose | Sequence[float]) -> float:
        p = other.position if isinstance(other, Pose) else other
        return math.dist(self.position, (float(p[0]), float(p[1]), float(p[2])))

    @classmethod
    def facing(
        cls, target: Sequence[float], normal: Sequence[float], standoff_m: float = 0.8
    ) -> Pose:
        """Hover `standoff_m` out from `target` along the surface `normal`, looking at the target."""
        n = _unit(normal) or (0.0, 0.0, 1.0)
        look = (-n[0], -n[1], -n[2])
        horizontal = math.hypot(look[0], look[1])
        return cls(
            x=float(target[0]) + n[0] * standoff_m,
            y=float(target[1]) + n[1] * standoff_m,
            z=float(target[2]) + n[2] * standoff_m,
            pitch=math.atan2(look[2], horizontal),
            yaw=math.atan2(look[1], look[0]) if horizontal > 1e-9 else 0.0,
        )

    def __str__(self) -> str:
        return (
            f"Pose(x={self.x:.2f}, y={self.y:.2f}, z={self.z:.2f}, "
            f"yaw={_deg(self.yaw)}°, pitch={_deg(self.pitch)}°)"
        )


def task_target(task: dict[str, Any]) -> Vec3 | None:
    """The point a plan.json task inspects: the element centre, or the region's position3d."""
    point = (
        (task.get("targetElement") or {}).get("center")
        if task.get("kind") == "element"
        else task.get("position3d")
    )
    if point is None:
        return None
    return (float(point[0]), float(point[1]), float(point[2]))


def pose_for_task(
    task: dict[str, Any],
    standoff_m: float = 0.8,
    approach_from: Pose | Sequence[float] | None = None,
) -> Pose:
    """Where to hover to inspect a plan.json task, facing its surface.

    Region tasks back off along their normalVector. Element tasks have no normal: the drone stops
    `standoff_m` short of the element centre on the line from `approach_from` (or above the centre
    if no approach point is given). Raises ValueError for a task without a pose.
    """
    target = task_target(task)
    if target is None:
        raise ValueError(f"Task {task.get('id')} has no pose (no element centre / position3d)")
    normal: Sequence[float] | None = None
    if task.get("kind") == "region":
        normal = task.get("normalVector")
    elif approach_from is not None:
        start = approach_from.position if isinstance(approach_from, Pose) else approach_from
        normal = tuple(float(start[i]) - target[i] for i in range(3))
    return Pose.facing(target, normal or (0.0, 0.0, 1.0), standoff_m)


def _unit(v: Sequence[float] | None) -> Vec3 | None:
    if v is None:
        return None
    length = math.hypot(float(v[0]), float(v[1]), float(v[2]))
    if length < 1e-9:
        return None
    return (float(v[0]) / length, float(v[1]) / length, float(v[2]) / length)


def _deg(radians: float) -> int:
    return round(math.degrees(radians)) or 0  # no "-0"
