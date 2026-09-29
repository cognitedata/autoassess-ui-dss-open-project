"""Inspection plan service — list, create, add region tasks, download JSON, update status."""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, cast

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.instances import (
    NodeApply,
    NodeOrEdgeData,
    PropertyValueWrite,
)

from uidss.cdf.data_model import (
    INSPECTION_PLAN_CONTAINER,
    INSPECTION_PLAN_VIEW,
    INSPECTION_TASK_CONTAINER,
    INSPECTION_TASK_VIEW,
    SPACE,
    STRUCTURAL_ELEMENT_VIEW,
    container_property,
    view_id,
)
from uidss.models import (
    ElementTarget,
    ElementType,
    InspectionPlan,
    InspectionTask,
    InspectionType,
    NewRegionTask,
    PlanStatus,
    TaskKind,
)

log = structlog.get_logger()

_List = list  # avoid shadowing by method named `list`
_CHUNK_SIZE = 1000
_VALID_STATUSES: frozenset[str] = frozenset({"Draft", "Ready", "Active", "Complete"})
_VALID_ELEMENT_TYPES: frozenset[str] = frozenset({"manhole", "longitudinal", "wall", "compartment"})
_VALID_INSPECTION_TYPES: frozenset[str] = frozenset({"visual", "ndt_thickness"})
_VALID_TASK_KINDS: frozenset[str] = frozenset({"element", "region"})


class PlanServiceProtocol(Protocol):
    def list(self, area_space: str, area_external_id: str) -> _List[InspectionPlan]: ...
    def count_tasks(self, plan_external_ids: _List[str]) -> dict[str, int]: ...
    def list_tasks(self, plan_external_id: str) -> _List[InspectionTask]: ...
    def update_status(self, space: str, external_id: str, status: PlanStatus) -> None: ...
    def create(
        self,
        area_external_id: str,
        map_external_id: str,
        name: str | None = None,
        description: str | None = None,
    ) -> str: ...
    def add_region_tasks(
        self, plan_external_id: str, tasks: Sequence[NewRegionTask]
    ) -> _List[str]: ...
    def download(self, space: str, external_id: str, area_name: str, output_path: Path) -> None: ...


