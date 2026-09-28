"""Domain dataclasses — copied from sdk/src/uidss/models.py (subset the sandbox can read)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PlanStatus = Literal["Draft", "Ready", "Complete"]
ElementType = Literal["manhole", "longitudinal", "wall", "compartment"]
InspectionType = Literal["visual", "ndt_thickness"]
TaskKind = Literal["element", "region"]


@dataclass(frozen=True)
class Vessel:
    space: str
    external_id: str
    name: str
    vessel_type: str


@dataclass(frozen=True)
class Area:
    space: str
    external_id: str
    name: str
    area_type: str
    vessel_external_id: str


@dataclass(frozen=True)
class InspectionPlan:
    space: str
    external_id: str
    area_external_id: str
    status: PlanStatus
    created_time: int  # Unix epoch milliseconds
    name: str | None = None
    description: str | None = None
    # externalId of the InspectionResult (campaign) this plan's task coordinates
    # are expressed against — the reference map for onboard localization.
    map_external_id: str | None = None


@dataclass(frozen=True)
class ElementTarget:
    external_id: str
    element_type: ElementType
    center: tuple[float, float, float]


@dataclass(frozen=True)
class InspectionTask:
    space: str
    external_id: str
    plan_external_id: str
    kind: TaskKind
    inspection_type: InspectionType
    # Element tasks
    target_element: ElementTarget | None = None
    # Region tasks
    position3d: tuple[float, float, float] | None = None
    normal_vector: tuple[float, float, float] | None = None
    radius_m: float | None = None


@dataclass(frozen=True)
class StructuralElement:
    space: str
    external_id: str
    area_external_id: str
    element_type: ElementType
    label: int
    center_x: float
    center_y: float
    center_z: float
