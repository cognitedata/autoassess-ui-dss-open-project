"""Area service — list areas for a vessel."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import structlog
from cognite.client import CogniteClient

from uidss.cdf.data_model import (
    AREA_CONTAINER,
    AREA_VIEW,
    SPACE,
    container_property,
    view_id,
)
from uidss.models import Area

log = structlog.get_logger()

_List = list  # avoid shadowing by method named `list`


class AreaServiceProtocol(Protocol):
    def list(self, vessel_space: str, vessel_external_id: str) -> _List[Area]: ...


@dataclass
class CdfAreaService:
    _client: CogniteClient

    def list(self, vessel_space: str, vessel_external_id: str) -> _List[Area]:
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[view_id(AREA_VIEW)],
            filter={
                "and": [
                    {
                        "equals": {
                            "property": container_property(AREA_CONTAINER, "vessel"),
                            "value": {"space": vessel_space, "externalId": vessel_external_id},
                        }
                    },
                    {
                        "not": {
                            "exists": {
                                "property": container_property(AREA_CONTAINER, "deletedAt"),
                            }
                        }
                    },
                ]
            },
            limit=1000,
        )
        areas = [_map_node(item) for item in response if item.instance_type == "node"]
        log.debug("listed areas", vessel=vessel_external_id, count=len(areas))
        return areas


def _map_node(item: object) -> Area:
    props = getattr(item, "properties", {}) or {}
    view_props = props.get(view_id(AREA_VIEW)) or {}
    vessel_ref = view_props.get("vessel") or {}
    return Area(
        space=getattr(item, "space", SPACE),
        external_id=getattr(item, "external_id", ""),
        name=str(view_props.get("name", "")),
        area_type=str(view_props.get("areaType", "")),
        vessel_external_id=str(vessel_ref.get("externalId", ""))
        if isinstance(vessel_ref, dict)
        else "",
    )
