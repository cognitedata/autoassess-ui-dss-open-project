"""Upload simulator_ship_CH_mesh.ply to Simulated Vessel > Simulated Area.

Usage (from project root with .env present):
    python scripts/seed-simulated.py
"""
from pathlib import Path

from uidss import UidssClient

PLY_PATH = Path(__file__).parent.parent / "mock-data" / "simulated" / "simulator_ship_CH_mesh.ply"


def main() -> None:
    client = UidssClient.from_env()

    vessels = client.vessels.list()
    vessel = next((v for v in vessels if v.name == "Simulated Vessel"), None)
    if vessel is None:
        raise RuntimeError(f"Vessel 'Simulated Vessel' not found. Available: {[v.name for v in vessels]}")

    areas = client.areas.list(vessel.space, vessel.external_id)
    area = next((a for a in areas if a.name == "Simulated Area"), None)
    if area is None:
        raise RuntimeError(f"Area 'Simulated Area' not found. Available: {[a.name for a in areas]}")

    print(f"Found: {vessel.external_id} / {area.external_id}")

    campaign_id = client.campaigns.create(area.external_id, "2024-01-01")
    print(f"Campaign: {campaign_id}")

    print("Uploading PLY (~99 MB)...")
    file_id = client.artifacts.upload_ply(PLY_PATH, area.external_id)
    print(f"  fileId: {file_id}")

    client.campaigns.update_file_ids(area.space, campaign_id, [file_id], [], [])
    print("Done.")


if __name__ == "__main__":
    main()
