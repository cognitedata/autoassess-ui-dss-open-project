"""Tests for CdfDroneImageService."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from uidss.cdf.data_model import DRONE_IMAGE_VIEW, SPACE, view_key
from uidss.services.drone_image_service import (
    CdfDroneImageService,
    _apply_t_bs,
    _interpolate_pose,
    _parse_groundtruth,
    _parse_rgb_txt,
    _PoseEntry,
    parse_sensor_yaml,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "drone_images"
SENSOR_YAML = FIXTURES / "sensor.yaml"


# ---------------------------------------------------------------------------
# parse_sensor_yaml
# ---------------------------------------------------------------------------


class TestParseSensorYaml:
    def test_parses_intrinsics(self) -> None:
        cfg = parse_sensor_yaml(SENSOR_YAML)
        assert cfg.fx == pytest.approx(390.598938)
        assert cfg.fy == pytest.approx(390.598938)
        assert cfg.cx == pytest.approx(320.0)
        assert cfg.cy == pytest.approx(240.0)
        assert cfg.width == 640
        assert cfg.height == 480
        assert cfg.near_plane == pytest.approx(0.4)
        assert cfg.far_plane == pytest.approx(35.0)

    def test_parses_t_bs_length(self) -> None:
        cfg = parse_sensor_yaml(SENSOR_YAML)
        assert len(cfg.t_bs) == 16

    def test_t_bs_first_element(self) -> None:
        cfg = parse_sensor_yaml(SENSOR_YAML)
        # Row 0: [0, 0, 1, 0.1165]
        assert cfg.t_bs[0] == pytest.approx(0.0)
        assert cfg.t_bs[2] == pytest.approx(1.0)
        assert cfg.t_bs[3] == pytest.approx(0.1165)

    def test_missing_key_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.yaml"
        # All scalars present except fy — T_BS also present so parsing reaches fy
        p.write_text(
            "sensor:\n  fx: 100\n  cx: 0\n  cy: 0\n"
            "  width: 1\n  height: 1\n  near_plane: 0.1\n  far_plane: 1.0\n"
            "  T_BS: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]\n"
        )
        with pytest.raises(ValueError, match="fy"):
            parse_sensor_yaml(p)

    def test_wrong_t_bs_count_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.yaml"
        p.write_text(
            "sensor:\n  fx: 1\n  fy: 1\n  cx: 0\n  cy: 0\n"
            "  width: 1\n  height: 1\n  near_plane: 0.1\n  far_plane: 1.0\n"
            "  T_BS: [1, 0, 0]\n"
        )
        with pytest.raises(ValueError, match="16"):
            parse_sensor_yaml(p)


# ---------------------------------------------------------------------------
# _apply_t_bs — identity T_BS should yield input pose
# ---------------------------------------------------------------------------


class TestApplyTbs:
    def _identity_t_bs(self) -> list[float]:
        # fmt: off
        return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
        # fmt: on

    def test_identity_preserves_position(self) -> None:
        px, py, pz, *_ = _apply_t_bs(1, 2, 3, 0, 0, 0, 1, self._identity_t_bs())
        assert px == pytest.approx(1.0)
        assert py == pytest.approx(2.0)
        assert pz == pytest.approx(3.0)

    def test_identity_preserves_orientation(self) -> None:
        *_, qx, qy, qz, qw = _apply_t_bs(0, 0, 0, 0, 0, 0, 1, self._identity_t_bs())
        assert qx == pytest.approx(0.0, abs=1e-6)
        assert qy == pytest.approx(0.0, abs=1e-6)
        assert qz == pytest.approx(0.0, abs=1e-6)
        assert qw == pytest.approx(1.0, abs=1e-6)

    def test_ship_ch_t_bs_changes_pose(self) -> None:
        cfg = parse_sensor_yaml(SENSOR_YAML)
        px, py, pz, qx, qy, qz, qw = _apply_t_bs(0, 0, 0, 0, 0, 0, 1, cfg.t_bs)
        # T_BS translation offset from ship_CH (non-zero)
        assert not (px == pytest.approx(0) and py == pytest.approx(0) and pz == pytest.approx(0))

    def test_output_quaternion_is_unit(self) -> None:
        cfg = parse_sensor_yaml(SENSOR_YAML)
        # Use a proper unit quaternion as input
        n = math.sqrt(0.1**2 + 0.2**2 + 0.3**2 + 0.926**2)
        *_, qx, qy, qz, qw = _apply_t_bs(1, 2, 3, 0.1 / n, 0.2 / n, 0.3 / n, 0.926 / n, cfg.t_bs)
        norm = math.sqrt(qx**2 + qy**2 + qz**2 + qw**2)
        assert norm == pytest.approx(1.0, abs=1e-6)


# ---------------------------------------------------------------------------
# _parse_rgb_txt and _parse_groundtruth
# ---------------------------------------------------------------------------


class TestParsers:
    def test_rgb_count(self) -> None:
        entries = _parse_rgb_txt(FIXTURES / "rgb.txt")
        assert len(entries) == 3

    def test_rgb_timestamps(self) -> None:
        entries = _parse_rgb_txt(FIXTURES / "rgb.txt")
        assert entries[0].timestamp == pytest.approx(1000.0)
        assert entries[2].timestamp == pytest.approx(1000.2)

    def test_groundtruth_count(self) -> None:
        poses = _parse_groundtruth(FIXTURES / "groundtruth.txt")
        assert len(poses) == 5

    def test_groundtruth_first_pose(self) -> None:
        poses = _parse_groundtruth(FIXTURES / "groundtruth.txt")
        assert poses[0].tx == pytest.approx(1.0)
        assert poses[0].qw == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# _interpolate_pose
# ---------------------------------------------------------------------------


class TestInterpolatePose:
    def _make_poses(self) -> list[_PoseEntry]:
        return [
            _PoseEntry(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            _PoseEntry(1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        ]

    def test_clamps_before_start(self) -> None:
        poses = self._make_poses()
        p = _interpolate_pose(poses, -5.0)
        assert p.tx == pytest.approx(0.0)

    def test_clamps_after_end(self) -> None:
        poses = self._make_poses()
        p = _interpolate_pose(poses, 99.0)
        assert p.tx == pytest.approx(1.0)

    def test_midpoint_interpolation(self) -> None:
        poses = self._make_poses()
        p = _interpolate_pose(poses, 0.5)
        assert p.tx == pytest.approx(0.5, abs=1e-6)

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            _interpolate_pose([], 0.0)


# ---------------------------------------------------------------------------
# CdfDroneImageService.upload — node count and chunking
# ---------------------------------------------------------------------------


def _make_upload_client() -> tuple[CdfDroneImageService, Any]:
    mock_client: Any = MagicMock()
    mock_client.files.upload = MagicMock(return_value=MagicMock(id=42))
    mock_client.data_modeling = MagicMock()
    mock_client.data_modeling.instances.apply = MagicMock()
    return CdfDroneImageService(mock_client), mock_client


class TestUpload:
    def test_returns_image_count(self) -> None:
        svc, _ = _make_upload_client()
        count = svc.upload(FIXTURES, "result-test", sensor_yaml=SENSOR_YAML)
        assert count == 3

    def test_uploads_one_file_per_image(self) -> None:
        svc, mock_client = _make_upload_client()
        svc.upload(FIXTURES, "result-test", sensor_yaml=SENSOR_YAML)
        assert mock_client.files.upload.call_count == 3

    def test_calls_apply_once_for_small_dataset(self) -> None:
        svc, mock_client = _make_upload_client()
        svc.upload(FIXTURES, "result-test", sensor_yaml=SENSOR_YAML)
        assert mock_client.data_modeling.instances.apply.call_count == 1

    def test_pose_differs_from_imu_pose(self) -> None:
        """T_BS must be applied — camera pose should differ from raw IMU pose."""
        svc, mock_client = _make_upload_client()
        svc.upload(FIXTURES, "result-test", sensor_yaml=SENSOR_YAML)
        call = mock_client.data_modeling.instances.apply.call_args
        nodes = call.kwargs.get("nodes") or call.args[0]
        props = nodes[0].sources[0].properties
        # Verify positionX differs from the first groundtruth pose tx=1.1
        # (T_BS offsets it by 0.1165 in the body-frame forward direction)
        assert props["positionX"] != pytest.approx(1.1, abs=1e-3)

    def test_intrinsics_in_properties(self) -> None:
        svc, mock_client = _make_upload_client()
        svc.upload(FIXTURES, "result-test", sensor_yaml=SENSOR_YAML)
        call = mock_client.data_modeling.instances.apply.call_args
        nodes = call.kwargs.get("nodes") or call.args[0]
        props = nodes[0].sources[0].properties
        assert props["focalLengthX"] == pytest.approx(390.598938)
        assert props["imageWidth"] == 640
        assert props["nearPlane"] == pytest.approx(0.4)

    def test_chunking_large_datasets(self, tmp_path: Path) -> None:
        folder = tmp_path / "big"
        folder.mkdir()
        rgb_dir = folder / "rgb"
        rgb_dir.mkdir()

        lines = ["# header\n# line2\n# line3\n"]
        for i in range(1200):
            fname = f"frame_{i:04d}.png"
            (rgb_dir / fname).write_bytes(b"\x89PNG\r\n\x1a\n\x00")
            lines.append(f"{1000.0 + i * 0.1:.3f} rgb/{fname}\n")
        (folder / "rgb.txt").write_text("".join(lines))
        (folder / "groundtruth.txt").write_text("999.0 0 0 0 0 0 0 1\n1200.0 1 1 1 0 0 0 1\n")

        svc, mock_client = _make_upload_client()
        count = svc.upload(folder, "result-big", sensor_yaml=SENSOR_YAML)
        assert count == 1200
        assert mock_client.data_modeling.instances.apply.call_count == 2


# ---------------------------------------------------------------------------
# CdfDroneImageService.list_for_campaign — node mapping
# ---------------------------------------------------------------------------


def _make_list_node(external_id: str, vprops: dict) -> MagicMock:
    node = MagicMock()
    node.instance_type = "node"
    node.space = SPACE
    node.external_id = external_id
    node.properties = {SPACE: {view_key(DRONE_IMAGE_VIEW): vprops}}
    return node


def _make_list_client(nodes: list[MagicMock] | None = None) -> Any:
    client: Any = MagicMock()
    resp = MagicMock()
    resp.__iter__ = MagicMock(return_value=iter(nodes or []))
    client.data_modeling.instances.list.return_value = resp
    return client


class TestListForCampaign:
    def test_returns_empty_when_no_nodes(self) -> None:
        svc = CdfDroneImageService(_make_list_client())
        assert svc.list_for_campaign("result-test") == []

    def test_skips_non_node_items(self) -> None:
        edge = MagicMock()
        edge.instance_type = "edge"
        svc = CdfDroneImageService(_make_list_client([edge]))
        assert svc.list_for_campaign("result-test") == []

    def test_maps_node_to_drone_image(self) -> None:
        node = _make_list_node(
            "img-1",
            {
                "campaignExternalId": "result-x",
                "frameId": 1,
                "timestamp": 1000.0,
                "positionX": 1.0,
                "positionY": 2.0,
                "positionZ": 3.0,
                "orientQx": 0.0,
                "orientQy": 0.0,
                "orientQz": 0.0,
                "orientQw": 1.0,
                "cdfFileId": 42,
                "bboxMinX": 0.0,
                "bboxMinY": 0.0,
                "bboxMinZ": 0.0,
                "bboxMaxX": 1.0,
                "bboxMaxY": 1.0,
                "bboxMaxZ": 1.0,
                "focalLengthX": 390.598938,
                "focalLengthY": 390.598938,
                "principalPointX": 320.0,
                "principalPointY": 240.0,
                "imageWidth": 640,
                "imageHeight": 480,
                "nearPlane": 0.4,
                "farPlane": 35.0,
            },
        )
        svc = CdfDroneImageService(_make_list_client([node]))
        results = svc.list_for_campaign("result-x")
        assert len(results) == 1
        img = results[0]
        assert img.campaign_external_id == "result-x"
        assert img.frame_id == 1
        assert img.position == pytest.approx((1.0, 2.0, 3.0))
        assert img.focal_length_x == pytest.approx(390.598938)
        assert img.image_width == 640

    def test_filter_uses_campaign_external_id(self) -> None:
        client = _make_list_client()
        CdfDroneImageService(client).list_for_campaign("result-007")
        kwargs = client.data_modeling.instances.list.call_args.kwargs
        assert kwargs["filter"]["equals"]["value"] == "result-007"
