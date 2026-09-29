"""Tests for VesselService and AreaService."""

from __future__ import annotations

from unittest.mock import MagicMock

from cognite.client.data_classes.data_modeling.instances import Properties

from uidss.cdf.data_model import AREA_VIEW, SPACE, VESSEL_VIEW, view_key
from uidss.models import Area, Vessel
from uidss.services.area_service import CdfAreaService
from uidss.services.vessel_service import CdfVesselService

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_node(space: str, external_id: str, view: tuple[str, str, str], props: dict) -> MagicMock:
    node = MagicMock()
    node.instance_type = "node"
    node.space = space
    node.external_id = external_id
    node.properties = Properties.load({space: {view_key(view): props}})
    return node


def _make_client(nodes: list[MagicMock]) -> MagicMock:
    client = MagicMock()
    response = MagicMock()
    response.__iter__ = MagicMock(return_value=iter(nodes))
    client.data_modeling.instances.list.return_value = response
    return client


# ---------------------------------------------------------------------------
# VesselService
# ---------------------------------------------------------------------------


class TestCdfVesselService:
    def test_returns_empty_list_when_no_nodes(self) -> None:
        client = _make_client([])
        service = CdfVesselService(client)
        assert service.list() == []

    def test_maps_node_to_vessel(self) -> None:
        node = _make_node(
            SPACE,
            "vessel-001",
            VESSEL_VIEW,
            {"name": "MV Testship", "vesselType": "bulk_carrier"},
        )
        service = CdfVesselService(_make_client([node]))
        vessels = service.list()
        assert len(vessels) == 1
        assert vessels[0] == Vessel(
            space=SPACE,
            external_id="vessel-001",
            name="MV Testship",
            vessel_type="bulk_carrier",
        )

    def test_skips_non_node_items(self) -> None:
        edge = MagicMock()
        edge.instance_type = "edge"
        service = CdfVesselService(_make_client([edge]))
        assert service.list() == []

    def test_applies_deleted_at_filter(self) -> None:
        client = _make_client([])
        CdfVesselService(client).list()
        call_kwargs = client.data_modeling.instances.list.call_args.kwargs
        assert "filter" in call_kwargs
        assert "not" in call_kwargs["filter"]


# ---------------------------------------------------------------------------
# AreaService
# ---------------------------------------------------------------------------


class TestCdfAreaService:
    def test_returns_empty_list_when_no_nodes(self) -> None:
        service = CdfAreaService(_make_client([]))
        assert service.list(SPACE, "vessel-001") == []

    def test_maps_node_to_area(self) -> None:
        node = _make_node(
            SPACE,
            "area-001",
            AREA_VIEW,
            {
                "name": "BWT Port Side",
                "areaType": "ballast_water_tank",
                "vessel": {"space": SPACE, "externalId": "vessel-001"},
            },
        )
        service = CdfAreaService(_make_client([node]))
        areas = service.list(SPACE, "vessel-001")
        assert len(areas) == 1
        assert areas[0] == Area(
            space=SPACE,
            external_id="area-001",
            name="BWT Port Side",
            area_type="ballast_water_tank",
            vessel_external_id="vessel-001",
        )

    def test_filters_by_vessel(self) -> None:
        client = _make_client([])
        CdfAreaService(client).list(SPACE, "vessel-007")
        call_kwargs = client.data_modeling.instances.list.call_args.kwargs
        filt = call_kwargs["filter"]
        # The filter should contain an equals clause for the vessel property
        and_clauses = filt.get("and", [])
        vessel_clause = next((c for c in and_clauses if "equals" in c), None)
        assert vessel_clause is not None
        assert vessel_clause["equals"]["value"]["externalId"] == "vessel-007"
