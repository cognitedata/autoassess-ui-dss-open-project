"""Tests for CdfCampaignService."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from cognite.client.data_classes.data_modeling.instances import Properties

from uidss.cdf.data_model import INSPECTION_RESULT_VIEW, SPACE, view_key
from uidss.models import InspectionResult
from uidss.services.campaign_service import CdfCampaignService

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_node(external_id: str, props: dict) -> MagicMock:
    node = MagicMock()
    node.instance_type = "node"
    node.space = SPACE
    node.external_id = external_id
    node.properties = Properties.load({SPACE: {view_key(INSPECTION_RESULT_VIEW): props}})
    return node


def _make_client(list_nodes: list[MagicMock] | None = None) -> MagicMock:
    client = MagicMock()
    resp = MagicMock()
    resp.__iter__ = MagicMock(return_value=iter(list_nodes or []))
    client.data_modeling.instances.list.return_value = resp
    return client


# ---------------------------------------------------------------------------
# list()
# ---------------------------------------------------------------------------


class TestList:
    def test_returns_empty_when_no_nodes(self) -> None:
        assert CdfCampaignService(_make_client()).list(SPACE, "area-001") == []

    def test_maps_node_to_result(self) -> None:
        node = _make_node(
            "result-001",
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "campaignDate": "2026-05-07",
                "status": "InProgress",
                "cdfFileIds": [1, 2],
                "pcdFileIds": [3],
                "pcdFileLabels": ["Pointcloud"],
            },
        )
        results = CdfCampaignService(_make_client([node])).list(SPACE, "area-001")
        assert len(results) == 1
        r = results[0]
        assert r == InspectionResult(
            space=SPACE,
            external_id="result-001",
            area_external_id="area-001",
            campaign_date="2026-05-07",
            status="InProgress",
            cdf_file_ids=(1, 2),
            pcd_file_ids=(3,),
            pcd_file_labels=("Pointcloud",),
        )

    def test_skips_non_node_items(self) -> None:
        edge = MagicMock()
        edge.instance_type = "edge"
        assert CdfCampaignService(_make_client([edge])).list(SPACE, "area-001") == []

    def test_invalid_status_falls_back_to_in_progress(self) -> None:
        node = _make_node(
            "result-001",
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "campaignDate": "2026-05-07",
                "status": "Bogus",
            },
        )
        results = CdfCampaignService(_make_client([node])).list(SPACE, "area-001")
        assert results[0].status == "InProgress"

    def test_sorted_by_date_desc(self) -> None:
        nodes = [
            _make_node(
                "result-old",
                {
                    "area": {"space": SPACE, "externalId": "a"},
                    "campaignDate": "2025-01-01",
                    "status": "Complete",
                },
            ),
            _make_node(
                "result-new",
                {
                    "area": {"space": SPACE, "externalId": "a"},
                    "campaignDate": "2026-05-07",
                    "status": "Complete",
                },
            ),
        ]
        results = CdfCampaignService(_make_client(nodes)).list(SPACE, "a")
        assert results[0].external_id == "result-new"

    def test_filter_uses_area_direct_relation(self) -> None:
        client = _make_client()
        CdfCampaignService(client).list(SPACE, "area-007")
        kwargs = client.data_modeling.instances.list.call_args.kwargs
        assert kwargs["filter"]["equals"]["value"] == {"space": SPACE, "externalId": "area-007"}


# ---------------------------------------------------------------------------
# create()
# ---------------------------------------------------------------------------


class TestCreate:
    def test_returns_result_prefixed_external_id(self) -> None:
        client = _make_client()
        eid = CdfCampaignService(client).create("area-001", "2026-05-07")
        assert eid.startswith("result-")

    def test_unique_ids_on_successive_calls(self) -> None:
        client = _make_client()
        service = CdfCampaignService(client)
        ids = {service.create("area-001", "2026-05-07") for _ in range(5)}
        assert len(ids) == 5

    def test_upserts_node_with_correct_props(self) -> None:
        client = _make_client()
        eid = CdfCampaignService(client).create("area-001", "2026-05-07")
        client.data_modeling.instances.apply.assert_called_once()
        nodes = client.data_modeling.instances.apply.call_args.kwargs["nodes"]
        node = nodes[0]
        assert node.external_id == eid
        props = node.sources[0].properties
        assert props["campaignDate"] == "2026-05-07"
        assert props["status"] == "InProgress"
        assert props["area"] == {"space": SPACE, "externalId": "area-001"}
        assert props["cdfFileIds"] == []
        assert props["pcdFileIds"] == []
        assert props["pcdFileLabels"] == []


# ---------------------------------------------------------------------------
# update_file_ids()
# ---------------------------------------------------------------------------


class TestUpdateFileIds:
    def test_upserts_file_ids(self) -> None:
        client = _make_client()
        CdfCampaignService(client).update_file_ids(SPACE, "result-001", [10, 20], [30], ["Cloud"])
        nodes = client.data_modeling.instances.apply.call_args.kwargs["nodes"]
        props = nodes[0].sources[0].properties
        assert props["cdfFileIds"] == [10, 20]
        assert props["pcdFileIds"] == [30]
        assert props["pcdFileLabels"] == ["Cloud"]

    def test_overwrites_rather_than_appends(self) -> None:
        """update_file_ids is a plain upsert — the caller (cli/main.py) is

        responsible for passing the campaign's complete desired state, not
        just the current run's uploads.
        """
        client = _make_client()
        CdfCampaignService(client).update_file_ids(SPACE, "result-001", [10], [30], ["New"])
        nodes = client.data_modeling.instances.apply.call_args.kwargs["nodes"]
        props = nodes[0].sources[0].properties
        assert props["cdfFileIds"] == [10]
        assert props["pcdFileIds"] == [30]
        assert props["pcdFileLabels"] == ["New"]
        client.data_modeling.instances.retrieve.assert_not_called()


# ---------------------------------------------------------------------------
# complete()
# ---------------------------------------------------------------------------


class TestComplete:
    def test_upserts_complete_status(self) -> None:
        client = _make_client()
        CdfCampaignService(client).complete(SPACE, "result-001")
        nodes = client.data_modeling.instances.apply.call_args.kwargs["nodes"]
        props = nodes[0].sources[0].properties
        assert props["status"] == "Complete"


# ---------------------------------------------------------------------------
# get()
# ---------------------------------------------------------------------------


def _make_retrieve_client(node: MagicMock | None) -> MagicMock:
    client = MagicMock()
    retrieve_result = MagicMock()
    retrieve_result.nodes = [node] if node is not None else []
    client.data_modeling.instances.retrieve.return_value = retrieve_result
    return client


class TestGet:
    def test_returns_none_when_not_found(self) -> None:
        client = _make_retrieve_client(None)
        assert CdfCampaignService(client).get(SPACE, "result-missing") is None

    def test_returns_mapped_result_when_found(self) -> None:
        node = _make_node(
            "result-001",
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "campaignDate": "2026-05-07",
                "status": "Complete",
                "cdfFileIds": [1],
                "pcdFileIds": [2],
                "pcdFileLabels": ["Cloud"],
            },
        )
        client = _make_retrieve_client(node)
        result = CdfCampaignService(client).get(SPACE, "result-001")
        assert result == InspectionResult(
            space=SPACE,
            external_id="result-001",
            area_external_id="area-001",
            campaign_date="2026-05-07",
            status="Complete",
            cdf_file_ids=(1,),
            pcd_file_ids=(2,),
            pcd_file_labels=("Cloud",),
        )


# ---------------------------------------------------------------------------
# download_map()
# ---------------------------------------------------------------------------


class TestDownloadMap:
    def _make_campaign_node(self, ply_ids: list[int], pcd_ids: list[int]) -> MagicMock:
        return _make_node(
            "result-001",
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "campaignDate": "2026-05-07",
                "status": "Complete",
                "cdfFileIds": ply_ids,
                "pcdFileIds": pcd_ids,
                "pcdFileLabels": ["Cloud"] * len(pcd_ids),
            },
        )

    def test_raises_when_campaign_not_found(self, tmp_path: Path) -> None:
        client = _make_retrieve_client(None)
        with pytest.raises(ValueError, match="not found"):
            CdfCampaignService(client).download_map(SPACE, "result-missing", tmp_path)

    def _make_file_metadata(self, name: str) -> MagicMock:
        metadata = MagicMock()
        metadata.name = name
        return metadata

    def test_downloads_every_ply_and_pcd_file(self, tmp_path: Path) -> None:
        node = self._make_campaign_node(ply_ids=[1, 2], pcd_ids=[3])
        client = _make_retrieve_client(node)
        client.files.retrieve.side_effect = [
            self._make_file_metadata("mesh1.ply"),
            self._make_file_metadata("mesh2.ply"),
            self._make_file_metadata("cloud.pcd"),
        ]

        written = CdfCampaignService(client).download_map(SPACE, "result-001", tmp_path)

        assert [p.name for p in written] == ["mesh1.ply", "mesh2.ply", "cloud.pcd"]
        assert client.files.download_to_path.call_count == 3
        client.files.download_to_path.assert_any_call(tmp_path / "mesh1.ply", id=1)
        client.files.download_to_path.assert_any_call(tmp_path / "mesh2.ply", id=2)
        client.files.download_to_path.assert_any_call(tmp_path / "cloud.pcd", id=3)

    def test_creates_output_dir(self, tmp_path: Path) -> None:
        node = self._make_campaign_node(ply_ids=[], pcd_ids=[])
        client = _make_retrieve_client(node)
        out_dir = tmp_path / "nested" / "map"
        CdfCampaignService(client).download_map(SPACE, "result-001", out_dir)
        assert out_dir.exists()

    def test_skips_files_with_no_metadata(self, tmp_path: Path) -> None:
        node = self._make_campaign_node(ply_ids=[1], pcd_ids=[])
        client = _make_retrieve_client(node)
        client.files.retrieve.return_value = None

        written = CdfCampaignService(client).download_map(SPACE, "result-001", tmp_path)

        assert written == []
        client.files.download_to_path.assert_not_called()


# ---------------------------------------------------------------------------
# download_collision_proxy()
# ---------------------------------------------------------------------------


def _make_cad_model_node(tags: list[str]) -> MagicMock:
    node = MagicMock()
    node.instance_type = "node"
    node.space = SPACE
    node.external_id = "result-001-cad-model"
    node.properties = Properties.load({"cdf_cdm": {"CogniteCADModel/v1": {"tags": tags}}})
    return node


class TestDownloadCollisionProxy:
    def test_downloads_the_file_named_by_the_cad_model_tag(self, tmp_path: Path) -> None:
        node = _make_cad_model_node(["autoassess", "threeDModelId:5", "collisionProxyFileId:77"])
        client = _make_retrieve_client(node)

        path = CdfCampaignService(client).download_collision_proxy("result-001", tmp_path)

        assert path == tmp_path / "result-001-collision-proxy.ply"
        client.files.download_to_path.assert_called_once_with(path, id=77)
        [(space, external_id)] = client.data_modeling.instances.retrieve.call_args.kwargs["nodes"]
        assert (space, external_id) == (SPACE, "result-001-cad-model")

    def test_returns_none_when_the_tag_is_missing(self, tmp_path: Path) -> None:
        client = _make_retrieve_client(_make_cad_model_node(["autoassess", "threeDModelId:5"]))

        assert CdfCampaignService(client).download_collision_proxy("result-001", tmp_path) is None
        client.files.download_to_path.assert_not_called()

    def test_returns_none_when_the_tag_is_not_a_number(self, tmp_path: Path) -> None:
        client = _make_retrieve_client(_make_cad_model_node(["collisionProxyFileId:abc"]))

        assert CdfCampaignService(client).download_collision_proxy("result-001", tmp_path) is None

    def test_returns_none_when_the_model_node_is_missing(self, tmp_path: Path) -> None:
        client = _make_retrieve_client(None)

        assert CdfCampaignService(client).download_collision_proxy("result-001", tmp_path) is None
        client.files.download_to_path.assert_not_called()

    def test_writes_nothing_to_cdf(self, tmp_path: Path) -> None:
        client = _make_retrieve_client(_make_cad_model_node(["collisionProxyFileId:77"]))

        CdfCampaignService(client).download_collision_proxy("result-001", tmp_path)

        client.data_modeling.instances.apply.assert_not_called()
