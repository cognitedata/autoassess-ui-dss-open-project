#!/usr/bin/env python3
"""
Add the `map` direct relation to InspectionPlanContainer and publish InspectionPlanView v4.

Usage:
    uv run python scripts/migrate_inspection_plan_map_2026_08_26.py --check
    uv run python scripts/migrate_inspection_plan_map_2026_08_26.py

--check   Read-only pre-flight report. Exits 0 if ready to migrate, 1 otherwise.

The migration:
  1. Adds a nullable `map` direct-relation property to the existing
     InspectionPlanContainer (references an InspectionResult/campaign node —
     the reference map a plan's task coordinates are expressed against).
     Container property additions are additive in CDF: existing properties
     (area, status, name, description, deletedAt) are left untouched.
  2. Creates InspectionPlanView version "4", re-mapping every existing v3
     property plus the new `map` property.

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
    ViewId,
)
from cognite.client.data_classes.data_modeling.data_types import DirectRelation

from uidss.cdf.data_model import INSPECTION_PLAN_CONTAINER, INSPECTION_PLAN_VIEW, SPACE

CONTAINER_EXT_ID = INSPECTION_PLAN_CONTAINER[1]
VIEW_EXT_ID = INSPECTION_PLAN_VIEW[1]
VIEW_VERSION = INSPECTION_PLAN_VIEW[2]

# Every property InspectionPlanView v3 mapped, straight off the container.
# `map` is the only addition for v4.
VIEW_PROPERTY_NAMES = ("area", "map", "status", "name", "description", "deletedAt")


# ---------------------------------------------------------------------------
# Pre-flight check (read-only)
# ---------------------------------------------------------------------------


def run_check(client: CogniteClient) -> bool:
    ok = True
    print("\n=== PRE-FLIGHT CHECK ===\n")

    try:
        containers = client.data_modeling.containers.retrieve(
            ids=[ContainerId(SPACE, CONTAINER_EXT_ID)]
        )
        if not containers:
            print(f"  {CONTAINER_EXT_ID}: NOT FOUND")
            ok = False
        elif "map" in containers[0].properties:
            print(f"  {CONTAINER_EXT_ID}: 'map' property already exists (migration is a no-op)")
        else:
            print(f"  {CONTAINER_EXT_ID}: found — 'map' property will be added")
    except Exception as exc:
        print(f"  {CONTAINER_EXT_ID}: ERROR checking — {exc}")
        ok = False

    try:
        views = client.data_modeling.views.retrieve(
            ids=[ViewId(SPACE, VIEW_EXT_ID, VIEW_VERSION)]
        )
        if views:
            print(f"  {VIEW_EXT_ID} v{VIEW_VERSION}: already exists (migration will overwrite — safe)")
        else:
            print(f"  {VIEW_EXT_ID} v{VIEW_VERSION}: NOT FOUND — will be created")
    except Exception as exc:
        print(f"  {VIEW_EXT_ID} v{VIEW_VERSION}: ERROR checking — {exc}")
        ok = False

    print()
    print("✓ Ready to migrate" if ok else "✗ Pre-flight check FAILED — resolve the issues above")
    return ok


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------


def run_migration(client: CogniteClient) -> bool:
    print(f"\n=== ADDING 'map' PROPERTY TO {CONTAINER_EXT_ID} ===\n")

    container = ContainerApply(
        space=SPACE,
        external_id=CONTAINER_EXT_ID,
        properties={
            "map": ContainerPropertyApply(type=DirectRelation(), nullable=True),
        },
    )
    client.data_modeling.containers.apply([container])
    print(f"  ✓ {CONTAINER_EXT_ID} updated (existing properties untouched)")

    print(f"\n=== CREATING {VIEW_EXT_ID} v{VIEW_VERSION} ===\n")

    container_id = ContainerId(SPACE, CONTAINER_EXT_ID)
    view = ViewApply(
        space=SPACE,
        external_id=VIEW_EXT_ID,
        version=VIEW_VERSION,
        properties={
            name: MappedPropertyApply(container=container_id, container_property_identifier=name)
            for name in VIEW_PROPERTY_NAMES
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
    cdf: CogniteClient = sdk.plans._client

    ok = run_check(cdf) if args.check else run_migration(cdf)

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
