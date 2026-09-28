"""Tests for CdfPlanService."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from cognite.client.data_classes.data_modeling.instances import Properties

from uidss.cdf.data_model import (
    INSPECTION_PLAN_CONTAINER,
    INSPECTION_PLAN_VIEW,
    INSPECTION_TASK_VIEW,
    SPACE,
    STRUCTURAL_ELEMENT_VIEW,
    container_property,
    view_key,
)
from uidss.models import ElementTarget, InspectionPlan, InspectionTask
from uidss.services.plan_service import CdfPlanService, _build_plan_json, _task_to_dict

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_node(
    space: str, external_id: str, view: tuple[str, str, str], props: dict, created_time: int = 0
) -> MagicMock:
    node = MagicMock()
    node.instance_type = "node"
    node.space = space
    node.external_id = external_id
    node.created_time = created_time
    node.properties = Properties.load({space: {view_key(view): props}})
    return node


def _make_list_response(nodes: list[MagicMock]) -> MagicMock:
    resp = MagicMock()
    resp.__iter__ = MagicMock(return_value=iter(nodes))
    return resp


def _make_client(list_nodes: list[MagicMock] | None = None) -> MagicMock:
    client = MagicMock()
    client.data_modeling.instances.list.return_value = _make_list_response(list_nodes or [])
    return client


# ---------------------------------------------------------------------------
# list()
# ---------------------------------------------------------------------------


class TestList:
    def test_returns_empty_when_no_nodes(self) -> None:
        service = CdfPlanService(_make_client([]))
        assert service.list(SPACE, "area-001") == []

    def test_maps_node_to_plan(self) -> None:
        node = _make_node(
            SPACE,
            "plan-001",
            INSPECTION_PLAN_VIEW,
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "status": "Ready",
            },
            created_time=1000,
        )
        service = CdfPlanService(_make_client([node]))
        plans = service.list(SPACE, "area-001")
        assert len(plans) == 1
        assert plans[0] == InspectionPlan(
            space=SPACE,
            external_id="plan-001",
            area_external_id="area-001",
            status="Ready",
            created_time=1000,
        )

    def test_maps_name_and_description_when_present(self) -> None:
        node = _make_node(
            SPACE,
            "plan-001",
            INSPECTION_PLAN_VIEW,
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "status": "Ready",
                "name": "Q3 hull survey",
                "description": "Focus on aft hull",
            },
        )
        service = CdfPlanService(_make_client([node]))
        plans = service.list(SPACE, "area-001")
        assert plans[0].name == "Q3 hull survey"
        assert plans[0].description == "Focus on aft hull"

    def test_defaults_name_and_description_to_none_when_absent(self) -> None:
        node = _make_node(
            SPACE,
            "plan-001",
            INSPECTION_PLAN_VIEW,
            {"area": {"space": SPACE, "externalId": "area-001"}, "status": "Ready"},
        )
        service = CdfPlanService(_make_client([node]))
        plans = service.list(SPACE, "area-001")
        assert plans[0].name is None
        assert plans[0].description is None

    def test_maps_map_relation_when_present(self) -> None:
        node = _make_node(
            SPACE,
            "plan-001",
            INSPECTION_PLAN_VIEW,
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "map": {"space": SPACE, "externalId": "result-001"},
                "status": "Ready",
            },
        )
        service = CdfPlanService(_make_client([node]))
        plans = service.list(SPACE, "area-001")
        assert plans[0].map_external_id == "result-001"

    def test_defaults_map_external_id_to_none_when_absent(self) -> None:
        node = _make_node(
            SPACE,
            "plan-001",
            INSPECTION_PLAN_VIEW,
            {"area": {"space": SPACE, "externalId": "area-001"}, "status": "Ready"},
        )
        service = CdfPlanService(_make_client([node]))
        plans = service.list(SPACE, "area-001")
        assert plans[0].map_external_id is None

    def test_skips_non_node_items(self) -> None:
        edge = MagicMock()
        edge.instance_type = "edge"
        service = CdfPlanService(_make_client([edge]))
        assert service.list(SPACE, "area-001") == []

    def test_invalid_status_falls_back_to_draft(self) -> None:
        node = _make_node(
            SPACE,
            "plan-001",
            INSPECTION_PLAN_VIEW,
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "status": "Bogus",
            },
        )
        service = CdfPlanService(_make_client([node]))
        plans = service.list(SPACE, "area-001")
        assert plans[0].status == "Draft"

    def test_plans_sorted_by_created_time_desc(self) -> None:
        nodes = [
            _make_node(
                SPACE,
                "plan-old",
                INSPECTION_PLAN_VIEW,
                {"area": {"space": SPACE, "externalId": "a"}},
                created_time=100,
            ),
            _make_node(
                SPACE,
                "plan-new",
                INSPECTION_PLAN_VIEW,
                {"area": {"space": SPACE, "externalId": "a"}},
                created_time=200,
            ),
        ]
        service = CdfPlanService(_make_client(nodes))
        plans = service.list(SPACE, "a")
        assert [p.external_id for p in plans] == ["plan-new", "plan-old"]

    def test_filter_uses_area_direct_relation(self) -> None:
        client = _make_client([])
        CdfPlanService(client).list(SPACE, "area-007")
        kwargs = client.data_modeling.instances.list.call_args.kwargs
        assert kwargs["filter"]["and"][0]["equals"]["value"] == {
            "space": SPACE,
            "externalId": "area-007",
        }

    def test_filter_excludes_soft_deleted_plans(self) -> None:
        client = _make_client([])
        CdfPlanService(client).list(SPACE, "area-007")
        kwargs = client.data_modeling.instances.list.call_args.kwargs
        assert kwargs["filter"]["and"][1] == {
            "not": {
                "exists": {"property": container_property(INSPECTION_PLAN_CONTAINER, "deletedAt")}
            }
        }


# ---------------------------------------------------------------------------
# count_tasks()
# ---------------------------------------------------------------------------


class TestCountTasks:
    def test_returns_empty_dict_for_empty_input(self) -> None:
        service = CdfPlanService(_make_client())
        assert service.count_tasks([]) == {}
        service._client.data_modeling.instances.list.assert_not_called()

    def test_zero_count_for_plan_with_no_tasks(self) -> None:
        service = CdfPlanService(_make_client([]))
        counts = service.count_tasks(["plan-001"])
        assert counts == {"plan-001": 0}

    def test_counts_tasks_per_plan(self) -> None:
        t1 = _make_node(
            SPACE,
            "task-1",
            INSPECTION_TASK_VIEW,
            {"plan": {"space": SPACE, "externalId": "plan-001"}},
        )
        t2 = _make_node(
            SPACE,
            "task-2",
            INSPECTION_TASK_VIEW,
            {"plan": {"space": SPACE, "externalId": "plan-001"}},
        )
        t3 = _make_node(
            SPACE,
            "task-3",
            INSPECTION_TASK_VIEW,
            {"plan": {"space": SPACE, "externalId": "plan-002"}},
        )
        service = CdfPlanService(_make_client([t1, t2, t3]))
        counts = service.count_tasks(["plan-001", "plan-002"])
        assert counts == {"plan-001": 2, "plan-002": 1}

    def test_ignores_tasks_for_unknown_plans(self) -> None:
        t = _make_node(
            SPACE,
            "task-x",
            INSPECTION_TASK_VIEW,
            {"plan": {"space": SPACE, "externalId": "plan-unknown"}},
        )
        service = CdfPlanService(_make_client([t]))
        counts = service.count_tasks(["plan-001"])
        assert counts == {"plan-001": 0}


# ---------------------------------------------------------------------------
# list_tasks()
# ---------------------------------------------------------------------------


class TestListTasks:
    def _make_region_task_node(self, eid: str) -> MagicMock:
        return _make_node(
            SPACE,
            eid,
            INSPECTION_TASK_VIEW,
            {
                "plan": {"space": SPACE, "externalId": "plan-001"},
                "taskType": "region",
                "inspectionType": "ndt_thickness",
                "position3d": [1.0, 2.0, 3.0],
                "normalVector": [0.0, 1.0, 0.0],
                "radiusM": 0.25,
            },
        )

    def test_maps_region_task(self) -> None:
        node = self._make_region_task_node("task-r1")
        service = CdfPlanService(_make_client([node]))
        tasks = service.list_tasks("plan-001")
        assert len(tasks) == 1
        t = tasks[0]
        assert t.external_id == "task-r1"
        assert t.kind == "region"
        assert t.inspection_type == "ndt_thickness"
        assert t.position3d == (1.0, 2.0, 3.0)
        assert t.normal_vector == (0.0, 1.0, 0.0)
        assert t.radius_m == pytest.approx(0.25)
        assert t.target_element is None

    def test_maps_element_task_with_fetched_target(self) -> None:
        task_node = _make_node(
            SPACE,
            "task-e1",
            INSPECTION_TASK_VIEW,
            {
                "plan": {"space": SPACE, "externalId": "plan-001"},
                "taskType": "element",
                "inspectionType": "visual",
                "targetElement": {"space": SPACE, "externalId": "elem-001"},
            },
        )

        elem_node = _make_node(
            SPACE,
            "elem-001",
            STRUCTURAL_ELEMENT_VIEW,
            {
                "elementType": "manhole",
                "centerX": 1.0,
                "centerY": 2.0,
                "centerZ": 3.0,
            },
        )
        retrieve_result = MagicMock()
        retrieve_result.nodes = [elem_node]

        client = _make_client([task_node])
        client.data_modeling.instances.retrieve.return_value = retrieve_result
        service = CdfPlanService(client)
        tasks = service.list_tasks("plan-001")
        assert len(tasks) == 1
        t = tasks[0]
        assert t.kind == "element"
        assert t.target_element == ElementTarget(
            external_id="elem-001",
            element_type="manhole",
            center=(1.0, 2.0, 3.0),
        )

    def test_element_task_with_missing_target_returns_none(self) -> None:
        task_node = _make_node(
            SPACE,
            "task-e2",
            INSPECTION_TASK_VIEW,
            {
                "plan": {"space": SPACE, "externalId": "plan-001"},
                "taskType": "element",
                "inspectionType": "visual",
                "targetElement": {"space": SPACE, "externalId": "elem-missing"},
            },
        )
        retrieve_result = MagicMock()
        retrieve_result.nodes = []

        client = _make_client([task_node])
        client.data_modeling.instances.retrieve.return_value = retrieve_result
        service = CdfPlanService(client)
        tasks = service.list_tasks("plan-001")
        assert tasks[0].target_element is None

    def test_invalid_task_kind_falls_back_to_region(self) -> None:
        node = _make_node(
            SPACE,
            "task-bad",
            INSPECTION_TASK_VIEW,
            {
                "plan": {"space": SPACE, "externalId": "plan-001"},
                "taskType": "bogus",
                "inspectionType": "visual",
            },
        )
        service = CdfPlanService(_make_client([node]))
        tasks = service.list_tasks("plan-001")
        assert tasks[0].kind == "region"


# ---------------------------------------------------------------------------
# update_status()
# ---------------------------------------------------------------------------


class TestUpdateStatus:
    def test_calls_upsert_with_correct_payload(self) -> None:
        client = _make_client()
        CdfPlanService(client).update_status(SPACE, "plan-001", "Complete")
        client.data_modeling.instances.apply.assert_called_once()
        nodes = client.data_modeling.instances.apply.call_args.kwargs["nodes"]
        assert len(nodes) == 1
        node = nodes[0]
        assert node.space == SPACE
        assert node.external_id == "plan-001"
        props = node.sources[0].properties
        assert props["status"] == "Complete"


# ---------------------------------------------------------------------------
# download()
# ---------------------------------------------------------------------------


class TestDownload:
    def _setup_client_for_download(
        self, plan_props: dict, task_nodes: list[MagicMock]
    ) -> MagicMock:
        plan_node = _make_node(SPACE, "plan-001", INSPECTION_PLAN_VIEW, plan_props)
        retrieve_result = MagicMock()
        retrieve_result.nodes = [plan_node]
        client = MagicMock()
        client.data_modeling.instances.retrieve.return_value = retrieve_result
        client.data_modeling.instances.list.return_value = _make_list_response(task_nodes)
        return client

    def test_raises_when_plan_not_found(self, tmp_path: Path) -> None:
        client = MagicMock()
        retrieve_result = MagicMock()
        retrieve_result.nodes = []
        client.data_modeling.instances.retrieve.return_value = retrieve_result
        service = CdfPlanService(client)
        with pytest.raises(ValueError, match="not found"):
            service.download(SPACE, "plan-999", "My Area", tmp_path / "plan.json")

    def test_writes_json_file(self, tmp_path: Path) -> None:
        client = self._setup_client_for_download(
            {"area": {"space": SPACE, "externalId": "area-001"}, "status": "Ready"},
            [],
        )
        out = tmp_path / "plan.json"
        CdfPlanService(client).download(SPACE, "plan-001", "My Area", out)
        assert out.exists()
        data = json.loads(out.read_text())
        assert data["planExternalId"] == "plan-001"
        assert data["areaExternalId"] == "area-001"
        assert data["areaName"] == "My Area"
        assert data["name"] is None
        assert data["description"] is None
        assert "downloadedAt" in data
        assert data["tasks"] == []

    def test_writes_json_file_with_name_and_description(self, tmp_path: Path) -> None:
        client = self._setup_client_for_download(
            {
                "area": {"space": SPACE, "externalId": "area-001"},
                "status": "Ready",
                "name": "Q3 hull survey",
                "description": "Focus on aft hull",
            },
            [],
        )
        out = tmp_path / "plan.json"
        CdfPlanService(client).download(SPACE, "plan-001", "My Area", out)
        data = json.loads(out.read_text())
        assert data["name"] == "Q3 hull survey"
        assert data["description"] == "Focus on aft hull"

    def test_creates_parent_dirs(self, tmp_path: Path) -> None:
        client = self._setup_client_for_download(
            {"area": {"space": SPACE, "externalId": "area-001"}, "status": "Ready"},
            [],
        )
        out = tmp_path / "nested" / "dir" / "plan.json"
        CdfPlanService(client).download(SPACE, "plan-001", "Area", out)
        assert out.exists()


# ---------------------------------------------------------------------------
# _build_plan_json / _task_to_dict
# ---------------------------------------------------------------------------


class TestBuildPlanJson:
    def _make_plan(self) -> InspectionPlan:
        return InspectionPlan(
            space=SPACE,
            external_id="plan-001",
            area_external_id="area-001",
            status="Ready",
            created_time=0,
        )

    def test_region_task_includes_geometry(self) -> None:
        task = InspectionTask(
            space=SPACE,
            external_id="task-r",
            plan_external_id="plan-001",
            kind="region",
            inspection_type="ndt_thickness",
            position3d=(1.0, 2.0, 3.0),
            normal_vector=(0.0, 1.0, 0.0),
            radius_m=0.3,
        )
        d = _task_to_dict(task)
        assert d["kind"] == "region"
        assert d["position3d"] == [1.0, 2.0, 3.0]
        assert d["normalVector"] == [0.0, 1.0, 0.0]
        assert d["radiusM"] == pytest.approx(0.3)
        assert "targetElement" not in d

    def test_element_task_includes_target_element(self) -> None:
        task = InspectionTask(
            space=SPACE,
            external_id="task-e",
            plan_external_id="plan-001",
            kind="element",
            inspection_type="visual",
            target_element=ElementTarget(
                external_id="elem-001", element_type="manhole", center=(1.0, 2.0, 3.0)
            ),
        )
        d = _task_to_dict(task)
        assert d["kind"] == "element"
        assert d["targetElement"]["externalId"] == "elem-001"
        assert d["targetElement"]["type"] == "manhole"
        assert d["targetElement"]["center"] == [1.0, 2.0, 3.0]
        assert "position3d" not in d

    def test_region_task_omits_none_fields(self) -> None:
        task = InspectionTask(
            space=SPACE,
            external_id="task-r2",
            plan_external_id="plan-001",
            kind="region",
            inspection_type="visual",
        )
        d = _task_to_dict(task)
        assert "position3d" not in d
        assert "normalVector" not in d
        assert "radiusM" not in d

    def test_full_json_structure(self) -> None:
        plan = self._make_plan()
        payload = _build_plan_json(plan, "My Area", [])
        assert payload["planExternalId"] == "plan-001"
        assert payload["name"] is None
        assert payload["description"] is None
        assert payload["areaExternalId"] == "area-001"
        assert payload["areaName"] == "My Area"
        assert payload["mapExternalId"] is None
        assert isinstance(payload["tasks"], list)
        assert "downloadedAt" in payload

    def test_includes_name_and_description_when_set(self) -> None:
        plan = InspectionPlan(
            space=SPACE,
            external_id="plan-001",
            area_external_id="area-001",
            status="Ready",
            created_time=0,
            name="Q3 hull survey",
            description="Focus on aft hull",
        )
        payload = _build_plan_json(plan, "My Area", [])
        assert payload["name"] == "Q3 hull survey"
        assert payload["description"] == "Focus on aft hull"

    def test_includes_map_external_id_when_set(self) -> None:
        plan = InspectionPlan(
            space=SPACE,
            external_id="plan-001",
            area_external_id="area-001",
            status="Ready",
            created_time=0,
            map_external_id="result-001",
        )
        payload = _build_plan_json(plan, "My Area", [])
        assert payload["mapExternalId"] == "result-001"
