"""Tests for the CogniteFile (data-modeling file) upload helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from cognite.client.data_classes.data_modeling import NodeId
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteFileApply

from uidss.cdf.data_model import SPACE
from uidss.services.cognite_file import (
    CogniteFileSpec,
    file_external_ids,
    make_file_external_id,
    upload_cognite_file,
    upload_cognite_files,
)


class TestUploadCogniteFile:
    def test_applies_cognite_file_node_with_name_mime_and_tags(self, tmp_path: Path) -> None:
        path = _write(tmp_path / "mesh.ply")
        client = _make_client()

        upload_cognite_file(client, path, "xid-1", "application/octet-stream", ["autoassess"])

        nodes = _applied_nodes(client)
        assert len(nodes) == 1
        node = nodes[0]
        assert isinstance(node, CogniteFileApply)
        assert node.space == SPACE
        assert node.external_id == "xid-1"
        assert node.name == "mesh.ply"
        assert node.mime_type == "application/octet-stream"
        assert node.tags == ["autoassess"]

    def test_uploads_content_by_instance_id(self, tmp_path: Path) -> None:
        path = _write(tmp_path / "mesh.ply")
        client = _make_client()

        upload_cognite_file(client, path, "xid-1", "application/octet-stream", [])

        client.files.upload_content.assert_called_once_with(
            str(path), instance_id=NodeId(SPACE, "xid-1")
        )

    def test_returns_numeric_file_id_from_upload(self, tmp_path: Path) -> None:
        path = _write(tmp_path / "mesh.ply")
        client = _make_client({"xid-1": 1234})

        assert upload_cognite_file(client, path, "xid-1", "text/plain", []) == 1234

    def test_never_uses_classic_files_upload(self, tmp_path: Path) -> None:
        path = _write(tmp_path / "mesh.ply")
        client = _make_client()

        upload_cognite_file(client, path, "xid-1", "text/plain", [])

        client.files.upload.assert_not_called()

    def test_raises_when_upload_returns_no_id(self, tmp_path: Path) -> None:
        path = _write(tmp_path / "mesh.ply")
        client = _make_client({"xid-1": None})

        with pytest.raises(RuntimeError, match="no file id"):
            upload_cognite_file(client, path, "xid-1", "text/plain", [])


class TestUploadCogniteFiles:
    def test_returns_ids_in_input_order(self, tmp_path: Path) -> None:
        specs = [
            CogniteFileSpec(_write(tmp_path / f"f{i}.png"), f"xid-{i}", "image/png", [])
            for i in range(3)
        ]
        client = _make_client({"xid-0": 10, "xid-1": 11, "xid-2": 12})

        assert upload_cognite_files(client, specs) == [10, 11, 12]

    def test_applies_nodes_in_chunks_of_1000(self, tmp_path: Path) -> None:
        path = _write(tmp_path / "f.png")
        specs = [CogniteFileSpec(path, f"xid-{i}", "image/png", []) for i in range(1200)]
        client = _make_client()

        upload_cognite_files(client, specs)

        calls = client.data_modeling.instances.apply.call_args_list
        assert [len(c.kwargs["nodes"]) for c in calls] == [1000, 200]

    def test_uploads_one_content_per_file(self, tmp_path: Path) -> None:
        specs = [
            CogniteFileSpec(_write(tmp_path / f"f{i}.png"), f"xid-{i}", "image/png", [])
            for i in range(3)
        ]
        client = _make_client()

        upload_cognite_files(client, specs)

        assert client.files.upload_content.call_count == 3

    def test_empty_input_makes_no_calls(self) -> None:
        client = _make_client()

        assert upload_cognite_files(client, []) == []
        client.data_modeling.instances.apply.assert_not_called()
        client.files.upload_content.assert_not_called()


class TestMakeFileExternalId:
    def test_includes_prefix_and_sanitised_name(self) -> None:
        xid = make_file_external_id("area-1", Path("my mesh (v2).ply"))
        assert xid.startswith("area-1-file-")
        assert xid.endswith("-my_mesh__v2_.ply")

    def test_is_unique_per_call(self) -> None:
        a = make_file_external_id("area-1", Path("m.ply"))
        b = make_file_external_id("area-1", Path("m.ply"))
        assert a != b

    def test_fits_cdf_external_id_limit(self) -> None:
        xid = make_file_external_id("a" * 200, Path("b" * 300 + ".ply"))
        assert len(xid) <= 255


class TestFileExternalIds:
    def test_maps_numeric_ids_to_cognite_file_external_ids_in_order(self) -> None:
        client: Any = MagicMock()
        client.files.retrieve_multiple.return_value = [
            MagicMock(id=2, instance_id=NodeId(SPACE, "f2")),
            MagicMock(id=1, instance_id=NodeId(SPACE, "f1")),
        ]

        assert list(file_external_ids(client, [1, 2]).items()) == [(1, "f1"), (2, "f2")]
        kwargs = client.files.retrieve_multiple.call_args.kwargs
        assert kwargs == {"ids": [1, 2], "ignore_unknown_ids": True}

    def test_leaves_out_classic_files_without_an_instance_id(self) -> None:
        client: Any = MagicMock()
        client.files.retrieve_multiple.return_value = [MagicMock(id=1, instance_id=None)]

        assert file_external_ids(client, [1]) == {}

    def test_retrieves_in_chunks_of_1000_without_duplicates(self) -> None:
        client: Any = MagicMock()
        client.files.retrieve_multiple.return_value = []

        file_external_ids(client, [*range(1500), 0, 1])

        sizes = [len(c.kwargs["ids"]) for c in client.files.retrieve_multiple.call_args_list]
        assert sizes == [1000, 500]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write(path: Path) -> Path:
    path.write_bytes(b"data")
    return path


def _make_client(ids: dict[str, int | None] | None = None) -> Any:
    """Mock client whose files.upload_content returns metadata with an id from *ids*.

    Default: every upload returns id 42.
    """
    client: Any = MagicMock()

    def upload_content(path: str, instance_id: NodeId) -> MagicMock:
        file_id = 42 if ids is None else ids.get(instance_id.external_id)
        return MagicMock(id=file_id, instance_id=instance_id)

    client.files.upload_content.side_effect = upload_content
    return client


def _applied_nodes(client: Any) -> list[Any]:
    calls = client.data_modeling.instances.apply.call_args_list
    return [node for call in calls for node in call.kwargs["nodes"]]
