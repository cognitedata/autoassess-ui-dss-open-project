"""Structural element service — parse ssg.yaml and upsert StructuralElement nodes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import structlog
import yaml
from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.instances import NodeApply, NodeOrEdgeData

from uidss.cdf.data_model import (
    SPACE,
    STRUCTURAL_ELEMENT_VIEW,
)
from uidss.models import ElementType, StructuralElement

log = structlog.get_logger()

_UPSERT_CHUNK_SIZE = 1000

_CLASS_TO_ELEMENT_TYPE: dict[int, ElementType] = {
    1: "manhole",
    2: "longitudinal",
    3: "wall",
    4: "compartment",
}

# metadata.yaml key -> ElementType, used as override when present
_NAME_TO_ELEMENT_TYPE: dict[str, ElementType] = {
    "manhole": "manhole",
    "longitudinal": "longitudinal",
    "wall": "wall",
    "compartment": "compartment",
}


class StructuralElementServiceProtocol(Protocol):
    def upsert_from_ssg(self, area_external_id: str, ssg_path: Path) -> int: ...


@dataclass
class CdfStructuralElementService:
    _client: CogniteClient

    def upsert_from_ssg(self, area_external_id: str, ssg_path: Path) -> int:
        class_map = _load_class_map(ssg_path.parent / "metadata.yaml")
        elements = parse_ssg_yaml(ssg_path, area_external_id, class_map)
        _apply_elements(self._client, area_external_id, elements)
        log.info("upserted structural elements", area=area_external_id, count=len(elements))
        return len(elements)


def parse_ssg_yaml(
    ssg_path: Path,
    area_external_id: str,
    class_map: dict[int, ElementType] | None = None,
) -> list[StructuralElement]:
    effective_map = class_map if class_map is not None else _CLASS_TO_ELEMENT_TYPE
    with ssg_path.open() as f:
        raw: dict[str, Any] = yaml.safe_load(f)
    instances = raw.get("instances") or []
    elements: list[StructuralElement] = []
    for inst in instances:
        class_id = int(inst["class"])
        instance_id = int(inst["id"])
        label = 1000 * class_id + instance_id
        element_type = effective_map.get(class_id, "longitudinal")
        cx, cy, cz = (float(v) for v in inst["center"])
        elements.append(
            StructuralElement(
                space=SPACE,
                external_id=f"{area_external_id}-elem-{label}",
                area_external_id=area_external_id,
                element_type=element_type,
                label=label,
                center_x=cx,
                center_y=cy,
                center_z=cz,
            )
        )
    return elements


def _load_class_map(metadata_path: Path) -> dict[int, ElementType]:
    if not metadata_path.exists():
        return _CLASS_TO_ELEMENT_TYPE
    with metadata_path.open() as f:
        raw: dict[str, Any] = yaml.safe_load(f)
    class_ids = raw.get("class_ids") or []
    result: dict[int, ElementType] = dict(_CLASS_TO_ELEMENT_TYPE)
    for entry in class_ids:
        if isinstance(entry, dict):
            for name, cid in entry.items():
                etype = _NAME_TO_ELEMENT_TYPE.get(str(name).lower())
                if etype is not None:
                    result[int(cid)] = etype
    return result


def _apply_elements(
    client: CogniteClient, area_external_id: str, elements: list[StructuralElement]
) -> None:
    for i in range(0, len(elements), _UPSERT_CHUNK_SIZE):
        chunk = elements[i : i + _UPSERT_CHUNK_SIZE]
        nodes = [_element_to_node(e, area_external_id) for e in chunk]
        client.data_modeling.instances.apply(nodes=nodes)


def _element_to_node(elem: StructuralElement, area_external_id: str) -> NodeApply:
    return NodeApply(
        space=elem.space,
        external_id=elem.external_id,
        sources=[
            NodeOrEdgeData(
                source=ViewId(*STRUCTURAL_ELEMENT_VIEW),
                properties={
                    "area": {"space": SPACE, "externalId": area_external_id},
                    "elementType": elem.element_type,
                    "label": elem.label,
                    "centerX": elem.center_x,
                    "centerY": elem.center_y,
                    "centerZ": elem.center_z,
                },
            )
        ],
    )
