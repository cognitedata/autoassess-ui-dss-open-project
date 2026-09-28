"""Tests for CdfArtifactService."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from uidss.services.artifact_service import CdfArtifactService


def _make_client(file_id: int = 42) -> MagicMock:
    client = MagicMock()
    upload_result = MagicMock()
    upload_result.id = file_id
    client.files.upload.return_value = upload_result
    return client


class TestUploadPly:
    def test_returns_file_id(self, tmp_path: Path) -> None:
        ply = tmp_path / "mesh.ply"
        ply.write_bytes(b"ply data")
        client = _make_client(file_id=99)
        result = CdfArtifactService(client).upload_ply(ply, "area-001")
        assert result == 99

    def test_calls_files_upload_with_path(self, tmp_path: Path) -> None:
        ply = tmp_path / "mesh.ply"
        ply.write_bytes(b"ply data")
        client = _make_client()
        CdfArtifactService(client).upload_ply(ply, "area-001")
        client.files.upload.assert_called_once()
        args = client.files.upload.call_args
        assert args.args[0] == str(ply)

    def test_metadata_includes_area_and_file_type(self, tmp_path: Path) -> None:
        ply = tmp_path / "mesh.ply"
        ply.write_bytes(b"ply data")
        client = _make_client()
        CdfArtifactService(client).upload_ply(ply, "area-007")
        kwargs = client.files.upload.call_args.kwargs
        assert kwargs["metadata"]["area"] == "area-007"
        assert kwargs["metadata"]["fileType"] == "ply_mesh"

    def test_raises_when_upload_returns_no_id(self, tmp_path: Path) -> None:
        ply = tmp_path / "mesh.ply"
        ply.write_bytes(b"ply data")
        client = MagicMock()
        result_no_id = MagicMock()
        result_no_id.id = None
        client.files.upload.return_value = result_no_id
        with pytest.raises(RuntimeError, match="no id"):
            CdfArtifactService(client).upload_ply(ply, "area-001")


class TestUploadPcd:
    def test_returns_file_id(self, tmp_path: Path) -> None:
        pcd = tmp_path / "cloud.pcd"
        pcd.write_bytes(b"pcd data")
        client = _make_client(file_id=77)
        result = CdfArtifactService(client).upload_pcd(pcd, "area-001", "Pointcloud")
        assert result == 77

    def test_metadata_includes_label(self, tmp_path: Path) -> None:
        pcd = tmp_path / "labeled.pcd"
        pcd.write_bytes(b"pcd data")
        client = _make_client()
        CdfArtifactService(client).upload_pcd(pcd, "area-001", "Labeled cloud")
        kwargs = client.files.upload.call_args.kwargs
        assert kwargs["metadata"]["label"] == "Labeled cloud"
        assert kwargs["metadata"]["fileType"] == "pcd_pointcloud"
