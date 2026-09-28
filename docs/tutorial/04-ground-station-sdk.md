# 4. Track A: Ground station (`dss` CLI and Python SDK)

The [`sdk/`](../../sdk) project is a Python 3.12 package called `uidss`. It installs a CLI named **`dss`**. It is the robot side's only interface to CDF:

- **Down:** fetch a Ready inspection plan and its reference map
- **Up:** push mission output (maps, structural elements, UT thickness, metrics, drone images)

Prerequisite: [chapter 3](03-setup-credentials.md) done (`sdk/.env` set up, `uv run dss plan list` works). All commands below are run from `sdk/`.

---

## Part 1: The CLI

Every command is **interactive**. It walks you through vessel, then area, then plan or campaign with arrow-key pickers, and skips a picker when there's only one choice. Add `-v` for debug logging: `uv run dss -v plan list`.

> 💡 Tip: `source .venv/bin/activate` lets you type `dss` instead of `uv run dss`.

### 1.1 List plans

```bash
uv run dss plan list
```
✅ You should see a table with name, ID, status, created date and task count. Soft-deleted plans are hidden.

### 1.2 Download a plan

```bash
uv run dss plan download -o ~/gs/plans
```
Pick a plan (choose a **Ready** one; the CLI lets you pick any status). It writes `~/gs/plans/<planExternalId>.json`:

```jsonc
{
  "planExternalId": "plan-6c1e…",
  "name": "Tank 3 follow-up",
  "description": "Re-check corroded longitudinals",
  "areaExternalId": "area-01581",
  "areaName": "BWT 3P",
  "mapExternalId": "result-9ab2…",      // campaign whose map frame the coordinates use
  "downloadedAt": "2026-09-25T10:12:00+00:00",
  "tasks": [
    {                                    // element task
      "id": "task-…",
      "kind": "element",
      "inspectionType": "visual",        // visual | ndt_thickness
      "targetElement": {
        "externalId": "area-01581-elem-2011",
        "type": "longitudinal",          // manhole | longitudinal | wall | compartment
        "center": [4.17, 0.24, 0.84]
      }
    },
    {                                    // region task
      "id": "task-…",
      "kind": "region",
      "inspectionType": "ndt_thickness",
      "position3d": [2.20, 1.09, 0.92],
      "normalVector": [0.0, -1.0, 0.0],
      "radiusM": 0.3
    }
  ]
}
```

The robot decides **task order**; the plan is an unordered set. The task JSON shape is still open for discussion with ground-station partners (PRD OQ-5), and integration week is a good time to agree on it.


### 1.3 Download the reference map

```bash
uv run dss plan download-map -o ~/gs/maps
```
This downloads every PLY/PCD file of the plan's `map` campaign to `~/gs/maps/<mapExternalId>/<original filename>`. Use these files for onboard localization; plan coordinates are in their frame. It fails if the plan has no map. The map is set in the web app while the plan is Draft.

### 1.4 Upload a mission

```bash
uv run dss campaign upload ~/missions/2026-09-25-bwt3p/
```

The folder is scanned **recursively**, and files are recognised by extension or name:

| File | Becomes | Format |
|---|---|---|
| `*.ply` | Mesh file on the campaign (`cdfFileIds`) | Binary or ASCII PLY. Mesh or point cloud, optional vertex/face colours |
| `*.pcd` | Point cloud on the campaign (`pcdFileIds` + label you type) | PCL PCD. A `label` field is used to colour points in the viewer |
| `*.csv` | `NdtMeasurement` nodes | Columns `timestamp,thickness,x,y,z`. **timestamp in ns**, **thickness in metres** (stored ×1000 as mm) |
| `ssg.yaml` | `StructuralElement` nodes on the **area** | See below |
| `metrics.yaml` | `CampaignMetric` nodes | See below |

