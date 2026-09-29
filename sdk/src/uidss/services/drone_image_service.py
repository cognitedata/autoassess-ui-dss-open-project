"""Drone image service — upload and list drone images for a campaign."""

from __future__ import annotations

import math
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.instances import NodeApply, NodeOrEdgeData

from uidss.cdf.data_model import (
    DRONE_IMAGE_CONTAINER,
    DRONE_IMAGE_VIEW,
    SPACE,
    container_property,
    view_key,
)
from uidss.models import DroneImage
from uidss.services.cognite_file import CogniteFileSpec, upload_cognite_files

log = structlog.get_logger()

_CHUNK = 1000  # max nodes per apply call


# ---------------------------------------------------------------------------
# Sensor config (parsed from supereight2 YAML)
# ---------------------------------------------------------------------------


@dataclass
class SensorConfig:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    near_plane: float
    far_plane: float
    t_bs: list[float]  # row-major 4x4


def parse_sensor_yaml(yaml_path: Path) -> SensorConfig:
    """Parse sensor intrinsics and T_BS extrinsic from a supereight2 YAML file."""
    text = yaml_path.read_text()

    def scalar(key: str) -> float:
        m = re.search(rf"^\s*{key}:\s*([\d.e+\-]+)", text, re.MULTILINE)
        if not m:
            raise ValueError(f"Key '{key}' not found in {yaml_path}")
        return float(m.group(1))

    tbs_match = re.search(r"T_BS:\s*\[([\s\S]*?)\]", text)
    if not tbs_match:
        raise ValueError(f"T_BS not found in {yaml_path}")
    t_bs = [float(v) for v in re.split(r"[\s,]+", tbs_match.group(1).strip()) if v]
    if len(t_bs) != 16:
        raise ValueError(f"T_BS must have 16 values, got {len(t_bs)}")

    return SensorConfig(
        fx=scalar("fx"),
        fy=scalar("fy"),
        cx=scalar("cx"),
        cy=scalar("cy"),
        width=int(scalar("width")),
        height=int(scalar("height")),
        near_plane=scalar("near_plane"),
        far_plane=scalar("far_plane"),
        t_bs=t_bs,
    )


# ---------------------------------------------------------------------------
# Pose math (no numpy — plain Python)
# ---------------------------------------------------------------------------


def _mat4_mul(a: list[float], b: list[float]) -> list[float]:
    r = [0.0] * 16
    for i in range(4):
        for j in range(4):
            for k in range(4):
                r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]
    return r


def _pose_to_mat4(
    tx: float, ty: float, tz: float, qx: float, qy: float, qz: float, qw: float
) -> list[float]:
    x2 = qx + qx
    y2 = qy + qy
    z2 = qz + qz
    xx = qx * x2
    xy = qx * y2
    xz = qx * z2
    yy = qy * y2
    yz = qy * z2
    zz = qz * z2
    wx = qw * x2
    wy = qw * y2
    wz = qw * z2
    return [
        1 - (yy + zz),
        xy - wz,
        xz + wy,
        tx,
        xy + wz,
        1 - (xx + zz),
        yz - wx,
        ty,
        xz - wy,
        yz + wx,
        1 - (xx + yy),
        tz,
        0,
        0,
        0,
        1,
    ]


def _apply_t_bs(
    tx: float,
    ty: float,
    tz: float,
    qx: float,
    qy: float,
    qz: float,
    qw: float,
    t_bs: list[float],
) -> tuple[float, float, float, float, float, float, float]:
    """Compute T_WS = T_WB * T_BS and return (px, py, pz, qx, qy, qz, qw)."""
    t_wb = _pose_to_mat4(tx, ty, tz, qx, qy, qz, qw)
    t_ws = _mat4_mul(t_wb, t_bs)

    px, py, pz = t_ws[3], t_ws[7], t_ws[11]

    r00, r11, r22 = t_ws[0], t_ws[5], t_ws[10]
    trace = r00 + r11 + r22

    if trace > 0:
        s = 0.5 / math.sqrt(trace + 1)
        cqw = 0.25 / s
        cqx = (t_ws[9] - t_ws[6]) * s
        cqy = (t_ws[2] - t_ws[8]) * s
        cqz = (t_ws[4] - t_ws[1]) * s
    elif r00 > r11 and r00 > r22:
        s = 2 * math.sqrt(1 + r00 - r11 - r22)
        cqw = (t_ws[9] - t_ws[6]) / s
        cqx = 0.25 * s
        cqy = (t_ws[1] + t_ws[4]) / s
        cqz = (t_ws[2] + t_ws[8]) / s
    elif r11 > r22:
        s = 2 * math.sqrt(1 + r11 - r00 - r22)
        cqw = (t_ws[2] - t_ws[8]) / s
        cqx = (t_ws[1] + t_ws[4]) / s
        cqy = 0.25 * s
        cqz = (t_ws[9] + t_ws[6]) / s
    else:
        s = 2 * math.sqrt(1 + r22 - r00 - r11)
        cqw = (t_ws[4] - t_ws[1]) / s
        cqx = (t_ws[2] + t_ws[8]) / s
        cqy = (t_ws[9] + t_ws[6]) / s
        cqz = 0.25 * s

    return px, py, pz, cqx, cqy, cqz, cqw


