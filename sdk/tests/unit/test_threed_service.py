"""Tests for CdfThreeDService — per-file CAD models and the legacy campaign-keyed lookup."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from cognite.client.data_classes import ThreeDModelRevisionWrite
from cognite.client.data_classes.data_modeling import ContainerId, NodeApply, ViewId
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteCADModelApply, CogniteFileApply
from hypothesis import given
from hypothesis import strategies as st

from uidss.cdf.data_model import SPACE
from uidss.models import MeshFile
from uidss.services.threed_service import (
    CadModel,
    CdfThreeDService,
    campaign_model_node_id,
    campaign_revision_node_id,
    covered_by_legacy,
    derived_id,
    file_model_node_id,
    file_revision_node_id,
)

_MODEL_VIEW = ViewId("cdf_cdm", "CogniteCADModel", "v1")
_REVISION_VIEW = ViewId("cdf_cdm", "CogniteCADRevision", "v1")
_SOURCE = MeshFile(
    file_id=42,
    external_id="area-1-file-abc-mesh.ply",
    name="mesh.ply",
    area_external_id="area-1",
)


class TestNodeIds:
    def test_per_file_ids_derive_from_the_mesh_files_external_id(self) -> None:
        assert (
            file_model_node_id("area-1-file-abc-mesh.ply") == "area-1-file-abc-mesh.ply-cad-model"
        )
        assert file_revision_node_id("x") == "x-cad-revision"

    def test_legacy_ids_derive_from_the_campaign(self) -> None:
        assert campaign_model_node_id("result-1") == "result-1-cad-model"
        assert campaign_revision_node_id("result-1") == "result-1-cad-revision"

    @given(st.text(alphabet="abc-_.0123456789", min_size=1, max_size=300))
    def test_derived_ids_never_exceed_the_cdf_limit_and_keep_the_suffix(self, base: str) -> None:
        for suffix in ("-cad-model", "-cad-revision", "-cad-source", "-collision-proxy"):
            result = derived_id(base, suffix)
            assert len(result) <= 255
            assert result.endswith(suffix)
            assert result.startswith(base[:100])


class TestCreateCadModelForFile:
    def test_uploads_zip_and_proxy_as_cognite_files_tagged_with_the_source(
        self, tmp_path: Path
    ) -> None:
        client = _make_client()

        _create(client, tmp_path)

        files = [n for n in _applied(client) if isinstance(n, CogniteFileApply)]
        assert [f.external_id for f in files] == [
            "area-1-file-abc-mesh.ply-cad-source",
            "area-1-file-abc-mesh.ply-collision-proxy",
        ]
        assert files[0].mime_type == "application/zip"
        assert files[0].tags == ["autoassess", "sourceFileId:42", "area:area-1", "cad_source"]
        assert files[1].tags == [
            "autoassess",
            "sourceFileId:42",
            "area:area-1",
            "collision_proxy",
        ]
        client.files.upload.assert_not_called()

    def test_derived_files_are_never_tagged_as_meshes(self, tmp_path: Path) -> None:
        # The worker builds a model for every ply_mesh file; a proxy tagged as one would loop.
        client = _make_client()

        _create(client, tmp_path)

        files = [n for n in _applied(client) if isinstance(n, CogniteFileApply)]
        assert all("ply_mesh" not in (f.tags or []) for f in files)

    def test_creates_revision_from_zip_file_id(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path)

        model_id, revision = client.three_d.revisions.create.call_args.args
        assert model_id == 500
        assert isinstance(revision, ThreeDModelRevisionWrite)
        assert revision.file_id == 101  # the CAD source zip

    def test_writes_core_dm_model_node_keyed_by_the_file(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path)

        model = next(n for n in _applied(client) if isinstance(n, CogniteCADModelApply))
        assert model.space == SPACE
        assert model.external_id == "area-1-file-abc-mesh.ply-cad-model"
        assert model.model_type == "CAD"
        assert model.tags == [
            "autoassess",
            "sourceFileId:42",
            "area:area-1",
            "threeDModelId:500",
            "collisionProxyFileId:102",
        ]
        assert json.loads(model.description or "{}") == {
            "palette": {"seg_ff0000": [255, 0, 0]},
            "hasTexture": False,
        }

    def test_description_carries_the_legend_when_segments_are_named(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path, legend={"ff0000": "manhole"})

        model = next(n for n in _applied(client) if isinstance(n, CogniteCADModelApply))
        assert json.loads(model.description or "{}") == {
            "palette": {"seg_ff0000": [255, 0, 0]},
            "hasTexture": False,
            "legend": {"ff0000": "manhole"},
        }

    def test_description_omits_the_legend_when_empty(self, tmp_path: Path) -> None:
        # Keeps the JSON identical to what older builds wrote (backward compatible).
        client = _make_client()

        _create(client, tmp_path, legend={})

        model = next(n for n in _applied(client) if isinstance(n, CogniteCADModelApply))
        assert "legend" not in json.loads(model.description or "{}")

    def test_omits_the_area_tag_when_the_file_has_no_area(self, tmp_path: Path) -> None:
        client = _make_client()
        source = MeshFile(file_id=42, external_id="f", name="mesh.ply")

        _create(client, tmp_path, source)

        model = next(n for n in _applied(client) if isinstance(n, CogniteCADModelApply))
        assert not any(t.startswith("area:") for t in model.tags or [])

    def test_writes_core_dm_revision_node_linked_to_the_model(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path)

        props = _revision_props(client, "area-1-file-abc-mesh.ply-cad-revision")
        assert props["revisionId"] == 600
        assert props["type"] == "CAD"
        assert props["status"] == "Queued"
        assert props["model3D"] == {
            "space": SPACE,
            "externalId": "area-1-file-abc-mesh.ply-cad-model",
        }

    def test_revision_node_sets_cad_model_type_so_the_cad_revision_view_matches(
        self, tmp_path: Path
    ) -> None:
        # CogniteCADRevision's view filter requires cdf_cdm_3d:Cognite3DModel.type == "CAD"
        # on the revision node itself; without it the node is invisible through that view.
        client = _make_client()

        _create(client, tmp_path)

        node = _revision_node(client, "area-1-file-abc-mesh.ply-cad-revision")
        container_data = [
            s.properties
            for s in node.sources
            if isinstance(s.source, ContainerId) and s.source.external_id == "Cognite3DModel"
        ]
        assert container_data == [{"type": "CAD"}]

    def test_returns_the_model(self, tmp_path: Path) -> None:
        client = _make_client()

        result = _create(client, tmp_path)

        assert result == CadModel(
            model_node_id="area-1-file-abc-mesh.ply-cad-model",
            revision_node_id="area-1-file-abc-mesh.ply-cad-revision",
            model_id=500,
            revision_id=600,
            status="Queued",
            collision_proxy_file_id=102,
            source_file_id=42,
        )


class TestFindModels:
    def test_finds_per_file_models_by_their_deterministic_ids(self) -> None:
        client = _make_lookup_client(
            [
                _model_node("f1-cad-model", ["threeDModelId:5", "collisionProxyFileId:7"]),
                _revision_node_data("f1-cad-revision", 6, "Done"),
            ]
        )

        found = CdfThreeDService(client).find_models_for_files(["f1", "f2"])

        assert found == {
            "f1": CadModel("f1-cad-model", "f1-cad-revision", 5, 6, "Done", 7, None),
        }
        requested = [
            n.external_id
            for c in client.data_modeling.instances.retrieve.call_args_list
            for n in c.kwargs["nodes"]
        ]
        assert set(requested) == {
            "f1-cad-model",
            "f2-cad-model",
            "f1-cad-revision",
            "f2-cad-revision",
        }

    def test_reads_the_source_file_id_tag(self) -> None:
        tags = ["sourceFileId:42", "threeDModelId:5", "collisionProxyFileId:7"]
        client = _make_lookup_client(
            [_model_node("f1-cad-model", tags), _revision_node_data("f1-cad-revision", 6, "Done")]
        )

        found = CdfThreeDService(client).find_model_for_file("f1")

        assert found is not None and found.source_file_id == 42

    def test_skips_models_without_a_revision_node(self) -> None:
        client = _make_lookup_client(
            [_model_node("f1-cad-model", ["threeDModelId:5", "collisionProxyFileId:7"])]
        )

        assert CdfThreeDService(client).find_model_for_file("f1") is None

    def test_skips_models_with_unparseable_tags(self) -> None:
        client = _make_lookup_client(
            [
                _model_node("f1-cad-model", ["threeDModelId:abc", "collisionProxyFileId:7"]),
                _revision_node_data("f1-cad-revision", 6, "Done"),
            ]
        )

        assert CdfThreeDService(client).find_models_for_files(["f1"]) == {}

    def test_reads_the_model_nodes_created_time(self) -> None:
        node = _model_node("f1-cad-model", ["threeDModelId:5", "collisionProxyFileId:7"])
        node.created_time = 1234
        client = _make_lookup_client([node, _revision_node_data("f1-cad-revision", 6, "Done")])

        found = CdfThreeDService(client).find_model_for_file("f1")

        assert found is not None and found.created_time == 1234

    def test_finds_legacy_campaign_models(self) -> None:
        client = _make_lookup_client(
            [
                _model_node("result-1-cad-model", ["threeDModelId:5", "collisionProxyFileId:7"]),
                _revision_node_data("result-1-cad-revision", 6, "Done"),
            ]
        )

        found = CdfThreeDService(client).find_campaign_models(["result-1"])

        assert found["result-1"].model_node_id == "result-1-cad-model"

    def test_makes_no_request_for_no_ids(self) -> None:
        client = _make_lookup_client([])

        assert CdfThreeDService(client).find_models_for_files([]) == {}
        client.data_modeling.instances.retrieve.assert_not_called()

    def test_retrieves_in_chunks_of_at_most_1000(self) -> None:
        client = _make_lookup_client([])

        CdfThreeDService(client).find_models_for_files([f"f{i}" for i in range(1500)])

        sizes = [
            len(c.kwargs["nodes"]) for c in client.data_modeling.instances.retrieve.call_args_list
        ]
        assert max(sizes) <= 1000 and sum(sizes) == 3000


class TestCoveredByLegacy:
    def test_a_mesh_uploaded_before_the_legacy_model_is_covered(self) -> None:
        assert covered_by_legacy(_mesh_at(100), _legacy_at(200))

    def test_a_mesh_uploaded_after_the_legacy_model_needs_its_own(self) -> None:
        assert not covered_by_legacy(_mesh_at(300), _legacy_at(200))

    def test_nothing_is_covered_without_a_legacy_model(self) -> None:
        assert not covered_by_legacy(_mesh_at(100), None)

    def test_a_mesh_with_an_unknown_upload_time_is_not_covered(self) -> None:
        assert not covered_by_legacy(_mesh_at(0), _legacy_at(200))


class TestWaitUntilProcessed:
    def test_returns_done_and_updates_core_dm_status(self) -> None:
        client = _make_client(statuses=["Processing", "Done"])
        service = CdfThreeDService(client, sleep=lambda _s: None)

        status = service.wait_until_processed(_model(), timeout_s=60, poll_s=1)

        assert status == "Done"
        assert _revision_props(client, "f1-cad-revision")["status"] == "Done"
        assert _revision_props(client, "f1-cad-revision")["model3D"]["externalId"] == "f1-cad-model"

    def test_raises_on_failed_processing(self) -> None:
        client = _make_client(statuses=["Failed"])
        service = CdfThreeDService(client, sleep=lambda _s: None)

        with pytest.raises(RuntimeError, match="Failed"):
            service.wait_until_processed(_model(), timeout_s=60, poll_s=1)

    def test_raises_on_timeout(self) -> None:
        client = _make_client(statuses=["Processing"] * 100)
        clock = iter(range(0, 1000, 10))
        service = CdfThreeDService(client, sleep=lambda _s: None, clock=lambda: next(clock))

        with pytest.raises(TimeoutError):
            service.wait_until_processed(_model(), timeout_s=30, poll_s=1)


class TestRefreshStatus:
    def test_writes_the_final_status_once_processing_finished(self) -> None:
        client = _make_client(statuses=["Done"])

        status = CdfThreeDService(client).refresh_status(_model())

        assert status == "Done"
        assert _revision_props(client, "f1-cad-revision")["status"] == "Done"

    def test_writes_nothing_while_still_processing(self) -> None:
        client = _make_client(statuses=["Processing"])

        status = CdfThreeDService(client).refresh_status(_model())

        assert status == "Processing"
        client.data_modeling.instances.apply.assert_not_called()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create(
    client: Any,
    tmp_path: Path,
    source: MeshFile = _SOURCE,
    legend: dict[str, str] | None = None,
) -> CadModel:
    zip_path = tmp_path / "model.zip"
    zip_path.write_bytes(b"zip")
    proxy_path = tmp_path / "proxy.ply"
    proxy_path.write_bytes(b"ply")
    return CdfThreeDService(client).create_cad_model_for_file(
        source=source,
        zip_path=zip_path,
        proxy_path=proxy_path,
        palette={"seg_ff0000": (255, 0, 0)},
        has_texture=False,
        legend=legend,
    )


def _model() -> CadModel:
    return CadModel(
        model_node_id="f1-cad-model",
        revision_node_id="f1-cad-revision",
        model_id=500,
        revision_id=600,
        status="Queued",
        collision_proxy_file_id=102,
        source_file_id=42,
    )


def _make_client(statuses: list[str] | None = None) -> Any:
    client: Any = MagicMock()
    ids = iter([101, 102])
    client.files.upload_content.side_effect = lambda *_a, **_k: MagicMock(id=next(ids))
    client.three_d.models.create.return_value = MagicMock(id=500)
    client.three_d.revisions.create.return_value = MagicMock(id=600, status="Queued")
    polled = iter(statuses or ["Done"])
    client.three_d.revisions.retrieve.side_effect = lambda *_a, **_k: MagicMock(status=next(polled))
    return client


def _make_lookup_client(nodes: list[MagicMock]) -> Any:
    """instances.retrieve returns the given nodes that were asked for."""
    client: Any = MagicMock()
    by_id = {n.external_id: n for n in nodes}

    def retrieve(**kwargs: Any) -> MagicMock:
        wanted = [by_id[n.external_id] for n in kwargs["nodes"] if n.external_id in by_id]
        return MagicMock(nodes=wanted)

    client.data_modeling.instances.retrieve.side_effect = retrieve
    return client


def _mesh_at(created_time: int) -> MeshFile:
    return MeshFile(file_id=1, external_id="f1", name="m.ply", created_time=created_time)


def _legacy_at(created_time: int) -> CadModel:
    return CadModel("r-cad-model", "r-cad-revision", 1, 2, "Done", 3, None, created_time)


def _model_node(external_id: str, tags: list[str]) -> MagicMock:
    node = MagicMock()
    node.external_id = external_id
    node.created_time = 0
    node.properties = {_MODEL_VIEW: {"tags": tags, "description": "{}"}}
    return node


def _revision_node_data(external_id: str, revision_id: int, status: str) -> MagicMock:
    node = MagicMock()
    node.external_id = external_id
    node.created_time = 0
    node.properties = {_REVISION_VIEW: {"revisionId": revision_id, "status": status}}
    return node


def _applied(client: Any) -> list[Any]:
    calls = client.data_modeling.instances.apply.call_args_list
    return [n for c in calls for n in c.kwargs["nodes"]]


def _revision_node(client: Any, external_id: str) -> NodeApply:
    nodes = [n for n in _applied(client) if n.external_id == external_id]
    return nodes[-1]


def _revision_props(client: Any, external_id: str) -> dict[str, Any]:
    node = _revision_node(client, external_id)
    return next(dict(s.properties) for s in node.sources if s.source == _REVISION_VIEW)
