"""Domain dataclasses — one per CDF view.

Property names mirror the TypeScript interfaces in autoassess-uidss/src/features/.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

PlanStatus = Literal["Draft", "Ready", "Complete"]
ResultStatus = Literal["InProgress", "Complete"]
ElementType = Literal["manhole", "longitudinal", "wall", "compartment"]
InspectionType = Literal["visual", "ndt_thickness"]
TaskKind = Literal["element", "region"]
MetricUnit = Literal["decimal", "percentage"]
Vec3 = tuple[float, float, float]


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
    # Stable id of the recommendation / finding that generated this task, if any.
    suggestion_id: str | None = None


@dataclass(frozen=True)
class NewRegionTask:
    """A region task to be written to a plan (mirrors the web app's `NewRegionTask`)."""

    position3d: Vec3
    normal_vector: Vec3
    radius_m: float
    inspection_type: InspectionType = "visual"
    suggestion_id: str | None = None


@dataclass(frozen=True)
class InspectionResult:
    space: str
    external_id: str
    area_external_id: str
    campaign_date: str  # ISO-8601 date, e.g. "2024-09-15"; CDF property key: campaignDate
    status: ResultStatus
    cdf_file_ids: tuple[int, ...] = field(default_factory=tuple)
    pcd_file_ids: tuple[int, ...] = field(default_factory=tuple)
    pcd_file_labels: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class NdtMeasurement:
    space: str
    external_id: str
    campaign_external_id: str
    position3d: tuple[float, float, float]
    thickness_mm: float
    timestamp: str  # ISO-8601


@dataclass(frozen=True)
class CampaignMetric:
    space: str
    external_id: str
    campaign_external_id: str
    name: str
    value: float
    unit: MetricUnit


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


@dataclass(frozen=True)
class DroneImage:
    space: str
    external_id: str
    campaign_external_id: str
    frame_id: int
    timestamp: float
    position: tuple[float, float, float]
    orientation_quat: tuple[float, float, float, float]  # qx, qy, qz, qw
    cdf_file_id: int
    bbox_min: tuple[float, float, float]
    bbox_max: tuple[float, float, float]
    focal_length_x: float
    focal_length_y: float
    principal_point_x: float
    principal_point_y: float
    image_width: int
    image_height: int
    near_plane: float
    far_plane: float