# ---------------------------------------------------------------------------
# TUM format parsing
# ---------------------------------------------------------------------------


@dataclass
class _RgbEntry:
    timestamp: float
    filename: str


@dataclass
class _PoseEntry:
    timestamp: float
    tx: float
    ty: float
    tz: float
    qx: float
    qy: float
    qz: float
    qw: float


def _parse_rgb_txt(path: Path) -> list[_RgbEntry]:
    entries: list[_RgbEntry] = []
    for i, line in enumerate(path.read_text().splitlines()):
        if i < 3 or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            entries.append(_RgbEntry(float(parts[0]), parts[1]))
    return entries


def _parse_groundtruth(path: Path) -> list[_PoseEntry]:
    entries: list[_PoseEntry] = []
    for line in path.read_text().splitlines():
        if line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 8:
            entries.append(
                _PoseEntry(
                    float(parts[0]),
                    float(parts[1]),
                    float(parts[2]),
                    float(parts[3]),
                    float(parts[4]),
                    float(parts[5]),
                    float(parts[6]),
                    float(parts[7]),
                )
            )
    return entries


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _slerp(
    q1: tuple[float, float, float, float],
    q2: tuple[float, float, float, float],
    t: float,
) -> tuple[float, float, float, float]:
    x1, y1, z1, w1 = q1
    x2, y2, z2, w2 = q2
    dot = x1 * x2 + y1 * y2 + z1 * z2 + w1 * w2
    if dot < 0:
        x2, y2, z2, w2, dot = -x2, -y2, -z2, -w2, -dot
    if dot > 0.9995:
        x = _lerp(x1, x2, t)
        y = _lerp(y1, y2, t)
        z = _lerp(z1, z2, t)
        w = _lerp(w1, w2, t)
        n = math.sqrt(x * x + y * y + z * z + w * w)
        return x / n, y / n, z / n, w / n
    theta0 = math.acos(dot)
    theta = theta0 * t
    sin0 = math.sin(theta0)
    s1 = math.cos(theta) - dot * math.sin(theta) / sin0
    s2 = math.sin(theta) / sin0
    return (s1 * x1 + s2 * x2, s1 * y1 + s2 * y2, s1 * z1 + s2 * z2, s1 * w1 + s2 * w2)


