#!/usr/bin/env python3
"""
Add the CampaignMetricContainer and CampaignMetricView to an existing CDF environment.

Usage:
    uv run python scripts/migrate_campaign_metric_2026_06_18.py --check
    uv run python scripts/migrate_campaign_metric_2026_06_18.py

--check   Read-only pre-flight report. Exits 0 if ready to migrate, 1 otherwise.

The migration:
  1. Creates CampaignMetricContainer with properties: campaign, name, value, unit
  2. Creates CampaignMetricView (version "1") mapping those container properties

The operation is idempotent — running it twice is safe.
"""

from __future__ import annotations

import argparse
import sys

from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import (
    ContainerApply,
    ContainerId,
    ContainerPropertyApply,
    MappedPropertyApply,
    ViewApply,
)
from cognite.client.data_classes.data_modeling.data_types import DirectRelation, Float64, Text

from uidss.cdf.data_model import CAMPAIGN_METRIC_CONTAINER, CAMPAIGN_METRIC_VIEW, SPACE

CONTAINER_EXT_ID = CAMPAIGN_METRIC_CONTAINER[1]
VIEW_EXT_ID = CAMPAIGN_METRIC_VIEW[1]
VIEW_VERSION = CAMPAIGN_METRIC_VIEW[2]


# ---------------------------------------------------------------------------
# Pre-flight check (read-only)
# ---------------------------------------------------------------------------


def run_check(client: CogniteClient) -> bool:
    ok = True
    print("\n=== PRE-FLIGHT CHECK ===\n")

    try:
        containers = client.data_modeling.containers.retrieve(
            ids=[ContainerIdentifier(SPACE, CONTAINER_EXT_ID)]
        )
        if containers:
            print(f"  CampaignMetricContainer: ✓ ALREADY EXISTS (migration will overwrite — safe)")
        else:
            print(f"  CampaignMetricContainer: ✗ NOT FOUND — will be created")
    except Exception as exc:
        print(f"  CampaignMetricContainer: ERROR checking — {exc}")
        ok = False

    print()

    if ok:
        print("✓ Ready to migrate")
    else:
        print("✗ Pre-flight check FAILED — resolve the issues above before migrating")

    return ok


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------


def run_migration(client: CogniteClient) -> bool:
    print("\n=== CREATING CampaignMetricContainer ===\n")

    container = ContainerApply(
        space=SPACE,
        external_id=CONTAINER_EXT_ID,
        properties={
            "campaign": ContainerPropertyApply(type=DirectRelation(), nullable=True),
            "name":     ContainerPropertyApply(type=Text(), nullable=False),
            "value":    ContainerPropertyApply(type=Float64(), nullable=False),
            "unit":     ContainerPropertyApply(type=Text(), nullable=False),
        },
    )
    client.data_modeling.containers.apply([container])
    print(f"  ✓ {CONTAINER_EXT_ID} upserted")

    print("\n=== CREATING CampaignMetricView ===\n")

    container_id = ContainerId(SPACE, CONTAINER_EXT_ID)
    view = ViewApply(
        space=SPACE,
        external_id=VIEW_EXT_ID,
        version=VIEW_VERSION,
        properties={
            "campaign": MappedPropertyApply(
                container=container_id,
                container_property_identifier="campaign",
            ),
            "name": MappedPropertyApply(
                container=container_id,
                container_property_identifier="name",
            ),
            "value": MappedPropertyApply(
                container=container_id,
                container_property_identifier="value",
            ),
            "unit": MappedPropertyApply(
                container=container_id,
                container_property_identifier="unit",
            ),
        },
    )
    client.data_modeling.views.apply([view])
    print(f"  ✓ {VIEW_EXT_ID} v{VIEW_VERSION} upserted")

    print("\nMIGRATION COMPLETE ✓\n")
    return True


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Pre-flight read-only report (no modifications).",
    )
    args = parser.parse_args()

    from uidss.client import UidssClient

    sdk = UidssClient.from_env()
    cdf: CogniteClient = sdk.campaigns._client

    if args.check:
        ok = run_check(cdf)
    else:
        ok = run_migration(cdf)

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
