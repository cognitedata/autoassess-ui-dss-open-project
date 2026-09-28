"""Campaign metric service — parse metrics.yaml and upsert/list CampaignMetric nodes."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

import structlog
import yaml
from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.instances import NodeApply, NodeOrEdgeData

from uidss.cdf.data_model import (
    CAMPAIGN_METRIC_CONTAINER,
    CAMPAIGN_METRIC_VIEW,
    SPACE,
    container_property,
    view_id,
)
from uidss.models import CampaignMetric, MetricUnit

log = structlog.get_logger()

_CHUNK_SIZE = 1000
_VALID_UNITS: frozenset[str] = frozenset({"decimal", "percentage"})


class CampaignMetricServiceProtocol(Protocol):
    def upsert_from_yaml(self, path: Path, campaign_external_id: str) -> int: ...
    def list_for_campaign(self, campaign_external_id: str) -> list[CampaignMetric]: ...


@dataclass
class CdfCampaignMetricService:
    _client: CogniteClient

    def upsert_from_yaml(self, path: Path, campaign_external_id: str) -> int:
        metrics = parse_metrics_yaml(path, campaign_external_id)
        nodes = _metrics_to_nodes(metrics)
        for i in range(0, len(nodes), _CHUNK_SIZE):
            chunk = nodes[i : i + _CHUNK_SIZE]
            self._client.data_modeling.instances.apply(nodes=chunk)
        log.info("upserted campaign metrics", path=str(path), count=len(nodes))
        return len(nodes)

    def list_for_campaign(self, campaign_external_id: str) -> list[CampaignMetric]:
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[view_id(CAMPAIGN_METRIC_VIEW)],
            filter={
                "equals": {
                    "property": container_property(CAMPAIGN_METRIC_CONTAINER, "campaign"),
                    "value": {"space": SPACE, "externalId": campaign_external_id},
                }
            },
            limit=1000,
        )
        results = [_map_node(item) for item in response if item.instance_type == "node"]
        log.debug("listed campaign metrics", campaign=campaign_external_id, count=len(results))
        return results


# ---------------------------------------------------------------------------
# Internal helpers — exposed for testing
# ---------------------------------------------------------------------------


def parse_metrics_yaml(path: Path, campaign_external_id: str) -> list[CampaignMetric]:
    with path.open() as fh:
        data = yaml.safe_load(fh)
    metrics: list[CampaignMetric] = []
    for entry in data.get("metrics", []):
        raw_unit = str(entry.get("unit", ""))
        if raw_unit not in _VALID_UNITS:
            raise ValueError(
                f"Unknown metric unit {raw_unit!r}; must be one of {sorted(_VALID_UNITS)}"
            )
        unit = cast(MetricUnit, raw_unit)
        name = str(entry["name"])
        metrics.append(
            CampaignMetric(
                space=SPACE,
                external_id=f"{campaign_external_id}-metric-{_slugify(name)}",
                campaign_external_id=campaign_external_id,
                name=name,
                value=float(entry["value"]),
                unit=unit,
            )
        )
    return metrics


def _slugify(name: str) -> str:
    """Lower-case; non-alphanumeric runs replaced by a single hyphen."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _metrics_to_nodes(metrics: list[CampaignMetric]) -> list[NodeApply]:
    nodes: list[NodeApply] = []
    for metric in metrics:
        nodes.append(
            NodeApply(
                space=SPACE,
                external_id=metric.external_id,
                sources=[
                    NodeOrEdgeData(
                        source=ViewId(*CAMPAIGN_METRIC_VIEW),
                        properties={
                            "campaign": {
                                "space": SPACE,
                                "externalId": metric.campaign_external_id,
                            },
                            "name": metric.name,
                            "value": metric.value,
                            "unit": metric.unit,
                        },
                    )
                ],
            )
        )
    return nodes


def _map_node(item: object) -> CampaignMetric:
    props = getattr(item, "properties", {}) or {}
    view_props = props.get(view_id(CAMPAIGN_METRIC_VIEW)) or {}
    campaign_ref = view_props.get("campaign") or {}
    raw_unit = str(view_props.get("unit", "decimal"))
    unit = cast(MetricUnit, raw_unit if raw_unit in _VALID_UNITS else "decimal")
    return CampaignMetric(
        space=getattr(item, "space", SPACE),
        external_id=getattr(item, "external_id", ""),
        campaign_external_id=(
            str(campaign_ref.get("externalId", "")) if isinstance(campaign_ref, dict) else ""
        ),
        name=str(view_props.get("name", "")),
        value=float(view_props.get("value", 0.0)),
        unit=unit,
    )
