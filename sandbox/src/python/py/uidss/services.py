"""Read-only sandbox implementations of the SDK services (same method names as the real ones)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import _sandbox_bridge  # JS module registered by the sandbox worker

from uidss._snapshot import vec3
from uidss.models import (
    Area,
    ElementTarget,
    InspectionPlan,
    InspectionTask,
    PlanStatus,
    Vessel,
)

_List = list  # avoid shadowing by method named `list`


class SandboxReadOnlyError(PermissionError):
    """Raised by SDK methods that would write to CDF. The sandbox never modifies CDF."""


@dataclass
class SandboxVesselService:
    _data: dict[str, Any]

    def list(self) -> _List[Vessel]:
        return [
            Vessel(
                space=v["space"],
                external_id=v["externalId"],
                name=v["name"],
                vessel_type=v["vesselType"],
            )
            for v in self._data["vessels"]
        ]


@dataclass
class SandboxAreaService:
    _data: dict[str, Any]

    def list(self, vessel_space: str, vessel_external_id: str) -> _List[Area]:
        return [
            Area(
                space=a["space"],
                external_id=a["externalId"],
                name=a["name"],
                area_type=a["areaType"],
                vessel_external_id=a["vesselExternalId"],
            )
            for a in self._data["areas"]
            if a["vesselExternalId"] == vessel_external_id
        ]


@dataclass
class SandboxPlanService:
    _data: dict[str, Any]

    def list(self, area_space: str, area_external_id: str) -> _List[InspectionPlan]:
        plans = [
            _map_plan(p) for p in self._data["plans"] if p["areaExternalId"] == area_external_id
        ]
        plans.sort(key=lambda p: p.created_time, reverse=True)
        return plans

    def count_tasks(self, plan_external_ids: _List[str]) -> dict[str, int]:
        counts: dict[str, int] = dict.fromkeys(plan_external_ids, 0)
        for t in self._data["tasks"]:
            if t["planExternalId"] in counts:
                counts[t["planExternalId"]] += 1
        return counts

    def list_tasks(self, plan_external_id: str) -> _List[InspectionTask]:
        return [
            _map_task(t) for t in self._data["tasks"] if t["planExternalId"] == plan_external_id
        ]

    def update_status(self, space: str, external_id: str, status: PlanStatus) -> None:
        """Sandbox: SIMULATED, nothing is written to CDF.

        Marking a plan "Complete" after a SimDrone flight of it has landed in this run changes the
        browser's copy of the data (the plan's status pill flips; later plans.list() calls see
        it) until the next Reload. Anything else raises SandboxReadOnlyError.
        """
        reply = json.loads(
            _sandbox_bridge.update_plan_status(
                json.dumps({"space": space, "externalId": external_id, "status": status})
            )
        )
        if "error" in reply:
            if reply.get("errorKind") == "read-only":
                raise SandboxReadOnlyError(reply["error"])
            raise ValueError(reply["error"])
        for p in self._data["plans"]:
            if p["space"] == space and p["externalId"] == external_id:
                p["status"] = status
        print(f"simulated: plan {external_id} → {status} (not written to CDF)")

    def download(self, space: str, external_id: str, area_name: str, output_path: Path) -> None:
        """Write plan.json to *output_path* (in the sandbox's in-memory filesystem)."""
        payload = build_plan_json(self._data, external_id, area_name=area_name)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2))


def build_plan_json(
    data: dict[str, Any], plan_external_id: str, area_name: str | None = None
) -> dict[str, Any]:
    """The plan.json dict for one snapshot plan (the layout `plans.download` writes).

    `area_name`: looked up in the snapshot's areas when not given.
    """
    raw = next((p for p in data["plans"] if p["externalId"] == plan_external_id), None)
    if raw is None:
        raise ValueError(f"Plan '{plan_external_id}' not found in CDF")
    plan = _map_plan(raw)
    if area_name is None:
        area_name = next(
            (a["name"] for a in data["areas"] if a["externalId"] == plan.area_external_id), ""
        )
    tasks = [_map_task(t) for t in data["tasks"] if t["planExternalId"] == plan_external_id]
    return _build_plan_json(plan, area_name, tasks)


# ---------------------------------------------------------------------------
# Mapping helpers — plan.json layout identical to sdk/src/uidss/services/plan_service.py
# ---------------------------------------------------------------------------


def _map_plan(p: dict[str, Any]) -> InspectionPlan:
    return InspectionPlan(
        space=p["space"],
        external_id=p["externalId"],
        area_external_id=p["areaExternalId"],
        status=p["status"],
        created_time=int(p["createdTime"]),
        last_updated_time=int(p["lastUpdatedTime"]),
        name=p.get("name"),
        description=p.get("description"),
        map_external_id=p.get("mapExternalId"),
    )


def _map_task(t: dict[str, Any]) -> InspectionTask:
    el = t.get("targetElement")
    target = None
    if el is not None:
        center = vec3(el["center"])
        assert center is not None
        target = ElementTarget(
            external_id=el["externalId"], element_type=el["elementType"], center=center
        )
    radius = t.get("radiusM")
    return InspectionTask(
        space=t["space"],
        external_id=t["externalId"],
        plan_external_id=t["planExternalId"],
        kind=t["kind"],
        inspection_type=t["inspectionType"],
        target_element=target,
        position3d=vec3(t.get("position3d")),
        normal_vector=vec3(t.get("normalVector")),
        radius_m=float(radius) if radius is not None else None,
    )


def _build_plan_json(
    plan: InspectionPlan, area_name: str, tasks: _List[InspectionTask]
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
    return d
