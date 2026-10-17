"""Tests for CdfNdtMeasurementService and CSV parsing."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from uidss.services.ndt_measurement_service import (
    REQUIRED_CSV_COLUMNS,
    CdfNdtMeasurementService,
    _parse_csv_rows,
    _rows_to_nodes,
    csv_matches_schema,
    missing_csv_columns,
)

FIXTURES = Path(__file__).parent.parent / "fixtures"
UTM_CSV = FIXTURES / "ut_global_registered.csv"


# ---------------------------------------------------------------------------
# csv_matches_schema / missing_csv_columns — pre-upload schema gating
# ---------------------------------------------------------------------------


class TestCsvSchemaMatching:
    def test_matching_fixture_returns_true(self) -> None:
        assert csv_matches_schema(UTM_CSV) is True

    def test_matching_fixture_has_no_missing_columns(self) -> None:
        assert missing_csv_columns(UTM_CSV) == set()

    def test_wrong_schema_csv_does_not_match(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "unrelated.csv"
        csv_path.write_text("name,value\nfoo,1\n")
        assert csv_matches_schema(csv_path) is False

    def test_wrong_schema_csv_reports_missing_columns(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "unrelated.csv"
        csv_path.write_text("name,value\nfoo,1\n")
        assert missing_csv_columns(csv_path) == REQUIRED_CSV_COLUMNS

    def test_partial_schema_reports_only_missing_columns(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "partial.csv"
        csv_path.write_text("timestamp,thickness\n1758798236657801216,0.008\n")
        assert missing_csv_columns(csv_path) == {"x", "y", "z"}

    def test_extra_columns_still_match(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "extra.csv"
        csv_path.write_text(
            "timestamp,thickness,x,y,z,extra\n1758798236657801216,0.008,1.0,2.0,3.0,ignored\n"
        )
        assert csv_matches_schema(csv_path) is True


# ---------------------------------------------------------------------------
# _parse_csv_rows — CSV parsing
# ---------------------------------------------------------------------------


class TestParseCsvRows:
    def test_returns_53_rows_from_fixture(self) -> None:
        rows = _parse_csv_rows(UTM_CSV)
        assert len(rows) == 53

    # D6.2 / TUM contract (confirmed 2026-09-29): timestamp is epoch SECONDS,
    # thickness is MILLIMETRES. Older exports used nanoseconds and metres;
    # both must keep parsing correctly.

    def test_tum_contract_seconds_and_mm(self, tmp_path: Path) -> None:
        # Arrange: a row exactly as ut_global_registered.csv writes it
        csv_path = tmp_path / "tum.csv"
        csv_path.write_text("timestamp,thickness,x,y,z\n1762179077.256366,8.1,1.0,2.0,3.0\n")
        # Act
        rows = _parse_csv_rows(csv_path)
        # Assert: 1762179077 s = 2025-11-03, thickness already mm
        assert rows[0].timestamp.startswith("2025-11-03")
        assert rows[0].thickness_mm == pytest.approx(8.1)

    def test_legacy_nanoseconds_and_metres(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "legacy.csv"
        csv_path.write_text("timestamp,thickness,x,y,z\n1758798236657801216,0.008,1.0,2.0,3.0\n")
        rows = _parse_csv_rows(csv_path)
        assert rows[0].timestamp.startswith("2025-09-25")
        assert rows[0].thickness_mm == pytest.approx(8.0)

    def test_millisecond_and_microsecond_timestamps(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "msus.csv"
        csv_path.write_text(
            "timestamp,thickness,x,y,z\n"
            "1762179077256.366,8.1,1.0,2.0,3.0\n"
            "1762179077256366.0,8.1,1.0,2.0,3.0\n"
        )
        rows = _parse_csv_rows(csv_path)
        assert rows[0].timestamp.startswith("2025-11-03")
        assert rows[1].timestamp.startswith("2025-11-03")

    def test_timestamp_is_iso8601_utc(self) -> None:
        rows = _parse_csv_rows(UTM_CSV)
        ts = rows[0].timestamp
        assert ts.endswith("+00:00") or ts.endswith("Z")
        assert "T" in ts

    def test_thickness_converted_to_mm(self) -> None:
        rows = _parse_csv_rows(UTM_CSV)
        # First CSV row has thickness ~0.0081 m → ~8.1 mm
        assert rows[0].thickness_mm == pytest.approx(8.1, abs=0.01)

    def test_position3d_preserved(self) -> None:
        rows = _parse_csv_rows(UTM_CSV)
        x, y, z = rows[0].position3d
        assert x == pytest.approx(1.8713, abs=1e-3)
        assert y == pytest.approx(1.1353, abs=1e-3)
        assert z == pytest.approx(1.1115, abs=1e-3)

    def test_all_rows_have_non_zero_thickness(self) -> None:
        rows = _parse_csv_rows(UTM_CSV)
        for row in rows:
            assert row.thickness_mm > 0


# ---------------------------------------------------------------------------
# _rows_to_nodes — NodeApply construction
# ---------------------------------------------------------------------------


class TestRowsToNodes:
    def test_external_id_scheme(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        csv_path.write_text("timestamp,thickness,x,y,z\n1758798236657801216,0.008,1.0,2.0,3.0\n")
        rows = _parse_csv_rows(csv_path)
        nodes = _rows_to_nodes(rows, "result-abc123")
        assert nodes[0].external_id == "result-abc123-meas-0000"

    def test_second_row_index(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        csv_path.write_text(
            "timestamp,thickness,x,y,z\n"
            "1758798236657801216,0.008,1.0,2.0,3.0\n"
            "1758798236657801217,0.009,4.0,5.0,6.0\n"
        )
        rows = _parse_csv_rows(csv_path)
        nodes = _rows_to_nodes(rows, "result-abc123")
        assert nodes[1].external_id == "result-abc123-meas-0001"

    def test_node_has_correct_space(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "test.csv"
        csv_path.write_text("timestamp,thickness,x,y,z\n1758798236657801216,0.008,1.0,2.0,3.0\n")
        rows = _parse_csv_rows(csv_path)
        nodes = _rows_to_nodes(rows, "result-abc123")
        assert nodes[0].space == "autoassess"

    def test_53_nodes_from_fixture(self) -> None:
        rows = _parse_csv_rows(UTM_CSV)
        nodes = _rows_to_nodes(rows, "result-test")
        assert len(nodes) == 53


# ---------------------------------------------------------------------------
# CdfNdtMeasurementService.create_from_csv — upload and chunking
# ---------------------------------------------------------------------------


class TestCdfNdtMeasurementService:
    def _make_service(self) -> tuple[CdfNdtMeasurementService, MagicMock]:
        mock_client: Any = MagicMock()
        mock_client.data_modeling = MagicMock()
        mock_client.data_modeling.instances = MagicMock()
        mock_client.data_modeling.instances.apply = MagicMock()
        return CdfNdtMeasurementService(mock_client), mock_client

    def test_returns_count_of_rows(self) -> None:
        svc, _ = self._make_service()
        count = svc.create_from_csv(UTM_CSV, "result-test")
        assert count == 53

    def test_calls_apply_once_for_small_dataset(self) -> None:
        svc, mock_client = self._make_service()
        svc.create_from_csv(UTM_CSV, "result-test")
        # 53 rows < 1000 chunk size → single apply call
        assert mock_client.data_modeling.instances.apply.call_count == 1

    def test_chunks_large_datasets(self, tmp_path: Path) -> None:
        # Build a CSV with 1500 rows to verify chunking at 1000
        csv_path = tmp_path / "large.csv"
        rows = ["timestamp,thickness,x,y,z"]
        for i in range(1500):
            rows.append(f"{1758798236657801216 + i},0.008,{i}.0,0.0,0.0")
        csv_path.write_text("\n".join(rows))

        svc, mock_client = self._make_service()
        count = svc.create_from_csv(csv_path, "result-big")
        assert count == 1500
        assert mock_client.data_modeling.instances.apply.call_count == 2

    def test_campaign_relation_in_node_properties(self) -> None:
        svc, mock_client = self._make_service()
        svc.create_from_csv(UTM_CSV, "result-xyz")

        call_args = mock_client.data_modeling.instances.apply.call_args
        nodes = call_args.kwargs.get("nodes") or call_args.args[0]
        first_node = nodes[0]
        sources = first_node.sources
        assert len(sources) == 1
        props = sources[0].properties
        campaign_ref = props["campaign"]
        assert isinstance(campaign_ref, dict)
        assert campaign_ref["externalId"] == "result-xyz"
        assert campaign_ref["space"] == "autoassess"
