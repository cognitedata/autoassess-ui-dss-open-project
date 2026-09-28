"""Conversions between ROS messages and the sandbox Pose (like tf.transformations).

ROS attitude: roll/pitch/yaw about x/y/z (ZYX), body x forward, y left, z up; a positive ROS
pitch points the nose *down*. The sandbox Pose's pitch is the camera elevation (positive looks
up), so ROS pitch = -Pose.pitch.
"""

from __future__ import annotations

import math

from dss_sandbox.gbplanner.geometry_msgs import Point, Pose as RosPose, PoseStamped, Quaternion
from dss_sandbox.gbplanner.std_msgs import Header
from dss_sandbox.pose import Pose


def quaternion_from_euler(roll: float, pitch: float, yaw: float) -> Quaternion:
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return Quaternion(
        x=sr * cp * cy - cr * sp * sy,
        y=cr * sp * cy + sr * cp * sy,
        z=cr * cp * sy - sr * sp * cy,
        w=cr * cp * cy + sr * sp * sy,
    )


def euler_from_quaternion(q: Quaternion) -> tuple[float, float, float]:
    """(roll, pitch, yaw) in ROS convention."""
    roll = math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y))
    pitch = math.asin(max(-1.0, min(1.0, 2 * (q.w * q.y - q.z * q.x))))
    yaw = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
    return roll, pitch, yaw


def to_pose_stamped(pose: Pose, frame_id: str = "world", stamp: float = 0.0) -> PoseStamped:
    """Sandbox Pose -> geometry_msgs/PoseStamped (e.g. a goal for /move_base_simple/goal)."""
    if not isinstance(pose, Pose):
        raise TypeError("to_pose_stamped() expects a dss_sandbox Pose")
    return PoseStamped(
        header=Header(stamp=stamp, frame_id=frame_id),
        pose=RosPose(
            position=Point(pose.x, pose.y, pose.z),
            orientation=quaternion_from_euler(pose.roll, -pose.pitch, pose.yaw),
        ),
    )


def to_sandbox_pose(msg: PoseStamped | RosPose) -> Pose:
    """geometry_msgs/Pose(Stamped) -> sandbox Pose."""
    p = msg.pose if isinstance(msg, PoseStamped) else msg
    if not isinstance(p, RosPose):
        raise TypeError("to_sandbox_pose() expects a geometry_msgs Pose or PoseStamped")
    roll, pitch, yaw = euler_from_quaternion(p.orientation)
    return Pose(p.position.x, p.position.y, p.position.z, roll=roll, pitch=-pitch, yaw=yaw)
