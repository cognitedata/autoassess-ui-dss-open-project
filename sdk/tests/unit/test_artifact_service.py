"""Tests for CdfArtifactService — PLY/PCD uploads as CogniteFiles."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteFileApply

from uidss.cdf.data_model import SPACE
from uidss.services.artifact_service import CdfArtifactService


class TestUploadPly:
    def test_returns_file_id(self, tmp_path: Path) -> None:
        ply = _write(tmp_path / "mesh.ply")
        client = _make_client(file_id=99)
        result = CdfArtifactService(client).upload_ply(ply, "area-001")
        assert result == 99

    def test_creates_cognite_file_node_in_autoassess_space(self, tmp_path: Path) -> None:
        ply = _write(tmp_path / "mesh.ply")
        client = _make_client()
        CdfArtifactService(client).upload_ply(ply, "area-001")
        node = _applied_file_node(client)
        assert node.space == SPACE
        assert node.name == "mesh.ply"
        assert node.external_id.startswith("area-001-file-")
        assert node.external_id.endswith("-mesh.ply")

    def test_tags_include_area_and_file_type(self, tmp_path: Path) -> None:
        ply = _write(tmp_path / "mesh.ply")
        client = _make_client()
        CdfArtifactService(client).upload_ply(ply, "area-007")
        assert _applied_file_node(client).tags == ["autoassess", "ply_mesh", "area:area-007"]

    def test_uploads_content_for_the_created_node(self, tmp_path: Path) -> None:
        ply = _write(tmp_path / "mesh.ply")
        client = _make_client()
        CdfArtifactService(client).upload_ply(ply, "area-001")
        call = client.files.upload_content.call_args
        assert call.args[0] == str(ply)
        assert call.kwargs["instance_id"].external_id == _applied_file_node(client).external_id

    def test_never_uses_classic_files_upload(self, tmp_path: Path) -> None:
        ply = _write(tmp_path / "mesh.ply")
        client = _make_client()
        CdfArtifactService(client).upload_ply(ply, "area-001")
        client.files.upload.assert_not_called()

    def test_raises_when_upload_returns_no_id(self, tmp_path: Path) -> None:
        ply = _write(tmp_path / "mesh.ply")
        client = _make_client(file_id=None)
        with pytest.raises(RuntimeError, match="no file id"):
            CdfArtifactService(client).upload_ply(ply, "area-001")


class TestUploadPcd:
    def test_returns_file_id(self, tmp_path: Path) -> None:
        pcd = _write(tmp_path / "cloud.pcd")
        client = _make_client(file_id=77)
        result = CdfArtifactService(client).upload_pcd(pcd, "area-001", "Pointcloud")
        assert result == 77

    def test_tags_include_label_and_file_type(self, tmp_path: Path) -> None:
        pcd = _write(tmp_path / "labeled.pcd")
        client = _make_client()
        CdfArtifactService(client).upload_pcd(pcd, "area-001", "Labeled cloud")
        assert _applied_file_node(client).tags == [
            "autoassess",
            "pcd_pointcloud",
            "area:area-001",
            "label:Labeled cloud",
        ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write(path: Path) -> Path:
    path.write_bytes(b"data")
    return path


def _make_client(file_id: int | None = 42) -> Any:
    client: Any = MagicMock()
    client.files.upload_content.return_value = MagicMock(id=file_id)
    return client


def _applied_file_node(client: Any) -> CogniteFileApply:
    nodes = client.data_modeling.instances.apply.call_args.kwargs["nodes"]
    assert len(nodes) == 1
    node = nodes[0]
    assert isinstance(node, CogniteFileApply)
    return node