def _interpolate_pose(poses: list[_PoseEntry], ts: float) -> _PoseEntry:
    if not poses:
        raise ValueError("Empty pose list")
    if ts <= poses[0].timestamp:
        return poses[0]
    if ts >= poses[-1].timestamp:
        return poses[-1]
    lo, hi = 0, len(poses) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if poses[mid].timestamp <= ts:
            lo = mid
        else:
            hi = mid
    p0, p1 = poses[lo], poses[hi]
    t = (ts - p0.timestamp) / (p1.timestamp - p0.timestamp)
    qx, qy, qz, qw = _slerp(
        (p0.qx, p0.qy, p0.qz, p0.qw),
        (p1.qx, p1.qy, p1.qz, p1.qw),
        t,
    )
    return _PoseEntry(
        ts,
        _lerp(p0.tx, p1.tx, t),
        _lerp(p0.ty, p1.ty, t),
        _lerp(p0.tz, p1.tz, t),
        qx,
        qy,
        qz,
        qw,
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class DroneImageServiceProtocol(Protocol):
    def upload(
        self, folder: Path, campaign_external_id: str, sensor_yaml: Path | None = None
    ) -> int: ...
    def list_for_campaign(self, campaign_external_id: str) -> list[DroneImage]: ...


@dataclass
class CdfDroneImageService:
    _client: CogniteClient

    def upload(
        self,
        folder: Path,
        campaign_external_id: str,
        sensor_yaml: Path | None = None,
    ) -> int:
        """Upload all images from *folder* as drone image DM nodes.

        folder must contain rgb.txt, groundtruth.txt, rgb/ subdirectory,
        and optionally a sensor YAML.  If sensor_yaml is None the service
        looks for <folder>/../<stem>_test.yaml or <folder>/sensor.yaml.
        """
        rgb_entries = _parse_rgb_txt(folder / "rgb.txt")
        poses = _parse_groundtruth(folder / "groundtruth.txt")

        yaml_path = _resolve_sensor_yaml(folder, sensor_yaml)
        sensor = parse_sensor_yaml(yaml_path)

        file_specs = [
            CogniteFileSpec(
                path=folder / "rgb" / Path(entry.filename).name,
                external_id=f"drone-image-file-{campaign_external_id}-frame-{i + 1}",
                mime_type="image/png",
                tags=["autoassess", "drone_image", f"campaign:{campaign_external_id}"],
            )
            for i, entry in enumerate(rgb_entries)
        ]
        file_ids = upload_cognite_files(self._client, file_specs)

        nodes: list[NodeApply] = []
        for i, (entry, cdf_file_id) in enumerate(zip(rgb_entries, file_ids, strict=True)):
            frame_id = i + 1

            imu = _interpolate_pose(poses, entry.timestamp)
            px, py, pz, cqx, cqy, cqz, cqw = _apply_t_bs(
                imu.tx,
                imu.ty,
                imu.tz,
                imu.qx,
                imu.qy,
                imu.qz,
                imu.qw,
                sensor.t_bs,
            )

            ext_id = f"drone-image-{campaign_external_id}-frame-{frame_id}"
            nodes.append(
                NodeApply(
                    space=SPACE,
                    external_id=ext_id,
                    sources=[
                        NodeOrEdgeData(
                            source=ViewId(*DRONE_IMAGE_VIEW),
                            properties={
                                "campaignExternalId": campaign_external_id,
                                "frameId": frame_id,
                                "timestamp": entry.timestamp,
                                "positionX": px,
                                "positionY": py,
                                "positionZ": pz,
                                "orientQx": cqx,
                                "orientQy": cqy,
                                "orientQz": cqz,
                                "orientQw": cqw,
                                "cdfFileId": cdf_file_id,
                                "bboxMinX": 0.0,
                                "bboxMinY": 0.0,
                                "bboxMinZ": 0.0,
                                "bboxMaxX": 0.0,
                                "bboxMaxY": 0.0,
                                "bboxMaxZ": 0.0,
                                "focalLengthX": sensor.fx,
                                "focalLengthY": sensor.fy,
                                "principalPointX": sensor.cx,
                                "principalPointY": sensor.cy,
                                "imageWidth": sensor.width,
                                "imageHeight": sensor.height,
                                "nearPlane": sensor.near_plane,
                                "farPlane": sensor.far_plane,
                            },
                        )
                    ],
                )
            )

        for chunk in _chunks(nodes, _CHUNK):
            self._client.data_modeling.instances.apply(nodes=chunk)

        log.info("uploaded drone images", campaign=campaign_external_id, count=len(nodes))
        return len(nodes)

    def list_for_campaign(self, campaign_external_id: str) -> list[DroneImage]:
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[ViewId(*DRONE_IMAGE_VIEW)],
            filter={
                "equals": {
                    "property": container_property(DRONE_IMAGE_CONTAINER, "campaignExternalId"),
                    "value": campaign_external_id,
                }
            },
            limit=1000,
        )
        return [_map_node(item) for item in response if item.instance_type == "node"]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_sensor_yaml(folder: Path, hint: Path | None) -> Path:
    if hint is not None:
        return hint
    for candidate in (folder / "sensor.yaml", folder.parent / f"{folder.name}_test.yaml"):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"No sensor YAML found for {folder}. "
        "Pass sensor_yaml= explicitly or place sensor.yaml inside the folder."
    )


def _chunks(items: list[NodeApply], size: int) -> Iterator[list[NodeApply]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _map_node(item: object) -> DroneImage:
    props = getattr(item, "properties", {}) or {}
    vp = props.get(SPACE, {}).get(view_key(DRONE_IMAGE_VIEW), {})

    def num(key: str, default: float = 0.0) -> float:
        v = vp.get(key)
        return float(v) if isinstance(v, (int, float)) else default

    return DroneImage(
        space=getattr(item, "space", SPACE),
        external_id=getattr(item, "external_id", ""),
        campaign_external_id=str(vp.get("campaignExternalId", "")),
        frame_id=int(num("frameId")),
        timestamp=num("timestamp"),
        position=(num("positionX"), num("positionY"), num("positionZ")),
        orientation_quat=(num("orientQx"), num("orientQy"), num("orientQz"), num("orientQw", 1.0)),
        cdf_file_id=int(num("cdfFileId")),
        bbox_min=(num("bboxMinX"), num("bboxMinY"), num("bboxMinZ")),
        bbox_max=(num("bboxMaxX"), num("bboxMaxY"), num("bboxMaxZ")),
        focal_length_x=num("focalLengthX", 390.598938),
        focal_length_y=num("focalLengthY", 390.598938),
        principal_point_x=num("principalPointX", 320.0),
        principal_point_y=num("principalPointY", 240.0),
        image_width=int(num("imageWidth", 640)),
        image_height=int(num("imageHeight", 480)),
        near_plane=num("nearPlane", 0.4),
        far_plane=num("farPlane", 35.0),
    )
