"""Integration test: plan download + campaign upload roundtrip.

Requires INTEGRATION_TESTS=1 and valid COGNITE_* credentials in the environment.
Skipped automatically in CI unless the guard env var is set.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from uidss import UidssClient


@pytest.mark.skipif(
    not os.environ.get("INTEGRATION_TESTS"), reason="Set INTEGRATION_TESTS=1 to run"
)
class TestPlanRoundtrip:
    """Smoke tests against a live CDF environment."""

    def test_list_vessels(self) -> None:
        client = UidssClient.from_env()
        vessels = client.vessels.list()
        assert isinstance(vessels, list)

    def test_plan_download_and_campaign_create(self, tmp_path: Path) -> None:
        client = UidssClient.from_env()

        vessels = client.vessels.list()
        assert vessels, "No vessels found — check CDF credentials and space"

        vessel = vessels[0]
        areas = client.areas.list(vessel.space, vessel.external_id)
        assert areas, f"No areas found for vessel {vessel.external_id}"

        area = areas[0]
        plans = client.plans.list(area.space, area.external_id)

        if plans:
            plan = plans[0]
            out = tmp_path / f"{plan.external_id}.json"
            client.plans.download(plan.space, plan.external_id, area.name, out)
            assert out.exists()
            import json

            data = json.loads(out.read_text())
            assert data["planExternalId"] == plan.external_id

        campaign_id = client.campaigns.create(area.external_id, "2099-01-01")
        assert campaign_id.startswith("result-")

        # Verify the campaign appears in list
        campaigns = client.campaigns.list(area.space, area.external_id)
        eids = [c.external_id for c in campaigns]
        assert campaign_id in eids

        # Clean up: mark complete to avoid polluting test environment
        client.campaigns.complete(area.space, campaign_id)
