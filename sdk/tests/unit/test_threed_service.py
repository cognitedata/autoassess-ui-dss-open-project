"""Tests for CdfThreeDService — CAD model creation from a campaign mesh."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from cognite.client.data_classes import ThreeDModelRevisionWrite
from cognite.client.data_classes.data_modeling import ContainerId, NodeApply, ViewId
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteCADModelApply, CogniteFileApply

from uidss.cdf.data_model import SPACE
from uidss.services.threed_service import CampaignCadModel, CdfThreeDService


class TestCreateCadModel:
    def test_uploads_zip_and_proxy_as_cognite_files(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path)

        files = [n for n in _applied(client) if isinstance(n, CogniteFileApply)]
        assert [f.external_id for f in files] == [
            "result-1-cad-source",
            "result-1-collision-proxy",
        ]
        assert files[0].mime_type == "application/zip"
        client.files.upload.assert_not_called()

    def test_creates_revision_from_zip_file_id(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path)

        model_id, revision = client.three_d.revisions.create.call_args.args
        assert model_id == 500
        assert isinstance(revision, ThreeDModelRevisionWrite)
        assert revision.file_id == 101  # the CAD source zip

    def test_writes_core_dm_model_node_with_ids_and_palette(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path)

        model = next(n for n in _applied(client) if isinstance(n, CogniteCADModelApply))
        assert model.space == SPACE
        assert model.external_id == "result-1-cad-model"
        assert model.model_type == "CAD"
        assert "threeDModelId:500" in (model.tags or [])
        assert "collisionProxyFileId:102" in (model.tags or [])
        assert "campaign:result-1" in (model.tags or [])
        assert json.loads(model.description or "{}") == {
            "palette": {"seg_ff0000": [255, 0, 0]},
            "hasTexture": False,
        }

    def test_writes_core_dm_revision_node_linked_to_model(self, tmp_path: Path) -> None:
        client = _make_client()

        _create(client, tmp_path)

        props = _revision_props(client)
        assert props["revisionId"] == 600
        assert props["type"] == "CAD"
        assert props["status"] == "Queued"
        assert props["model3D"] == {"space": SPACE, "externalId": "result-1-cad-model"}

    def test_revision_node_sets_cad_model_type_so_the_cad_revision_view_matches(
        self, tmp_path: Path
    ) -> None:
        # CogniteCADRevision's view filter requires cdf_cdm_3d:Cognite3DModel.type == "CAD"
        # on the revision node itself; without it the node is invisible through that view.
        client = _make_client()

        _create(client, tmp_path)

        node = _revision_node(client)
        container_data = [
            s.properties
            for s in node.sources
            if isinstance(s.source, ContainerId) and s.source.external_id == "Cognite3DModel"
        ]
        assert container_data == [{"type": "CAD"}]

    def test_returns_ids(self, tmp_path: Path) -> None:
        client = _make_client()

        result = _create(client, tmp_path)

        assert result == CampaignCadModel(
            campaign_external_id="result-1",
            model_id=500,
            revision_id=600,
            status="Queued",
            collision_proxy_file_id=102,
        )


class TestWaitUntilProcessed:
    def test_returns_done_and_updates_core_dm_status(self) -> None:
        client = _make_client(statuses=["Processing", "Done"])
        service = CdfThreeDService(client, sleep=lambda _s: None)

        status = service.wait_until_processed(_model(), timeout_s=60, poll_s=1)

        assert status == "Done"
        assert _revision_props(client)["status"] == "Done"

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create(client: Any, tmp_path: Path) -> CampaignCadModel:
    zip_path = tmp_path / "model.zip"
    zip_path.write_bytes(b"zip")
    proxy_path = tmp_path / "proxy.ply"
    proxy_path.write_bytes(b"ply")
    return CdfThreeDService(client).create_cad_model(
        campaign_external_id="result-1",
        zip_path=zip_path,
        proxy_path=proxy_path,
        palette={"seg_ff0000": (255, 0, 0)},
        has_texture=False,
    )


def _model() -> CampaignCadModel:
    return CampaignCadModel(
        campaign_external_id="result-1",
        model_id=500,
        revision_id=600,
        status="Queued",
        collision_proxy_file_id=102,
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


def _applied(client: Any) -> list[Any]:
    calls = client.data_modeling.instances.apply.call_args_list
    return [n for c in calls for n in c.kwargs["nodes"]]


def _revision_node(client: Any) -> NodeApply:
    nodes = [n for n in _applied(client) if n.external_id == "result-1-cad-revision"]
    return nodes[-1]


def _revision_props(client: Any) -> dict[str, Any]:
    node = _revision_node(client)
    view = ViewId("cdf_cdm", "CogniteCADRevision", "v1")
    return next(dict(s.properties) for s in node.sources if s.source == view)