What happens during the upload:
1. Pick vessel and area, then pick an existing campaign or **create a new one** (you're asked for the date, default today).
2. Confirm each file.
3. **After the PLY upload, the mesh is converted into a CDF 3D model**, which is what the web viewer streams (it doesn't draw raw PLY files). This takes a few minutes and runs locally, then CDF processes the model (about 1 minute). Pass `--no-3d-model` to skip it, for example on a slow link; you can build it later with `build-3d-model` (below).
4. At the end, optionally mark the campaign **Complete** and the Ready plan **Complete**.

Re-running on the same campaign **adds** files. Every upload creates a **new** `CogniteFile`, so re-uploading the same file duplicates it.

### 1.4b Build the 3D model for an existing campaign

```bash
uv run dss campaign build-3d-model                       # interactive pickers
uv run dss campaign build-3d-model --campaign result-…   # non-interactive
```

For campaigns uploaded before 3D models existed, or with `--no-3d-model`. It downloads the campaign's PLY mesh(es), converts them to an OBJ zip, bakes the camera colours into textures if the mesh has them, and builds a small decimated **collision proxy** the viewer uses for picking. It uploads both as CogniteFiles, creates the CDF 3D model, and writes the Core DM nodes `{campaign}-cad-model` / `{campaign}-cad-revision` that the viewer looks up ([chapter 2](02-data-model.md#3d-models-core-dm)). Nothing existing is modified. The viewer shows a "3D model not built yet" notice with this command for every campaign that still needs it.

#### Sample files (in the repo)

Use the fixtures in [`sdk/tests/fixtures/`](../../sdk/tests/fixtures) as reference or for a dry run:

**`ut_global_registered.csv`**
```csv
timestamp,thickness,x,y,z
1.7587982366578012e+18,0.0081000002101063,1.8713123457696432,1.135346376148857,1.1114636951027421
```

**`ssg.yaml`** (scene-graph instances)
```yaml
instances:
  - id: 11
    class: 2          # 1=manhole 2=longitudinal 3=wall 4=compartment
    center: [4.17074, 0.237193, 0.844808]
```
`label = 1000*class + id` (so `2011` here). An optional `metadata.yaml` next to `ssg.yaml` with `class_ids: [{manhole: N}, …]` overrides the class-number mapping.

**`metrics.yaml`**
```yaml
metrics:
  - name: "Coverage"
    value: 91.3
    unit: percentage   # or: decimal
```

### 1.5 Upload drone images (TUM format)

```bash
uv run dss campaign upload-drone-images ~/missions/2026-09-25-bwt3p/tum/ -s ~/missions/2026-09-25-bwt3p/sensor.yaml
```

Expected layout (see [`sdk/tests/fixtures/drone_images/`](../../sdk/tests/fixtures/drone_images)):

```
tum/
├── rgb.txt           # 3 header lines, then "<timestamp> rgb/frame_0001.png"
├── groundtruth.txt   # "#" comments, then "<timestamp> tx ty tz qx qy qz qw"  (body/IMU pose in map frame)
├── rgb/*.png
└── sensor.yaml       # optional here if passed with -s (also looks for ../<folder>_test.yaml)
```

`sensor.yaml` uses the supereight2 format:
```yaml
sensor:
  width: 640
  height: 480
  fx: 390.598938
  fy: 390.598938
  cx: 320.0
  cy: 240.0
  near_plane: 0.4
  far_plane: 35.0
  T_BS: [ 0, 0, 1, 0.1165,     # body→sensor extrinsic, 4x4 row-major
         -1, 0, 0, 0.04802,
          0,-1, 0,-0.0373,
          0, 0, 0, 1]
```
The pose at each image's timestamp is interpolated from `groundtruth.txt` (lerp for position, slerp for rotation). The camera pose is `T_WS = T_WB · T_BS`. Each image becomes a PNG `CogniteFile` (external ID `drone-image-file-{campaign}-frame-{n}`) plus a `DroneImage` node.

---

## Part 2: Scripting with the Python API (non-interactive)

On a robot you'll usually want automation, not prompts. Everything the CLI does is available through `UidssClient`:

```python
from uidss import UidssClient

client = UidssClient.from_env()   # reads COGNITE_* from env / ./.env
```

| Service | Main methods |
|---|---|
| `client.vessels` | `list()` |
| `client.areas` | `list(vessel_space, vessel_external_id)` |
| `client.plans` | `list(area_space, area_eid)`, `list_tasks(plan_eid)`, `count_tasks([eids])`, `download(space, eid, area_name, output_path)`, `update_status(space, eid, "Draft"\|"Ready"\|"Complete")` |
| `client.campaigns` | `list(area_space, area_eid)`, `get(space, eid)`, `create(area_eid, "YYYY-MM-DD") -> eid`, `update_file_ids(space, eid, ply_ids, pcd_ids, pcd_labels)` ⚠️ overwrites, `complete(space, eid)`, `download_map(space, eid, out_dir)` |
| `client.artifacts` | `upload_ply(path, area_eid) -> file_id`, `upload_pcd(path, area_eid, label) -> file_id` |
| `client.structural_elements` | `upsert_from_ssg(area_eid, ssg_path)` |
| `client.measurements` | `create_from_csv(path, campaign_eid)`, `missing_columns(path)` |
| `client.campaign_metrics` | `upsert_from_yaml(path, campaign_eid)`, `list_for_campaign(campaign_eid)` |
| `client.drone_images` | `upload(folder, campaign_eid, sensor_yaml=None)`, `list_for_campaign(campaign_eid)` |

Return types are frozen dataclasses in [`sdk/src/uidss/models.py`](../../sdk/src/uidss/models.py) (`Vessel`, `Area`, `InspectionPlan`, `InspectionTask`, `InspectionResult`, …).

### Example: a full ground-station round trip

Save as `sdk/scripts/partner_roundtrip.py` (or anywhere with `uidss` installed) and run with `uv run python scripts/partner_roundtrip.py`:

```python
"""Download the newest Ready plan for an area, then upload a mission folder."""
from datetime import date
from pathlib import Path

from uidss import UidssClient

VESSEL_NAME = "ntnu – Test Vessel"      # use your partner prefix
AREA_NAME = "BWT 3P"
WORK_DIR = Path("~/gs").expanduser()
MISSION_DIR = Path("~/missions/latest").expanduser()

client = UidssClient.from_env()

# 1. Resolve vessel → area
vessel = next(v for v in client.vessels.list() if v.name == VESSEL_NAME)
area = next(a for a in client.areas.list(vessel.space, vessel.external_id) if a.name == AREA_NAME)

# 2. Newest Ready plan
ready = [p for p in client.plans.list(area.space, area.external_id) if p.status == "Ready"]
plan = max(ready, key=lambda p: p.created_time)

# 3. Download plan JSON + reference map
plan_path = WORK_DIR / "plans" / f"{plan.external_id}.json"
client.plans.download(plan.space, plan.external_id, area.name, plan_path)
if plan.map_external_id:
    client.campaigns.download_map(plan.space, plan.map_external_id, WORK_DIR / "maps" / plan.map_external_id)

# ... robot runs the mission, writes MISSION_DIR ...

# 4. Create a campaign and upload artifacts
campaign_eid = client.campaigns.create(area.external_id, date.today().isoformat())

ply_ids = [client.artifacts.upload_ply(p, area.external_id) for p in sorted(MISSION_DIR.rglob("*.ply"))]
pcds = sorted(MISSION_DIR.rglob("*.pcd"))
pcd_labels = [p.stem.replace("_", " ").title() for p in pcds]
pcd_ids = [client.artifacts.upload_pcd(p, area.external_id, lbl) for p, lbl in zip(pcds, pcd_labels)]
client.campaigns.update_file_ids(area.space, campaign_eid, ply_ids, pcd_ids, pcd_labels)

for csv in MISSION_DIR.rglob("*.csv"):
    client.measurements.create_from_csv(csv, campaign_eid)
if (ssg := next(MISSION_DIR.rglob("ssg.yaml"), None)):
    client.structural_elements.upsert_from_ssg(area.external_id, ssg)
if (metrics := next(MISSION_DIR.rglob("metrics.yaml"), None)):
    client.campaign_metrics.upsert_from_yaml(metrics, campaign_eid)
if (tum := MISSION_DIR / "tum").is_dir():
    client.drone_images.upload(tum, campaign_eid)

# 5. Close out
client.campaigns.complete(area.space, campaign_eid)
client.plans.update_status(plan.space, plan.external_id, "Complete")
print("Uploaded campaign", campaign_eid)
```

Other readable examples in the repo:
- [`scripts/seed-simulated.py`](../../scripts/seed-simulated.py): minimal create-campaign-and-upload-PLY
- [`sdk/tests/integration/test_plan_roundtrip.py`](../../sdk/tests/integration/test_plan_roundtrip.py): plan round trip against real CDF

---

## Part 3: Developing on the SDK

Read [`sdk/AGENTS.md`](../../sdk/AGENTS.md) first. The short version:
- Full type annotations; `structlog` rather than `print()`; the secret is a `SecretStr`
- Services are defined by a `Protocol` and injected. Tests use **stub classes**, not `mock.patch`
- Test first (hypothesis, then parametrize, then examples)
- CDF: upsert rather than create, ≤ 1000 nodes per write, paginate reads

```bash
just test        # unit tests, no CDF needed   (= uv run pytest tests/unit/ -v)
just check       # ruff lint + format check + ty type check
just fix         # auto-fix lint/format
just test-all    # + integration tests against real CDF (needs .env)
just coverage
```
✅ `just test` runs with no network access. At the time of writing, ~218 tests pass and 2 fail in `tests/unit/test_vessel_area_service.py`. Those two are known and unrelated to your changes.

Where to add things:
- New CLI command: [`sdk/src/uidss/cli/main.py`](../../sdk/src/uidss/cli/main.py) (Typer), prompts in `cli/selectors.py`
- New CDF entity or behaviour: a service in `sdk/src/uidss/services/`, a dataclass in `models.py`, then wire it into `client.py`
- New file type in mission folders: [`sdk/src/uidss/cli/file_scanner.py`](../../sdk/src/uidss/cli/file_scanner.py)

**Next:** [7. End-to-end exercise →](07-end-to-end-exercise.md)
