"""NDT Measurement service — parse UTM CSV and upsert NdtMeasurement nodes to CDF."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.instances import NodeApply, NodeOrEdgeData

from uidss.cdf.data_model import NDT_MEASUREMENT_VIEW, SPACE
from uidss.models import NdtMeasurement

log = structlog.get_logger()

_CHUNK_SIZE = 1000

REQUIRED_CSV_COLUMNS = {"timestamp", "thickness", "x", "y", "z"}


class NdtMeasurementServiceProtocol(Protocol):
    def create_from_csv(self, path: Path, campaign_external_id: str) -> int: ...
    def matches_schema(self, path: Path) -> bool: ...
    def missing_columns(self, path: Path) -> set[str]: ...


@dataclass
class CdfNdtMeasurementService:
    _client: CogniteClient

    def create_from_csv(self, path: Path, campaign_external_id: str) -> int:
        rows = _parse_csv_rows(path)
        nodes = _rows_to_nodes(rows, campaign_external_id)
        for i in range(0, len(nodes), _CHUNK_SIZE):
            chunk = nodes[i : i + _CHUNK_SIZE]
            self._client.data_modeling.instances.apply(nodes=chunk)
        log.info("upserted NDT measurements", path=str(path), count=len(nodes))
        return len(nodes)

    def matches_schema(self, path: Path) -> bool:
        return csv_matches_schema(path)

    def missing_columns(self, path: Path) -> set[str]:
        return missing_csv_columns(path)


# ---------------------------------------------------------------------------
# Internal helpers — exposed for testing
# ---------------------------------------------------------------------------


def missing_csv_columns(path: Path) -> set[str]:
    """Return the subset of REQUIRED_CSV_COLUMNS missing from *path*'s header row."""
    with path.open(newline="") as fh:
        fieldnames = csv.DictReader(fh).fieldnames or []
    return REQUIRED_CSV_COLUMNS - set(fieldnames)


def csv_matches_schema(path: Path) -> bool:
    """Return True if *path*'s header contains all columns an NDT measurement CSV needs."""
    return not missing_csv_columns(path)


def _timestamp_to_iso(value: float) -> str:
    """Epoch timestamp of any resolution to ISO 8601 UTC.

    The D6.2 contract (confirmed with TUM, Sep 2026) writes epoch SECONDS.
    Older exports used nanoseconds; milli- and microseconds also appear in
    ROS tooling. The magnitudes never overlap (seconds stay below 1e11 until
    the year 5138), so divide by 1000 until the value is in the seconds range.
    """
    while value >= 1e11:
        value /= 1000.0
    return datetime.fromtimestamp(value, tz=UTC).isoformat()


def _thickness_to_mm(value: float) -> float:
    """Thickness column to millimetres.

    The D6.2 contract writes MILLIMETRES. Older exports wrote metres; no hull
    plate is thinner than 0.5 mm, so a value below 0.5 can only be metres.
    """
    return value * 1000.0 if value < 0.5 else value


def _parse_csv_rows(path: Path) -> list[NdtMeasurement]:
    rows: list[NdtMeasurement] = []
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            timestamp = _timestamp_to_iso(float(row["timestamp"]))
            thickness_mm = _thickness_to_mm(float(row["thickness"]))
            position3d = (float(row["x"]), float(row["y"]), float(row["z"]))
            rows.append(
                NdtMeasurement(
                    space=SPACE,
                    external_id="",  # filled later when we know campaign_external_id and index
                    campaign_external_id="",
                    position3d=position3d,
                    thickness_mm=thickness_mm,
                    timestamp=timestamp,
                )
            )
    return rows


def _rows_to_nodes(rows: list[NdtMeasurement], campaign_external_id: str) -> list[NodeApply]:
    nodes: list[NodeApply] = []
    for i, row in enumerate(rows):
        external_id = f"{campaign_external_id}-meas-{i:04d}"
        nodes.append(
            NodeApply(
                space=SPACE,
                external_id=external_id,
                sources=[
                    NodeOrEdgeData(
                        source=ViewId(*NDT_MEASUREMENT_VIEW),
                        properties={
                            "campaign": {"space": SPACE, "externalId": campaign_external_id},
                            "position3d": list(row.position3d),
                            "thicknessMm": row.thickness_mm,
                            "timestamp": row.timestamp,
                        },
                    )
                ],
            )
        )
    return nodes
