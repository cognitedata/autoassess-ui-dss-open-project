"""Tests for the PLY reader used by the 3D-model converter."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from uidss.threed.ply import is_point_cloud_ply, read_ply, read_ply_pointcloud


class TestReadAsciiPly:
    def test_reads_positions_and_faces(self, tmp_path: Path) -> None:
        path = _write_ascii(tmp_path, vertex_rgb=False, face_rgb=False)

        mesh = read_ply(path)

        np.testing.assert_allclose(mesh.positions, POSITIONS)
        np.testing.assert_array_equal(mesh.faces, FACES)
        assert mesh.vertex_rgb is None
        assert mesh.face_rgb is None

    def test_reads_face_colours(self, tmp_path: Path) -> None:
        path = _write_ascii(tmp_path, vertex_rgb=False, face_rgb=True)

        mesh = read_ply(path)

        assert mesh.face_rgb is not None
        np.testing.assert_array_equal(mesh.face_rgb, FACE_RGB)

    def test_reads_vertex_colours_and_ignores_extra_vertex_props(self, tmp_path: Path) -> None:
        path = _write_ascii(tmp_path, vertex_rgb=True, face_rgb=True, segment_id=True)

        mesh = read_ply(path)

        assert mesh.vertex_rgb is not None
        np.testing.assert_array_equal(mesh.vertex_rgb, VERTEX_RGB)
        np.testing.assert_allclose(mesh.positions, POSITIONS)

    def test_rejects_non_triangle_faces(self, tmp_path: Path) -> None:
        path = tmp_path / "quad.ply"
        path.write_text(
            "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\n"
            "property float z\nelement face 1\nproperty list uchar int vertex_index\nend_header\n"
            "0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n"
        )

        with pytest.raises(ValueError, match="triangle"):
            read_ply(path)


class TestReadBinaryPly:
    def test_matches_ascii_result(self, tmp_path: Path) -> None:
        ascii_mesh = read_ply(_write_ascii(tmp_path, vertex_rgb=True, face_rgb=True))
        binary_mesh = read_ply(_write_binary(tmp_path))

        np.testing.assert_allclose(binary_mesh.positions, ascii_mesh.positions)
        np.testing.assert_array_equal(binary_mesh.faces, ascii_mesh.faces)
        assert binary_mesh.vertex_rgb is not None and ascii_mesh.vertex_rgb is not None
        np.testing.assert_array_equal(binary_mesh.vertex_rgb, ascii_mesh.vertex_rgb)
        assert binary_mesh.face_rgb is not None and ascii_mesh.face_rgb is not None
        np.testing.assert_array_equal(binary_mesh.face_rgb, ascii_mesh.face_rgb)


class TestTruncated:
    def test_reports_a_truncated_ascii_vertex_block(self, tmp_path: Path) -> None:
        path = _write_ascii(tmp_path, vertex_rgb=False, face_rgb=False)
        text = path.read_text()
        path.write_text(text[: text.index("1 1 0")])  # cut inside the vertex block

        with pytest.raises(ValueError, match="truncated"):
            read_ply(path)

    def test_reports_a_truncated_ascii_face_block(self, tmp_path: Path) -> None:
        path = _write_ascii(tmp_path, vertex_rgb=False, face_rgb=False)
        text = path.read_text()
        path.write_text(text[: text.rindex("3 3 4 5")])

        with pytest.raises(ValueError, match="truncated"):
            read_ply(path)

    def test_reports_a_truncated_binary_file(self, tmp_path: Path) -> None:
        path = _write_binary(tmp_path)
        path.write_bytes(path.read_bytes()[:-5])

        with pytest.raises(ValueError, match="truncated"):
            read_ply(path)


class TestUnsupported:
    def test_rejects_big_endian(self, tmp_path: Path) -> None:
        path = tmp_path / "be.ply"
        path.write_bytes(b"ply\nformat binary_big_endian 1.0\nelement vertex 0\nend_header\n")

        with pytest.raises(ValueError, match="big_endian"):
            read_ply(path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

POSITIONS = np.array(
    [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [2, 0, 0], [2, 1, 0]], dtype=np.float32
)
FACES = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.int64)
FACE_RGB = np.array([[255, 0, 0], [0, 128, 255]], dtype=np.uint8)
VERTEX_RGB = np.array(
    [[10, 20, 30], [40, 50, 60], [70, 80, 90], [1, 2, 3], [4, 5, 6], [7, 8, 9]], dtype=np.uint8
)


def _write_ascii(
    tmp_path: Path, *, vertex_rgb: bool, face_rgb: bool, segment_id: bool = False
) -> Path:
    lines = ["ply", "format ascii 1.0", "comment test", f"element vertex {len(POSITIONS)}"]
    lines += ["property float x", "property float y", "property float z"]
    if vertex_rgb:
        lines += ["property uchar red", "property uchar green", "property uchar blue"]
    if segment_id:
        lines += ["property int segment_id"]
    lines += [f"element face {len(FACES)}", "property list uchar int vertex_index"]
    if face_rgb:
        lines += ["property uchar red", "property uchar green", "property uchar blue"]
    lines += ["end_header"]
    for i, p in enumerate(POSITIONS):
        row = [f"{p[0]:g}", f"{p[1]:g}", f"{p[2]:g}"]
        if vertex_rgb:
            row += [str(c) for c in VERTEX_RGB[i]]
        if segment_id:
            row += [str(i % 2)]
        lines.append(" ".join(row))
    for f, c in zip(FACES, FACE_RGB, strict=True):
        row = ["3", *[str(i) for i in f]]
        if face_rgb:
            row += [str(x) for x in c]
        lines.append(" ".join(row))
    path = tmp_path / "ascii.ply"
    path.write_text("\n".join(lines) + "\n")
    return path


def _write_binary(tmp_path: Path) -> Path:
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(POSITIONS)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        f"element face {len(FACES)}\n"
        "property list uchar int vertex_index\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        "end_header\n"
    ).encode()
    body = b"".join(
        struct.pack("<fffBBB", *p, *c) for p, c in zip(POSITIONS, VERTEX_RGB, strict=True)
    )
    body += b"".join(
        struct.pack("<BiiiBBB", 3, *f, *c) for f, c in zip(FACES, FACE_RGB, strict=True)
    )
    path = tmp_path / "binary.ply"
    path.write_bytes(header + body)
    return path


class TestIsPointCloudPly:
    def test_true_for_a_vertex_only_ply(self, tmp_path: Path) -> None:
        assert is_point_cloud_ply(_write_pointcloud_ascii(tmp_path, rgb=True))

    def test_true_for_a_face_element_with_zero_count(self, tmp_path: Path) -> None:
        path = tmp_path / "zero_faces.ply"
        path.write_text(
            "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\n"
            "property float z\nelement face 0\nproperty list uchar int vertex_index\n"
            "end_header\n0 0 0\n"
        )
        assert is_point_cloud_ply(path)

    def test_false_for_a_mesh_ply(self, tmp_path: Path) -> None:
        assert not is_point_cloud_ply(_write_ascii(tmp_path, vertex_rgb=False, face_rgb=False))

    def test_false_for_a_binary_mesh_ply(self, tmp_path: Path) -> None:
        assert not is_point_cloud_ply(_write_binary(tmp_path))

    def test_raises_for_a_non_ply_file(self, tmp_path: Path) -> None:
        path = tmp_path / "not_a.ply"
        path.write_bytes(b"")
        with pytest.raises(ValueError, match="not a PLY"):
            is_point_cloud_ply(path)


class TestReadPlyPointcloud:
    def test_reads_ascii_positions_and_colours(self, tmp_path: Path) -> None:
        cloud = read_ply_pointcloud(_write_pointcloud_ascii(tmp_path, rgb=True))

        np.testing.assert_allclose(cloud.positions, PC_POSITIONS)
        assert cloud.rgb is not None
        np.testing.assert_array_equal(cloud.rgb, PC_RGB)

    def test_reads_ascii_without_colours(self, tmp_path: Path) -> None:
        cloud = read_ply_pointcloud(_write_pointcloud_ascii(tmp_path, rgb=False))

        np.testing.assert_allclose(cloud.positions, PC_POSITIONS)
        assert cloud.rgb is None

    def test_reads_binary_positions_and_colours(self, tmp_path: Path) -> None:
        cloud = read_ply_pointcloud(_write_pointcloud_binary(tmp_path, rgb=True))

        np.testing.assert_allclose(cloud.positions, PC_POSITIONS)
        assert cloud.rgb is not None
        np.testing.assert_array_equal(cloud.rgb, PC_RGB)

    def test_reads_binary_without_colours(self, tmp_path: Path) -> None:
        cloud = read_ply_pointcloud(_write_pointcloud_binary(tmp_path, rgb=False))

        np.testing.assert_allclose(cloud.positions, PC_POSITIONS)
        assert cloud.rgb is None

    def test_reads_double_precision_positions(self, tmp_path: Path) -> None:
        path = tmp_path / "doubles.ply"
        header = (
            b"ply\nformat binary_little_endian 1.0\nelement vertex 2\n"
            b"property double x\nproperty double y\nproperty double z\nend_header\n"
        )
        body = struct.pack("<ddd", 0.5, 1.5, 2.5) + struct.pack("<ddd", -1.0, 0.0, 3.0)
        path.write_bytes(header + body)

        cloud = read_ply_pointcloud(path)

        np.testing.assert_allclose(cloud.positions, [[0.5, 1.5, 2.5], [-1.0, 0.0, 3.0]])

    def test_reports_a_truncated_ascii_vertex_block(self, tmp_path: Path) -> None:
        path = _write_pointcloud_ascii(tmp_path, rgb=False)
        text = path.read_text()
        path.write_text(text[: text.rindex("-1")])

        with pytest.raises(ValueError, match="truncated"):
            read_ply_pointcloud(path)

    def test_reports_a_truncated_binary_file(self, tmp_path: Path) -> None:
        path = _write_pointcloud_binary(tmp_path, rgb=True)
        path.write_bytes(path.read_bytes()[:-3])

        with pytest.raises(ValueError, match="truncated"):
            read_ply_pointcloud(path)

    def test_read_ply_still_rejects_a_vertex_only_ply(self, tmp_path: Path) -> None:
        # Regression: the mesh/CAD pipeline must never accept a point-cloud PLY.
        with pytest.raises(ValueError, match="face"):
            read_ply(_write_pointcloud_ascii(tmp_path, rgb=True))


PC_POSITIONS = np.array([[0, 0, 0], [1.5, 2.5, 3.5], [-1, 0.25, 4]], dtype=np.float32)
PC_RGB = np.array([[255, 0, 10], [0, 128, 255], [1, 2, 3]], dtype=np.uint8)


def _write_pointcloud_ascii(tmp_path: Path, *, rgb: bool) -> Path:
    lines = ["ply", "format ascii 1.0", "comment ut measurements"]
    lines += [f"element vertex {len(PC_POSITIONS)}"]
    lines += ["property float x", "property float y", "property float z"]
    if rgb:
        lines += ["property uchar red", "property uchar green", "property uchar blue"]
    lines += ["end_header"]
    for i, p in enumerate(PC_POSITIONS):
        row = [f"{p[0]:g}", f"{p[1]:g}", f"{p[2]:g}"]
        if rgb:
            row += [str(c) for c in PC_RGB[i]]
        lines.append(" ".join(row))
    path = tmp_path / "pointcloud_ascii.ply"
    path.write_text("\n".join(lines) + "\n")
    return path


def _write_pointcloud_binary(tmp_path: Path, *, rgb: bool) -> Path:
    props = "property float x\nproperty float y\nproperty float z\n"
    if rgb:
        props += "property uchar red\nproperty uchar green\nproperty uchar blue\n"
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(PC_POSITIONS)}\n{props}end_header\n"
    ).encode()
    if rgb:
        body = b"".join(
            struct.pack("<fffBBB", *p, *c) for p, c in zip(PC_POSITIONS, PC_RGB, strict=True)
        )
    else:
        body = b"".join(struct.pack("<fff", *p) for p in PC_POSITIONS)
    path = tmp_path / "pointcloud_binary.ply"
    path.write_bytes(header + body)
    return path