@dataclass
class CdfPlanService:
    _client: CogniteClient

    def list(self, area_space: str, area_external_id: str) -> _List[InspectionPlan]:
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[view_id(INSPECTION_PLAN_VIEW)],
            filter={
                "and": [
                    {
                        "equals": {
                            "property": container_property(INSPECTION_PLAN_CONTAINER, "area"),
                            "value": {"space": area_space, "externalId": area_external_id},
                        }
                    },
                    {
                        "not": {
                            "exists": {
                                "property": container_property(
                                    INSPECTION_PLAN_CONTAINER, "deletedAt"
                                )
                            }
                        }
                    },
                ]
            },
            limit=1000,
        )
        plans = [_map_plan_node(item) for item in response if item.instance_type == "node"]
        plans.sort(key=lambda p: p.created_time, reverse=True)
        log.debug("listed plans", area=area_external_id, count=len(plans))
        return plans

    def count_tasks(self, plan_external_ids: _List[str]) -> dict[str, int]:
        """Return a mapping of plan externalId → task count, fetched in a single query."""
        if not plan_external_ids:
            return {}
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[view_id(INSPECTION_TASK_VIEW)],
            filter={
                "in": {
                    "property": container_property(INSPECTION_TASK_CONTAINER, "plan"),
                    "values": [{"space": SPACE, "externalId": eid} for eid in plan_external_ids],
                }
            },
            limit=10000,
        )
        counts: dict[str, int] = dict.fromkeys(plan_external_ids, 0)
        for item in response:
            if item.instance_type != "node":
                continue
            props = getattr(item, "properties", {}) or {}
            task_props = props.get(view_id(INSPECTION_TASK_VIEW)) or {}
            plan_ref = task_props.get("plan") or {}
            plan_eid = plan_ref.get("externalId", "") if isinstance(plan_ref, dict) else ""
            if plan_eid in counts:
                counts[plan_eid] += 1
        return counts

    def list_tasks(self, plan_external_id: str) -> _List[InspectionTask]:
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[view_id(INSPECTION_TASK_VIEW)],
            filter={
                "equals": {
                    "property": container_property(INSPECTION_TASK_CONTAINER, "plan"),
                    "value": {"space": SPACE, "externalId": plan_external_id},
                }
            },
            limit=10000,
        )
        tasks = [
            _map_task_node(item, self._client) for item in response if item.instance_type == "node"
        ]
        log.debug("listed tasks", plan=plan_external_id, count=len(tasks))
        return tasks

    def update_status(self, space: str, external_id: str, status: PlanStatus) -> None:
        self._client.data_modeling.instances.apply(
            nodes=[
                NodeApply(
                    space=space,
                    external_id=external_id,
                    sources=[
                        NodeOrEdgeData(
                            source=ViewId(*INSPECTION_PLAN_VIEW),
                            properties={"status": status},
                        )
                    ],
                )
            ]
        )
        log.info("updated plan status", plan=external_id, status=status)

    def create(
        self,
        area_external_id: str,
        map_external_id: str,
        name: str | None = None,
        description: str | None = None,
    ) -> str:
        """Create a Draft plan on *area_external_id* whose coordinates use *map_external_id*.

        Mirrors the web app's ``CdfInspectionPlanService.create``: ``plan-<uuid4>`` with
        ``area`` / ``map`` direct relations and ``status: "Draft"``. Blank name/description
        are omitted. Returns the new plan's externalId.
        """
        external_id = f"plan-{uuid.uuid4()}"
        properties: dict[str, PropertyValueWrite] = {
            "area": {"space": SPACE, "externalId": area_external_id},
            "map": {"space": SPACE, "externalId": map_external_id},
            "status": "Draft",
        }
        if name and name.strip():
            properties["name"] = name.strip()
        if description and description.strip():
            properties["description"] = description.strip()
        self._client.data_modeling.instances.apply(
            nodes=[
                NodeApply(
                    space=SPACE,
                    external_id=external_id,
                    sources=[
                        NodeOrEdgeData(source=ViewId(*INSPECTION_PLAN_VIEW), properties=properties)
                    ],
                )
            ]
        )
        log.info("created plan", plan=external_id, area=area_external_id, map=map_external_id)
        return external_id

    def add_region_tasks(self, plan_external_id: str, tasks: Sequence[NewRegionTask]) -> _List[str]:
        """Add region tasks (``task-<uuid4>``, same fields as the web app) to a plan.

        Written in chunks of at most 1000 nodes. Returns the new tasks' externalIds in order.
        """
        nodes = [_region_task_node(plan_external_id, task) for task in tasks]
        for i in range(0, len(nodes), _CHUNK_SIZE):
            self._client.data_modeling.instances.apply(nodes=nodes[i : i + _CHUNK_SIZE])
        log.info("added region tasks", plan=plan_external_id, count=len(nodes))
        return [node.external_id for node in nodes]

    def download(self, space: str, external_id: str, area_name: str, output_path: Path) -> None:
        """Fetch plan + tasks from CDF and write plan.json to *output_path*."""
        plans = self._client.data_modeling.instances.retrieve(
            nodes=[(space, external_id)],
            sources=[view_id(INSPECTION_PLAN_VIEW)],
        )
        if not plans.nodes:
            raise ValueError(f"Plan '{external_id}' not found in CDF")
        plan = _map_plan_node(plans.nodes[0])
        tasks = self.list_tasks(external_id)
        payload = _build_plan_json(plan, area_name, tasks)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2))
        log.info("downloaded plan", plan=external_id, path=str(output_path))


# ---------------------------------------------------------------------------
# Mapping helpers
# ---------------------------------------------------------------------------


def _region_task_node(plan_external_id: str, task: NewRegionTask) -> NodeApply:
    properties: dict[str, PropertyValueWrite] = {
        "plan": {"space": SPACE, "externalId": plan_external_id},
        "taskType": "region",
        "inspectionType": task.inspection_type,
        "position3d": [float(v) for v in task.position3d],
        "normalVector": [float(v) for v in task.normal_vector],
        "radiusM": float(task.radius_m),
    }
    if task.suggestion_id is not None:
        properties["suggestionId"] = task.suggestion_id
    return NodeApply(
        space=SPACE,
        external_id=f"task-{uuid.uuid4()}",
        sources=[NodeOrEdgeData(source=ViewId(*INSPECTION_TASK_VIEW), properties=properties)],
    )


