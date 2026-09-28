#!/usr/bin/env python3
"""
Upload multi-session campaigns to Multi-Session Test Vessel / Test Area
with the correct per-flight dates, replacing whatever is currently there.

Flight → date mapping:
  E300L122060007_01581_388_1flight  →  2025-07-04  (mesh_984, older session)
  E300L122060007_01584_391_1flight  →  2025-07-05  (mesh_601, newer session)

Usage:
    uv run python scripts/migrate_campaign_2026_05_08.py --check
    uv run python scripts/migrate_campaign_2026_05_08.py

--check   Read-only pre-flight report. Exits 0 if ready, 1 otherwise.

The migration:
  1. Deletes all existing campaigns in the target area (+ their files/measurements)
  2. Uploads each flight subfolder as its own campaign with the correct date
  3. Upserts structural elements for flights that have ssg.yaml

Note on structural elements in area-01581: the earlier erroneous upload upserted
elements named 'area-01581-elem-{label}'. Those are NOT cleaned up here as they
may be referenced by InspectionTasks. Re-run setup-dm.ts step 5 if needed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from cognite.client.data_classes.data_modeling import NodeId
from cognite.client.exceptions import CogniteAPIError

from uidss.cdf.data_model import (
    NDT_MEASUREMENT_CONTAINER,
    NDT_MEASUREMENT_VIEW,
    SPACE,
    STRUCTURAL_ELEMENT_CONTAINER,
    STRUCTURAL_ELEMENT_VIEW,
    container_property,
    view_id,
)
from uidss.client import UidssClient
from uidss.models import InspectionResult

TARGET_VESSEL_NAME = "Multi-Session Test Vessel"
TARGET_AREA_NAME = "Test Area"
WRONG_AREA_EXT_ID = "area-01581"

# Per-flight campaign dates. Folder name → ISO-8601 date.
FLIGHT_DATES: dict[str, str] = {
    "E300L122060007_01581_388_1flight": "2025-07-04",  # mesh_984 — older session
    "E300L122060007_01584_391_1flight": "2025-07-05",  # mesh_601 — newer session
}

_REPO_ROOT = Path(__file__).parent.parent.parent
MULTI_SESSION_ROOT = (
    _REPO_ROOT / "autoassess-uidss" / "autoassess-uidss" / "mock-data" / "multi-session"
)


# ---------------------------------------------------------------------------
# Pre-flight check (read-only)
# ---------------------------------------------------------------------------


def run_check(sdk: UidssClient) -> bool:
    cdf = sdk.campaigns._client
    ok = True

    print("\n=== PRE-FLIGHT CHECK ===\n")

    # ---- Wrong area — should have no flight-date campaigns -----------------
    print("[WRONG VESSEL/AREA]")
    print(f"  vessel-test  'Test Vessel'  /  {WRONG_AREA_EXT_ID}  'Ballast Water Tank 01581'")
    wrong = [
        c
        for c in sdk.campaigns.list(SPACE, WRONG_AREA_EXT_ID)
        if c.campaign_date in FLIGHT_DATES.values()
    ]
    if wrong:
        for c in wrong:
            print(f"  Campaign {c.campaign_date}: FOUND (will be deleted)  {c.external_id}")
    else:
        print(f"  No flight-date campaigns present ✓")
    print()

    # ---- Target vessel / area ----------------------------------------------
    print("[TARGET VESSEL/AREA]")
    vessels = sdk.vessels.list()
    target_vessel = next((v for v in vessels if v.name == TARGET_VESSEL_NAME), None)

    if target_vessel is None:
        print(f"  '{TARGET_VESSEL_NAME}' ← ✗ NOT FOUND")
        ok = False
    else:
        print(f"  {target_vessel.external_id}  '{TARGET_VESSEL_NAME}' ← ✓ FOUND")
        areas = sdk.areas.list(target_vessel.space, target_vessel.external_id)
        target_area = next((a for a in areas if a.name == TARGET_AREA_NAME), None)
        if target_area is None:
            print(f"  '{TARGET_AREA_NAME}' ← ✗ NOT FOUND")
            ok = False
        else:
            print(f"  {target_area.external_id}  '{TARGET_AREA_NAME}' ← ✓ FOUND")
            existing = sdk.campaigns.list(SPACE, target_area.external_id)
            if existing:
                print(f"  Existing campaigns ({len(existing)}) — will all be deleted:")
                for c in existing:
                    files = len(c.cdf_file_ids) + len(c.pcd_file_ids)
                    meas = len(_list_ndt_ext_ids(cdf, c.external_id))
                    print(f"    {c.external_id}  date={c.campaign_date}  files={files}  ndt={meas}")
            else:
                print(f"  No campaigns in target area yet ✓")
    print()

    # ---- Local data --------------------------------------------------------
    print("[LOCAL DATA — one campaign per flight subfolder]")
    if not MULTI_SESSION_ROOT.exists():
        print(f"  ✗ multi-session folder not found: {MULTI_SESSION_ROOT}")
        ok = False
    else:
        flight_dirs = sorted(d for d in MULTI_SESSION_ROOT.iterdir() if d.is_dir())
        for flight_dir in flight_dirs:
            date = FLIGHT_DATES.get(flight_dir.name, "⚠ UNKNOWN DATE")
            ply = sorted(flight_dir.rglob("*.ply"))
            pcd = sorted(flight_dir.rglob("*.pcd"))
            ssg = sorted(flight_dir.rglob("ssg.yaml"))
            print(f"  {flight_dir.name}  →  campaign date {date}")
            print(f"    PLY: {[p.name for p in ply]}")
            print(f"    PCD: {[p.name for p in pcd]}")
            print(f"    ssg.yaml: {'yes' if ssg else 'no'}")
            if "UNKNOWN" in date:
                ok = False
    print()

    if ok:
        print("✓ All pre-flight checks passed — ready to run")
    else:
        print("✗ Pre-flight check FAILED — resolve the issues above before running")
    return ok


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------


def run_migration(sdk: UidssClient) -> bool:
    cdf = sdk.campaigns._client

    # ---- Find target vessel / area -----------------------------------------
    vessels = sdk.vessels.list()
    target_vessel = next((v for v in vessels if v.name == TARGET_VESSEL_NAME), None)
    if target_vessel is None:
        print(f"✗ Vessel '{TARGET_VESSEL_NAME}' not found. Aborting.")
        return False

    areas = sdk.areas.list(target_vessel.space, target_vessel.external_id)
    target_area = next((a for a in areas if a.name == TARGET_AREA_NAME), None)
    if target_area is None:
        print(f"✗ Area '{TARGET_AREA_NAME}' not found under '{TARGET_VESSEL_NAME}'. Aborting.")
        return False

    print(f"\nTarget: {target_vessel.name} / {target_area.name}  ({target_area.external_id})\n")

    flight_dirs = sorted(d for d in MULTI_SESSION_ROOT.iterdir() if d.is_dir())

    # ---- Step 1: delete erroneous campaigns from area-01581 (if any) -------
    wrong = [
        c
        for c in sdk.campaigns.list(SPACE, WRONG_AREA_EXT_ID)
        if c.campaign_date in FLIGHT_DATES.values()
    ]
    if wrong:
        print(f"[DELETING erroneous campaign(s) from {WRONG_AREA_EXT_ID}]")
        for c in wrong:
            print(f"  {c.external_id}  date={c.campaign_date}")
            _delete_campaign_with_files(sdk, cdf, c)

    # ---- Step 2: delete ALL existing campaigns in target area ---------------
    existing = sdk.campaigns.list(SPACE, target_area.external_id)
    if existing:
        print(f"[DELETING {len(existing)} existing campaign(s) from target area]")
        for c in existing:
            print(f"  {c.external_id}  date={c.campaign_date}")
            _delete_campaign_with_files(sdk, cdf, c)

    # ---- Step 3: upload one campaign per flight subfolder ------------------
    print(f"\n[UPLOADING {len(flight_dirs)} campaign(s) to {target_area.external_id}]")
    new_campaign_ext_ids: list[str] = []

    for flight_dir in flight_dirs:
        date = FLIGHT_DATES[flight_dir.name]
        print(f"\n  Flight: {flight_dir.name}  date={date}")

        ext_id = sdk.campaigns.create(target_area.external_id, date)
        new_campaign_ext_ids.append(ext_id)
        print(f"    Created campaign: {ext_id}")

        cdf_file_ids: list[int] = []
        pcd_file_ids: list[int] = []
        pcd_labels: list[str] = []

        for ply_path in sorted(flight_dir.rglob("*.ply")):
            print(f"    Uploading PLY: {ply_path.name}")
            fid = sdk.artifacts.upload_ply(ply_path, target_area.external_id)
            cdf_file_ids.append(fid)
            print(f"      → file_id={fid}")

        for pcd_path in sorted(flight_dir.rglob("*.pcd")):
            label = pcd_path.stem.replace("_", " ").title()
            print(f"    Uploading PCD: {pcd_path.name}  label={label!r}")
            fid = sdk.artifacts.upload_pcd(pcd_path, target_area.external_id, label)
            pcd_file_ids.append(fid)
            pcd_labels.append(label)
            print(f"      → file_id={fid}")

        sdk.campaigns.update_file_ids(SPACE, ext_id, cdf_file_ids, pcd_file_ids, pcd_labels)
        print(f"    Linked {len(cdf_file_ids)} PLY + {len(pcd_file_ids)} PCD to campaign")

        for ssg_path in sorted(flight_dir.rglob("ssg.yaml")):
            print(f"    Upserting structural elements from: {ssg_path.parent.name}/ssg.yaml")
            count = sdk.structural_elements.upsert_from_ssg(target_area.external_id, ssg_path)
            print(f"      → {count} elements upserted")

    # ---- Step 4: post-check ------------------------------------------------
    return _post_check(sdk, new_campaign_ext_ids, target_area.external_id)


def _delete_campaign_with_files(sdk: UidssClient, cdf, campaign: InspectionResult) -> None:
    all_file_ids = list(campaign.cdf_file_ids) + list(campaign.pcd_file_ids)
    if all_file_ids:
        try:
            cdf.files.delete(id=all_file_ids)
            print(f"    Deleted {len(all_file_ids)} file(s)")
        except Exception as exc:
            print(f"    WARNING: could not delete files: {exc}")

    meas_ext_ids = _list_ndt_ext_ids(cdf, campaign.external_id)
    if meas_ext_ids:
        cdf.data_modeling.instances.delete(
            nodes=[NodeId(SPACE, eid) for eid in meas_ext_ids]
        )
        print(f"    Deleted {len(meas_ext_ids)} NdtMeasurement(s)")

    metrics = _list_campaign_metrics(sdk, campaign.external_id)
    if metrics:
        cdf.data_modeling.instances.delete(
            nodes=[NodeId(SPACE, m.external_id) for m in metrics]
        )
        print(f"    Deleted {len(metrics)} CampaignMetric(s)")

    cdf.data_modeling.instances.delete(nodes=[NodeId(SPACE, campaign.external_id)])
    print(f"    Deleted campaign node {campaign.external_id}")


# ---------------------------------------------------------------------------
# Post-check
# ---------------------------------------------------------------------------


def _post_check(
    sdk: UidssClient,
    new_campaign_ext_ids: list[str],
    target_area_ext_id: str,
) -> bool:
    cdf = sdk.campaigns._client
    ok = True

    print("\n=== POST-CHECK ===\n")

    print(f"[TARGET AREA ({target_area_ext_id}) — expect {len(new_campaign_ext_ids)} campaign(s)]")
    all_campaigns = sdk.campaigns.list(SPACE, target_area_ext_id)
    by_id = {c.external_id: c for c in all_campaigns}
    for ext_id in new_campaign_ext_ids:
        cam = by_id.get(ext_id)
        if cam:
            print(f"  ✓ {ext_id}  date={cam.campaign_date}")
            print(f"    cdfFileIds : {list(cam.cdf_file_ids)}")
            print(f"    pcdFileIds : {list(cam.pcd_file_ids)}")
            print(f"    pcdLabels  : {list(cam.pcd_file_labels)}")
        else:
            print(f"  ✗ {ext_id} NOT found")
            ok = False
    elem_count = _count_elements_for_area(cdf, target_area_ext_id)
    print(f"  Structural elements in target area: {elem_count}")

    print()
    print(f"[WRONG AREA ({WRONG_AREA_EXT_ID}) — expect no flight-date campaigns]")
    wrong = [
        c
        for c in sdk.campaigns.list(SPACE, WRONG_AREA_EXT_ID)
        if c.campaign_date in FLIGHT_DATES.values()
    ]
    if wrong:
        print(f"  ✗ {len(wrong)} campaign(s) still present")
        ok = False
    else:
        print(f"  ✓ Clean")

    print()
    print("COMPLETE ✓" if ok else "INCOMPLETE ✗ — review failures above")
    return ok


# ---------------------------------------------------------------------------
# Service wrappers / DMS helpers
# ---------------------------------------------------------------------------


def _list_campaign_metrics(sdk: UidssClient, campaign_external_id: str) -> list:
    try:
        return sdk.campaign_metrics.list_for_campaign(campaign_external_id)
    except CogniteAPIError as exc:
        if "views do not exist" in str(exc):
            return []
        raise


def _list_ndt_ext_ids(cdf, campaign_external_id: str) -> list[str]:
    response = cdf.data_modeling.instances.list(
        instance_type="node",
        sources=[view_id(NDT_MEASUREMENT_VIEW)],
        filter={
            "equals": {
                "property": container_property(NDT_MEASUREMENT_CONTAINER, "campaign"),
                "value": {"space": SPACE, "externalId": campaign_external_id},
            }
        },
        limit=1000,
    )
    return [item.external_id for item in response if item.instance_type == "node"]


def _count_elements_for_area(cdf, area_external_id: str) -> int:
    response = cdf.data_modeling.instances.list(
        instance_type="node",
        sources=[view_id(STRUCTURAL_ELEMENT_VIEW)],
        filter={
            "equals": {
                "property": container_property(STRUCTURAL_ELEMENT_CONTAINER, "area"),
                "value": {"space": SPACE, "externalId": area_external_id},
            }
        },
        limit=1000,
    )
    return sum(1 for item in response if item.instance_type == "node")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--check", action="store_true", help="Pre-flight report, no changes.")
    args = parser.parse_args()

    sdk = UidssClient.from_env()
    ok = run_check(sdk) if args.check else run_migration(sdk)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
