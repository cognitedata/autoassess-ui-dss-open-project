"""Tests for CdfArtifactService — PLY/PCD uploads as CogniteFiles."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from cognite.client.data_classes.data_modeling import NodeId, ViewId
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteFileApply

from uidss.cdf.data_model import SPACE
from uidss.models import MeshFile
from uidss.services.artifact_service import CdfArtifactService

_FILE_VIEW = ViewId("cdf_cdm", "CogniteFile", "v1")


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


class TestListMeshFiles:
    def test_lists_uploaded_ply_mesh_cognite_files_with_their_numeric_ids(self) -> None:
        client = _make_listing_client(
            [_file_node("f1", ["autoassess", "ply_mesh", "area:area-1"], created=5)],
            {"f1": 11},
        )

        files = CdfArtifactService(client).list_mesh_files()

        assert files == [MeshFile(11, "f1", "f1.ply", "area-1", 5)]
        kwargs = client.data_modeling.instances.list.call_args.kwargs
        assert kwargs["space"] == SPACE
        assert kwargs["limit"] == -1
        dumped = kwargs["filter"].dump()
        assert "ply_mesh" in str(dumped) and "isUploaded" in str(dumped)

    def test_filters_by_area_tag(self) -> None:
        client = _make_listing_client([], {})

        CdfArtifactService(client).list_mesh_files("area-7")

        assert "area:area-7" in str(
            client.data_modeling.instances.list.call_args.kwargs["filter"].dump()
        )

    def test_skips_files_cdf_has_no_numeric_id_for(self) -> None:
        client = _make_listing_client([_file_node("f1", ["ply_mesh"])], {})

        assert CdfArtifactService(client).list_mesh_files() == []

    def test_makes_no_files_request_when_nothing_is_listed(self) -> None:
        client = _make_listing_client([], {})

        assert CdfArtifactService(client).list_mesh_files() == []
        client.files.retrieve_multiple.assert_not_called()


class TestGetMeshFiles:
    def test_resolves_numeric_ids_to_mesh_files(self) -> None:
        client: Any = MagicMock()
        client.files.retrieve_multiple.return_value = [
            MagicMock(id=11, instance_id=NodeId(SPACE, "f1")),
        ]
        client.data_modeling.instances.retrieve.return_value = MagicMock(
            nodes=[_file_node("f1", ["ply_mesh", "area:area-1"], created=9)]
        )

        files = CdfArtifactService(client).get_mesh_files([11, 12])

        assert files == [MeshFile(11, "f1", "f1.ply", "area-1", 9)]

    def test_returns_nothing_for_classic_files(self) -> None:
        client: Any = MagicMock()
        client.files.retrieve_multiple.return_value = [MagicMock(id=11, instance_id=None)]

        assert CdfArtifactService(client).get_mesh_files([11]) == []
        client.data_modeling.instances.retrieve.assert_not_called()


class TestDownload:
    def test_downloads_by_numeric_id_into_a_file_named_after_the_mesh(self, tmp_path: Path) -> None:
        client: Any = MagicMock()

        path = CdfArtifactService(client).download(MeshFile(11, "f1", "mesh.ply"), tmp_path / "out")

        assert path == tmp_path / "out" / "11-mesh.ply"
        client.files.download_to_path.assert_called_once_with(path, id=11)


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


def _file_node(external_id: str, tags: list[str], created: int = 0) -> MagicMock:
    node = MagicMock()
    node.instance_type = "node"
    node.space = SPACE
    node.external_id = external_id
    node.created_time = created
    node.properties = {_FILE_VIEW: {"name": f"{external_id}.ply", "tags": tags}}
    return node


def _make_listing_client(nodes: list[MagicMock], numeric_ids: dict[str, int]) -> Any:
    client: Any = MagicMock()
    client.data_modeling.instances.list.return_value = nodes
    client.files.retrieve_multiple.return_value = [
        MagicMock(id=i, instance_id=NodeId(SPACE, x)) for x, i in numeric_ids.items()
    ]
    return client