def _map_plan_node(item: object) -> InspectionPlan:
    props = getattr(item, "properties", {}) or {}
    view_props = props.get(view_id(INSPECTION_PLAN_VIEW)) or {}
    area_ref = view_props.get("area") or {}
    map_ref = view_props.get("map") or {}
    raw_status = str(view_props.get("status", "Draft"))
    status = cast(PlanStatus, raw_status if raw_status in _VALID_STATUSES else "Draft")
    name = view_props.get("name")
    description = view_props.get("description")
    return InspectionPlan(
        space=getattr(item, "space", SPACE),
        external_id=getattr(item, "external_id", ""),
        area_external_id=str(area_ref.get("externalId", "")) if isinstance(area_ref, dict) else "",
        status=status,
        created_time=int(getattr(item, "created_time", 0) or 0),
        name=str(name) if name else None,
        description=str(description) if description else None,
        map_external_id=(
            str(map_ref["externalId"]) if isinstance(map_ref, dict) and map_ref else None
        ),
    )


def _map_task_node(item: object, client: CogniteClient) -> InspectionTask:
    props = getattr(item, "properties", {}) or {}
    task_props = props.get(view_id(INSPECTION_TASK_VIEW)) or {}

    plan_ref = task_props.get("plan") or {}
    plan_eid = str(plan_ref.get("externalId", "")) if isinstance(plan_ref, dict) else ""

    raw_kind = str(task_props.get("taskType", "region"))
    kind = cast(TaskKind, raw_kind if raw_kind in _VALID_TASK_KINDS else "region")

    raw_itype = str(task_props.get("inspectionType", "visual"))
    _valid = _VALID_INSPECTION_TYPES
    inspection_type = cast(InspectionType, raw_itype if raw_itype in _valid else "visual")

    target_element: ElementTarget | None = None
    if kind == "element":
        elem_ref = task_props.get("targetElement") or {}
        elem_eid = str(elem_ref.get("externalId", "")) if isinstance(elem_ref, dict) else ""
        target_element = _fetch_element_target(client, elem_eid) if elem_eid else None

    pos = task_props.get("position3d")
    normal = task_props.get("normalVector")
    suggestion_id = task_props.get("suggestionId")

    return InspectionTask(
        space=getattr(item, "space", SPACE),
        external_id=getattr(item, "external_id", ""),
        plan_external_id=plan_eid,
        kind=kind,
        inspection_type=inspection_type,
        target_element=target_element,
        position3d=(
            (float(pos[0]), float(pos[1]), float(pos[2])) if pos and len(pos) == 3 else None
        ),
        normal_vector=(
            (float(normal[0]), float(normal[1]), float(normal[2]))
            if normal and len(normal) == 3
            else None
        ),
        radius_m=float(task_props["radiusM"]) if "radiusM" in task_props else None,
        suggestion_id=suggestion_id if isinstance(suggestion_id, str) else None,
    )


def _fetch_element_target(client: CogniteClient, external_id: str) -> ElementTarget | None:
    result = client.data_modeling.instances.retrieve(
        nodes=[(SPACE, external_id)],
        sources=[view_id(STRUCTURAL_ELEMENT_VIEW)],
    )
    if not result.nodes:
        return None
    item = result.nodes[0]
    props = getattr(item, "properties", {}) or {}
    ep = props.get(view_id(STRUCTURAL_ELEMENT_VIEW)) or {}
    raw_etype = str(ep.get("elementType", "longitudinal"))
    etype = cast(ElementType, raw_etype if raw_etype in _VALID_ELEMENT_TYPES else "longitudinal")
    return ElementTarget(
        external_id=external_id,
        element_type=etype,
        center=(
            float(ep.get("centerX", 0.0)),
            float(ep.get("centerY", 0.0)),
            float(ep.get("centerZ", 0.0)),
        ),
    )


def _build_plan_json(
    plan: InspectionPlan,
    area_name: str,
    tasks: _List[InspectionTask],
) -> dict[str, Any]:
    return {
        "planExternalId": plan.external_id,
        "name": plan.name,
        "description": plan.description,
        "areaExternalId": plan.area_external_id,
        "areaName": area_name,
        "mapExternalId": plan.map_external_id,
        "downloadedAt": datetime.now(UTC).isoformat(),
        "tasks": [_task_to_dict(t) for t in tasks],
    }


def _task_to_dict(task: InspectionTask) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": task.external_id,
        "kind": task.kind,
        "inspectionType": task.inspection_type,
    }
    if task.kind == "element" and task.target_element:
        d["targetElement"] = {
            "externalId": task.target_element.external_id,
            "type": task.target_element.element_type,
            "center": list(task.target_element.center),
        }
    if task.kind == "region":
        if task.position3d:
            d["position3d"] = list(task.position3d)
        if task.normal_vector:
            d["normalVector"] = list(task.normal_vector)
        if task.radius_m is not None:
            d["radiusM"] = task.radius_m
    if task.suggestion_id is not None:
        d["suggestionId"] = task.suggestion_id
    return d
