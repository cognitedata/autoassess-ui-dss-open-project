"""Tests for CdfCampaignMetricService and YAML parsing."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from uidss.cdf.data_model import CAMPAIGN_METRIC_VIEW, SPACE, view_key
from uidss.models import CampaignMetric
from uidss.services.campaign_metric_service import (
    CdfCampaignMetricService,
    _metrics_to_nodes,
    _slugify,
    parse_metrics_yaml,
)

FIXTURES = Path(__file__).parent.parent / "fixtures"
METRICS_YAML = FIXTURES / "metrics.yaml"


# ---------------------------------------------------------------------------
# _slugify
# ---------------------------------------------------------------------------


class TestSlugify:
    @pytest.mark.parametrize(
        "name, expected",
        [
            ("Corrosion rate", "corrosion-rate"),
            ("Coverage", "coverage"),
            ("Mean coating thickness", "mean-coating-thickness"),
            ("pH / acidity level", "ph-acidity-level"),
            ("  spaces around  ", "spaces-around"),
        ],
    )
    def test_slugify_cases(self, name: str, expected: str) -> None:
        assert _slugify(name) == expected


# ---------------------------------------------------------------------------
# parse_metrics_yaml
# ---------------------------------------------------------------------------


class TestParseMetricsYaml:
    def test_parses_fixture(self) -> None:
        metrics = parse_metrics_yaml(METRICS_YAML, "result-test")
        assert len(metrics) == 2

    def test_name_preserved(self) -> None:
        metrics = parse_metrics_yaml(METRICS_YAML, "result-test")
        names = {m.name for m in metrics}
        assert "Coverage" in names or "Corrosion rate" in names  # at least one expected name

    def test_decimal_unit_accepted(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics:\n  - name: A\n    value: 1.0\n    unit: decimal\n")
        metrics = parse_metrics_yaml(p, "result-x")
        assert metrics[0].unit == "decimal"

    def test_percentage_unit_accepted(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics:\n  - name: A\n    value: 50.0\n    unit: percentage\n")
        metrics = parse_metrics_yaml(p, "result-x")
        assert metrics[0].unit == "percentage"

    def test_unknown_unit_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics:\n  - name: A\n    value: 1.0\n    unit: bogus\n")
        with pytest.raises(ValueError, match="bogus"):
            parse_metrics_yaml(p, "result-x")

    def test_external_id_uses_slug(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics:\n  - name: Corrosion rate\n    value: 0.15\n    unit: decimal\n")
        metrics = parse_metrics_yaml(p, "result-abc")
        assert metrics[0].external_id == "result-abc-metric-corrosion-rate"

    def test_campaign_external_id_set(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics:\n  - name: A\n    value: 1.0\n    unit: decimal\n")
        metrics = parse_metrics_yaml(p, "result-xyz")
        assert metrics[0].campaign_external_id == "result-xyz"

    def test_value_preserved(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics:\n  - name: A\n    value: 87.5\n    unit: percentage\n")
        metrics = parse_metrics_yaml(p, "result-x")
        assert metrics[0].value == pytest.approx(87.5)

    def test_empty_metrics_list(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics: []\n")
        assert parse_metrics_yaml(p, "result-x") == []

    def test_space_is_autoassess(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        p.write_text("metrics:\n  - name: A\n    value: 1.0\n    unit: decimal\n")
        metrics = parse_metrics_yaml(p, "result-x")
        assert metrics[0].space == "autoassess"


# ---------------------------------------------------------------------------
# _metrics_to_nodes — NodeApply construction
# ---------------------------------------------------------------------------


class TestMetricsToNodes:
    def _make_metric(self, name: str = "Coverage", value: float = 91.3) -> CampaignMetric:
        return CampaignMetric(
            space=SPACE,
            external_id=f"result-test-metric-{_slugify(name)}",
            campaign_external_id="result-test",
            name=name,
            value=value,
            unit="percentage",
        )

    def test_node_count_matches_metrics(self) -> None:
        metrics = [self._make_metric("A"), self._make_metric("B")]
        nodes = _metrics_to_nodes(metrics)
        assert len(nodes) == 2

    def test_external_id_from_metric(self) -> None:
        metric = self._make_metric("Coverage")
        node = _metrics_to_nodes([metric])[0]
        assert node.external_id == metric.external_id

    def test_node_space_is_autoassess(self) -> None:
        node = _metrics_to_nodes([self._make_metric()])[0]
        assert node.space == "autoassess"

    def test_campaign_relation_in_properties(self) -> None:
        node = _metrics_to_nodes([self._make_metric()])[0]
        props = node.sources[0].properties
        assert props["campaign"] == {"space": SPACE, "externalId": "result-test"}

    def test_name_value_unit_in_properties(self) -> None:
        metric = CampaignMetric(
            space=SPACE,
            external_id="result-x-metric-a",
            campaign_external_id="result-x",
            name="A",
            value=42.0,
            unit="decimal",
        )
        node = _metrics_to_nodes([metric])[0]
        props = node.sources[0].properties
        assert props["name"] == "A"
        assert props["value"] == pytest.approx(42.0)
        assert props["unit"] == "decimal"


# ---------------------------------------------------------------------------
# CdfCampaignMetricService.upsert_from_yaml — upload and chunking
# ---------------------------------------------------------------------------


def _make_upsert_client() -> tuple[CdfCampaignMetricService, Any]:
    mock_client: Any = MagicMock()
    mock_client.data_modeling = MagicMock()
    mock_client.data_modeling.instances = MagicMock()
    mock_client.data_modeling.instances.apply = MagicMock()
    return CdfCampaignMetricService(mock_client), mock_client


class TestUpsertFromYaml:
    def test_returns_metric_count(self) -> None:
        svc, _ = _make_upsert_client()
        count = svc.upsert_from_yaml(METRICS_YAML, "result-test")
        assert count == 2

    def test_calls_apply_once_for_small_file(self) -> None:
        svc, mock_client = _make_upsert_client()
        svc.upsert_from_yaml(METRICS_YAML, "result-test")
        assert mock_client.data_modeling.instances.apply.call_count == 1

    def test_chunks_large_datasets(self, tmp_path: Path) -> None:
        p = tmp_path / "metrics.yaml"
        lines = ["metrics:"]
        for i in range(1500):
            lines.append(f"  - name: Metric {i}\n    value: {i}.0\n    unit: decimal")
        p.write_text("\n".join(lines))

        svc, mock_client = _make_upsert_client()
        count = svc.upsert_from_yaml(p, "result-big")
        assert count == 1500
        assert mock_client.data_modeling.instances.apply.call_count == 2


# ---------------------------------------------------------------------------
# CdfCampaignMetricService.list_for_campaign — node mapping
# ---------------------------------------------------------------------------


def _make_list_node(external_id: str, props: dict) -> MagicMock:
    node = MagicMock()
    node.instance_type = "node"
    node.space = SPACE
    node.external_id = external_id
    node.properties = {SPACE: {view_key(CAMPAIGN_METRIC_VIEW): props}}
    return node


def _make_list_client(nodes: list[MagicMock] | None = None) -> Any:
    client: Any = MagicMock()
    resp = MagicMock()
    resp.__iter__ = MagicMock(return_value=iter(nodes or []))
    client.data_modeling.instances.list.return_value = resp
    return client


class TestListForCampaign:
    def test_returns_empty_when_no_nodes(self) -> None:
        svc = CdfCampaignMetricService(_make_list_client())
        assert svc.list_for_campaign("result-test") == []

    def test_skips_non_node_items(self) -> None:
        edge = MagicMock()
        edge.instance_type = "edge"
        svc = CdfCampaignMetricService(_make_list_client([edge]))
        assert svc.list_for_campaign("result-test") == []

    def test_invalid_unit_falls_back_to_decimal(self) -> None:
        node = _make_list_node(
            "result-test-metric-x",
            {
                "campaign": {"space": SPACE, "externalId": "result-test"},
                "name": "X",
                "value": 1.0,
                "unit": "bogus",
            },
        )
        svc = CdfCampaignMetricService(_make_list_client([node]))
        results = svc.list_for_campaign("result-test")
        assert results[0].unit == "decimal"

    def test_filter_uses_campaign_direct_relation(self) -> None:
        client = _make_list_client()
        CdfCampaignMetricService(client).list_for_campaign("result-007")
        kwargs = client.data_modeling.instances.list.call_args.kwargs
        assert kwargs["filter"]["equals"]["value"] == {
            "space": SPACE,
            "externalId": "result-007",
        }
