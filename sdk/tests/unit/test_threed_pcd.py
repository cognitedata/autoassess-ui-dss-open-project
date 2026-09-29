"""Tests for the binary PCD writer and the PLY-point-cloud-to-PCD conversion.

The web viewer parses PCD files client-side with three.js's PCDLoader; for
``DATA binary`` it reads the ``rgb`` field as raw bytes: blue at offset 0, green
at 1, red at 2 (a little-endian packed ``0x00RRGGBB``). The round-trip tests
below pin exactly that layout.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from uidss.threed.pcd import convert_ply_pointcloud_to_pcd, write_binary_pcd

POSITIONS = np.array([[0, 0, 0], [1.5, 2.5, 3.5], [-1, 0.25, 4]], dtype=np.float32)
RGB = np.array([[255, 0, 10], [0, 128, 255], [1, 2, 3]], dtype=np.uint8)


class TestWriteBinaryPcd:
    def test_header_declares_xyz_rgb_fields_and_binary_data(self, tmp_path: Path) -> None:
        path = tmp_path / "cloud.pcd"

        write_binary_pcd(path, POSITIONS, RGB)

        header = _header_lines(path)
        assert "FIELDS x y z rgb" in header
        assert "SIZE 4 4 4 4" in header
        assert "TYPE F F F F" in header
        assert "COUNT 1 1 1 1" in header
        assert f"WIDTH {len(POSITIONS)}" in header
        assert "HEIGHT 1" in header
        assert f"POINTS {len(POSITIONS)}" in header
        assert "DATA binary" in header

    def test_header_without_rgb_declares_only_xyz(self, tmp_path: Path) -> None:
        path = tmp_path / "cloud.pcd"

        write_binary_pcd(path, POSITIONS)

        header = _header_lines(path)
        assert "FIELDS x y z" in header
        assert "SIZE 4 4 4" in header
        assert "TYPE F F F" in header

    def test_positions_round_trip(self, tmp_path: Path) -> None:
        path = tmp_path / "cloud.pcd"

        write_binary_pcd(path, POSITIONS, RGB)

        rows = _read_body(path, with_rgb=True)
        xyz = np.stack([rows["x"], rows["y"], rows["z"]], axis=1)
        np.testing.assert_allclose(xyz, POSITIONS)

    def test_rgb_bytes_are_packed_bgr_little_endian(self, tmp_path: Path) -> None:
        path = tmp_path / "cloud.pcd"

        write_binary_pcd(path, POSITIONS, RGB)

        rows = _read_body(path, with_rgb=True)
        packed = rows["rgb"]  # little-endian uint32: byte 0 = blue, 1 = green, 2 = red
        np.testing.assert_array_equal((packed >> 16) & 0xFF, RGB[:, 0])
        np.testing.assert_array_equal((packed >> 8) & 0xFF, RGB[:, 1])
        np.testing.assert_array_equal(packed & 0xFF, RGB[:, 2])

    def test_positions_only_round_trip(self, tmp_path: Path) -> None:
        path = tmp_path / "cloud.pcd"

        write_binary_pcd(path, POSITIONS)

        rows = _read_body(path, with_rgb=False)
        xyz = np.stack([rows["x"], rows["y"], rows["z"]], axis=1)
        np.testing.assert_allclose(xyz, POSITIONS)

    def test_rejects_positions_with_wrong_shape(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match=r"\(N, 3\)"):
            write_binary_pcd(tmp_path / "bad.pcd", np.zeros((3, 2), dtype=np.float32))

    def test_rejects_rgb_that_does_not_match_positions(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="rgb"):
            write_binary_pcd(tmp_path / "bad.pcd", POSITIONS, RGB[:2])


class TestConvertPlyPointcloudToPcd:
    def test_converts_a_coloured_vertex_only_ply(self, tmp_path: Path) -> None:
        ply = _write_vertex_only_ply(tmp_path / "ut_measurements_colored.ply", rgb=True)
        out = tmp_path / "ut_measurements_colored.pcd"

        result = convert_ply_pointcloud_to_pcd(ply, out)

        assert result == out
        assert "FIELDS x y z rgb" in _header_lines(out)
        rows = _read_body(out, with_rgb=True)
        xyz = np.stack([rows["x"], rows["y"], rows["z"]], axis=1)
        np.testing.assert_allclose(xyz, POSITIONS)
        np.testing.assert_array_equal((rows["rgb"] >> 16) & 0xFF, RGB[:, 0])

    def test_converts_an_uncoloured_vertex_only_ply(self, tmp_path: Path) -> None:
        ply = _write_vertex_only_ply(tmp_path / "plain.ply", rgb=False)
        out = tmp_path / "plain.pcd"

        convert_ply_pointcloud_to_pcd(ply, out)

        assert "FIELDS x y z" in _header_lines(out)
        assert len(_read_body(out, with_rgb=False)) == len(POSITIONS)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _split(path: Path) -> tuple[str, bytes]:
    data = path.read_bytes()
    marker = data.index(b"DATA binary\n")
    body_start = marker + len(b"DATA binary\n")
    return data[:body_start].decode("ascii"), data[body_start:]


def _header_lines(path: Path) -> list[str]:
    header, _ = _split(path)
    return header.splitlines()


def _read_body(path: Path, *, with_rgb: bool) -> np.ndarray:
    _, body = _split(path)
    fields = [("x", "<f4"), ("y", "<f4"), ("z", "<f4")]
    if with_rgb:
        fields.append(("rgb", "<u4"))
    return np.frombuffer(body, dtype=np.dtype(fields))


def _write_vertex_only_ply(path: Path, *, rgb: bool) -> Path:
    lines = ["ply", "format ascii 1.0", f"element vertex {len(POSITIONS)}"]
    lines += ["property float x", "property float y", "property float z"]
    if rgb:
        lines += ["property uchar red", "property uchar green", "property uchar blue"]
    lines += ["end_header"]
    for i, p in enumerate(POSITIONS):
        row = [f"{p[0]:g}", f"{p[1]:g}", f"{p[2]:g}"]
        if rgb:
            row += [str(c) for c in RGB[i]]
        lines.append(" ".join(row))
    path.write_text("\n".join(lines) + "\n")
    return path
