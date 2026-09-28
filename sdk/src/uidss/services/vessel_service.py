"""Vessel service — list vessels from CDF."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import structlog
from cognite.client import CogniteClient

from uidss.cdf.data_model import (
    SPACE,
    VESSEL_CONTAINER,
    VESSEL_VIEW,
    container_property,
    view_id,
)
from uidss.models import Vessel

log = structlog.get_logger()

_List = list  # avoid shadowing by method named `list`

_VALID_VESSEL_TYPES = frozenset({"bulk_carrier", "container", "tanker", "general"})


class VesselServiceProtocol(Protocol):
    def list(self) -> _List[Vessel]: ...


@dataclass
class CdfVesselService:
    _client: CogniteClient

    def list(self) -> _List[Vessel]:
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[view_id(VESSEL_VIEW)],
            filter={
                "not": {
                    "exists": {
                        "property": container_property(VESSEL_CONTAINER, "deletedAt"),
                    }
                }
            },
            limit=1000,
        )
        vessels = [_map_node(item) for item in response if item.instance_type == "node"]
        log.debug("listed vessels", count=len(vessels))
        return vessels


def _map_node(item: object) -> Vessel:
    props = getattr(item, "properties", {}) or {}
    view_props = props.get(view_id(VESSEL_VIEW)) or {}
    return Vessel(
        space=getattr(item, "space", SPACE),
        external_id=getattr(item, "external_id", ""),
        name=str(view_props.get("name", "")),
        vessel_type=str(view_props.get("vesselType", "")),
    )
