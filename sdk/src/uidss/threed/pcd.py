"""Binary PCD writer — converts vertex-only PLY point clouds for the web viewer.

The viewer parses PCD files client-side with three.js's ``PCDLoader``, which supports
``DATA binary`` with an ``rgb`` field read as raw bytes (blue at offset 0, green at 1,
red at 2 — PCL's packed little-endian ``0x00RRGGBB`` float). We write exactly that
layout: ``FIELDS x y z [rgb]``, four bytes each, one point per row.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import numpy.typing as npt

from uidss.threed.ply import read_ply_pointcloud


def write_binary_pcd(
    path: Path,
    positions: npt.NDArray[np.float32],
    rgb: npt.NDArray[np.uint8] | None = None,
) -> None:
    """Write *positions* (N, 3) and optional *rgb* (N, 3, uint8) as a binary PCL PCD."""
    if positions.ndim != 2 or positions.shape[1] != 3:
        raise ValueError(f"positions must be (N, 3), got {positions.shape}")
    if rgb is not None and rgb.shape != positions.shape:
        raise ValueError(f"rgb must match positions {positions.shape}, got {rgb.shape}")

    count = len(positions)
    fields: list[tuple[str, str]] = [("x", "<f4"), ("y", "<f4"), ("z", "<f4")]
    if rgb is not None:
        fields.append(("rgb", "<u4"))
    rows = np.zeros(count, dtype=np.dtype(fields))
    rows["x"], rows["y"], rows["z"] = (positions[:, i].astype(np.float32) for i in range(3))
    if rgb is not None:
        packed = (
            (rgb[:, 0].astype(np.uint32) << 16)
            | (rgb[:, 1].astype(np.uint32) << 8)
            | rgb[:, 2].astype(np.uint32)
        )
        rows["rgb"] = packed

    names = " ".join(name for name, _ in fields)
    ones = " ".join("1" for _ in fields)
    fours = " ".join("4" for _ in fields)
    types = " ".join("F" for _ in fields)
    header = (
        "# .PCD v0.7 - Point Cloud Data file format\n"
        "VERSION 0.7\n"
        f"FIELDS {names}\n"
        f"SIZE {fours}\n"
        f"TYPE {types}\n"
        f"COUNT {ones}\n"
        f"WIDTH {count}\n"
        "HEIGHT 1\n"
        "VIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {count}\n"
        "DATA binary\n"
    )
    path.write_bytes(header.encode("ascii") + rows.tobytes())


def convert_ply_pointcloud_to_pcd(ply_path: Path, pcd_path: Path) -> Path:
    """Convert a vertex-only PLY to a binary PCD, preserving per-vertex colours."""
    cloud = read_ply_pointcloud(ply_path)
    write_binary_pcd(pcd_path, cloud.positions, cloud.rgb)
    return pcd_path
