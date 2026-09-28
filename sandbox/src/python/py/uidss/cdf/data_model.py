"""CDF space and view constants — same values as sdk/src/uidss/cdf/data_model.py.

In the sandbox there is no cognite-sdk, so view_id() returns the plain tuple.
"""

SPACE = "autoassess"

VESSEL_VIEW = (SPACE, "VesselView", "2")
AREA_VIEW = (SPACE, "AreaView", "4")
INSPECTION_PLAN_VIEW = (SPACE, "InspectionPlanView", "4")
INSPECTION_TASK_VIEW = (SPACE, "InspectionTaskView", "1")
STRUCTURAL_ELEMENT_VIEW = (SPACE, "StructuralElementView", "1")


def view_id(view: tuple[str, str, str]) -> tuple[str, str, str]:
    return view


def view_key(view: tuple[str, str, str]) -> str:
    _, external_id, version = view
    return f"{external_id}/{version}"
