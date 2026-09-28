"""CDF space, container, and view constants.

Mirror of ../../../../src/shared/cdf/dataModel.ts (this repo's TypeScript app, the
authoritative source). When that file changes, update these constants and bump
versions to match.
"""

from cognite.client.data_classes.data_modeling import ViewId

SPACE = "autoassess"

# Views: (space, externalId, version)
VESSEL_VIEW = (SPACE, "VesselView", "2")
AREA_VIEW = (SPACE, "AreaView", "4")
INSPECTION_PLAN_VIEW = (SPACE, "InspectionPlanView", "4")
INSPECTION_TASK_VIEW = (SPACE, "InspectionTaskView", "1")
INSPECTION_RESULT_VIEW = (SPACE, "InspectionResultView", "1")
STRUCTURAL_ELEMENT_VIEW = (SPACE, "StructuralElementView", "1")
DEFECT_DETECTION_VIEW = (SPACE, "DefectDetectionView", "1")

# Containers (used when constructing property filter paths)
VESSEL_CONTAINER = (SPACE, "VesselContainer")
AREA_CONTAINER = (SPACE, "AreaContainer")
INSPECTION_PLAN_CONTAINER = (SPACE, "InspectionPlanContainer")
INSPECTION_TASK_CONTAINER = (SPACE, "InspectionTaskContainer")
INSPECTION_RESULT_CONTAINER = (SPACE, "InspectionResultContainer")
STRUCTURAL_ELEMENT_CONTAINER = (SPACE, "StructuralElementContainer")
DEFECT_DETECTION_CONTAINER = (SPACE, "DefectDetectionContainer")
NDT_MEASUREMENT_VIEW = (SPACE, "NdtMeasurementView", "1")
NDT_MEASUREMENT_CONTAINER = (SPACE, "NdtMeasurementContainer")
CAMPAIGN_METRIC_VIEW = (SPACE, "CampaignMetricView", "1")
CAMPAIGN_METRIC_CONTAINER = (SPACE, "CampaignMetricContainer")
DRONE_IMAGE_VIEW = (SPACE, "DroneImageView", "2")
DRONE_IMAGE_CONTAINER = (SPACE, "DroneImageContainer")


def view_id(view: tuple[str, str, str]) -> ViewId:
    """Return a typed ViewId for the given view tuple."""
    return ViewId(*view)


def view_key(view: tuple[str, str, str]) -> str:
    """Return the property-group key used inside CDF node responses: 'ExternalId/version'."""
    _, external_id, version = view
    return f"{external_id}/{version}"


def container_property(container: tuple[str, str], prop: str) -> list[str]:
    """Return a 3-element property path for use in CDF DM filters."""
    space, external_id = container
    return [space, external_id, prop]


def view_source(view: tuple[str, str, str]) -> dict:
    """Return a CDF source dict for the given view tuple."""
    space, external_id, version = view
    return {
        "source": {"type": "view", "space": space, "externalId": external_id, "version": version}
    }
