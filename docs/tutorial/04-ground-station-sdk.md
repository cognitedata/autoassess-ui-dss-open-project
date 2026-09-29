# 4. Track A: Ground station (`dss` CLI and Python SDK)

The [`sdk/`](../../sdk) project is a Python 3.12 package called `uidss`. It installs a CLI named **`dss`**. It is the robot side's only interface to CDF:

- **Down:** fetch a Ready inspection plan and its reference map
- **Plan:** turn a CSV of findings from a detection pipeline into a Draft plan
- **Up:** push mission output (maps, structural elements, UT thickness, metrics, drone images)
- **Automatic:** `dss worker` builds the 3D model of every mesh that the robot (or anyone) uploads

Prerequisite: [chapter 3](03-setup-credentials.md) done (`sdk/.env` set up, `uv run dss plan list` works). All commands below are run from `sdk/`.

---

## Part 1: The CLI

Most commands are **interactive**. They walk you through vessel, then area, then plan or campaign with arrow-key pickers, and skip a picker when there's only one choice. `plan import-findings`, `campaign build-3d-model` and `worker` also take flags, so they can run unattended. Add `-v` for debug logging: `uv run dss -v plan list`.

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
      "radiusM": 0.3,
      "suggestionId": "finding:corr-001"  // only when the task came from a finding or suggestion
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
| `*.ply` with faces | Mesh file on the campaign (`cdfFileIds`) | Binary or ASCII triangle-mesh PLY, optional vertex/face colours |
| `*.ply` vertex-only | Point cloud on the campaign (`pcdFileIds` + label you type) | Converted to binary PCD on upload, per-vertex RGB preserved |
| `*.pcd` | Point cloud on the campaign (`pcdFileIds` + label you type) | PCL PCD. A `label` field is used to colour points in the viewer |
| `*.csv` | `NdtMeasurement` nodes | Columns `timestamp,thickness,x,y,z`. **timestamp in ns**, **thickness in metres** (stored ×1000 as mm) |
| `ssg.yaml` | `StructuralElement` nodes on the **area** | See below |
| `metrics.yaml` | `CampaignMetric` nodes | See below |

Coloured vertex-only PLY point clouds (for example D6.2's `ut_measurements_colored.ply` from the NDT registration pipeline) are accepted: the scanner classifies each `.ply` by its header, and a PLY without faces is converted to binary PCD on upload — colours preserved, named after the source (`ut_measurements_colored.pcd`) — so the web viewer renders it like any other point cloud.

What happens during the upload:
1. Pick vessel and area, then pick an existing campaign or **create a new one** (you're asked for the date, default today).
2. Confirm each file.
3. **After the PLY upload, each mesh is converted into its own CDF 3D model**, which is what the web viewer streams (it doesn't draw raw PLY files). This takes a few minutes and runs locally, then CDF processes the model (about 1 minute). Pass `--no-3d-model` to leave it to `dss worker` (1.4c), for example on a slow link, or build it later with `build-3d-model` (below).
4. At the end, optionally mark the campaign **Complete** and the Ready plan **Complete**.

Re-running on the same campaign **adds** files. Every upload creates a **new** `CogniteFile`, so re-uploading the same file duplicates it.

### 1.4b Build the 3D model for an existing campaign

```bash
uv run dss campaign build-3d-model                       # interactive pickers
uv run dss campaign build-3d-model --campaign result-…   # non-interactive
```

Builds the models of the campaign's mesh files that don't have one yet, one model per file, the same as `dss worker` but for one campaign and right now. For each mesh it downloads the PLY, converts it to an OBJ zip, bakes the camera colours into textures if the mesh has them, and builds a small decimated **collision proxy** the viewer uses for picking. It uploads both as CogniteFiles, creates the CDF 3D model, and writes the Core DM nodes `{file}-cad-model` / `{file}-cad-revision` that the viewer looks up ([chapter 2](02-data-model.md#3d-models-core-dm)). Meshes that already have a model, or that the campaign's legacy (campaign-keyed) model already shows, are skipped; classic files (no CogniteFile) are reported and skipped. Nothing existing is modified.

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

### 1.4c Automatic: the robot uploads, `dss worker` builds

```bash
uv run dss worker                        # all areas, check every 30 s
uv run dss worker --area area-… --poll 60
uv run dss worker --area area-… --once   # build what's missing, then exit
```

`dss worker` lists the uploaded mesh CogniteFiles (tag `ply_mesh`, optionally of one area) and builds the 3D model of each one that has none, oldest first, one at a time. **The upload is the trigger**: a mesh from the robot, from `dss campaign upload --no-3d-model` or from your own script gets its model whether or not it's in a campaign yet. The viewer picks the model up by itself (it polls while meshes are waiting).

- It skips meshes a legacy campaign model already shows, and re-checks just before creating a model, so a model built meanwhile by `dss campaign upload` isn't built twice.
- A failing mesh (for example a truncated PLY) is retried after 1, 2, 4… minutes (at most 1 hour) and given up after 5 attempts until the worker restarts. The other meshes are still built. A tick that can't reach CDF is logged and the next one runs.
- It also refreshes the status of models CDF is still processing, for example after a restart.

Run it at boot on the ground station. **systemd** (Linux), `/etc/systemd/system/dss-worker.service`:

```ini
[Unit]
Description=AutoAssess dss worker (builds 3D models of uploaded meshes)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/autoassess-ui-dss/sdk
ExecStart=/usr/local/bin/uv run dss worker --poll 30
Restart=always
RestartSec=30
User=autoassess

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now dss-worker`, logs with `journalctl -u dss-worker -f`. **launchd** (macOS), `~/Library/LaunchAgents/com.cognite.dss-worker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.cognite.dss-worker</string>
  <key>WorkingDirectory</key><string>/Users/you/autoassess-ui-dss/sdk</string>
  <key>ProgramArguments</key>
  <array><string>/opt/homebrew/bin/uv</string><string>run</string><string>dss</string><string>worker</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/dss-worker.log</string>
  <key>StandardErrorPath</key><string>/tmp/dss-worker.log</string>
</dict></plist>
```

`launchctl load ~/Library/LaunchAgents/com.cognite.dss-worker.plist`. The working directory must be `sdk/` so the worker finds `.env`; its service account needs write access to files, 3D and data modeling in the `autoassess` space.

**The robot side: `autoassess_bridge`.** The ROS node in the gbplanner_ros repo uploads the mission itself, with the same file conventions as `dss` (CogniteFile, tags `ply_mesh` + `area:<id>`, plus `plan:<id>` and `mission:<id>`). When it detects the end of a mission (a mission path, then homing, then no new path and the robot standing still), or when its `~upload_mission` service is called, it asks gbplanner for the mesh, uploads it and the `~mission_dir` files, and creates the campaign: `result-<uuid>`, today's date, `createdBy=autoassess_bridge`, `InProgress` and then `Complete` once every upload succeeded. It publishes its progress on `/autoassess/upload_status`. Uploads are off unless `~upload_enabled` is true; see the bridge's README for its parameters and credentials. It doesn't build models; `dss worker` does.

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

### 1.6 Create a plan from findings (CSV)

Automatic pipelines such as defect detection or change detection produce **points of interest**. `import-findings` turns a CSV of them into a **Draft** plan with one **region task** per finding:

```bash
# See what would be created; nothing is written
uv run dss plan import-findings findings.csv --area "BWT 3P" --dry-run

# Create the Draft plan
uv run dss plan import-findings findings.csv --area "BWT 3P" --name "Corrosion run 7" --yes

# Add a newer CSV to the same plan later: findings already in it are skipped
uv run dss plan import-findings findings-v2.csv --area "BWT 3P" --plan plan-6c1e… --yes
```

**CSV format** (header names are case-insensitive; unknown columns are ignored):

| Column | Required | Meaning |
|---|---|---|
| `x`, `y`, `z` | ✅ | Position in metres, in the **map campaign's frame** (the frame of `plan.json`) |
| `id` | | Stable finding ID. If it's missing, a hash of the row is used. Must not contain `+` |
| `nx`, `ny`, `nz` | | Surface normal: all three or none. Normalised on read |
| `radius` | | Task radius in metres (default `--radius`, 0.3) |
| `inspection_type` | | `visual` or `ndt_thickness` (default `--inspection-type`, visual) |
| `class` | | For example `corrosion`; used by `--class` |
| `confidence` | | 0 to 1; used by `--min-confidence`. Rows without one are kept |
| `description` | | Free text |

Only the position, normal, radius, inspection type and `suggestionId` are stored on a task (the task view has no other fields). `class`, `confidence` and `description` are for filtering and your own bookkeeping.

Sample: [`sdk/tests/fixtures/findings.csv`](../../sdk/tests/fixtures/findings.csv) (its coordinates fit the tutorial's test area).

```csv
id,x,y,z,nx,ny,nz,radius,inspection_type,class,confidence,description
corr-001,6.72,-0.16,0.17,,,,,,corrosion,0.92,Pitting on side shell
crack-001,1.83,-0.85,2.12,-1,0,0,,,crack,0.81,Weld toe crack
pit-001,7.33,-1.55,-3.00,,,,0.4,ndt_thickness,pitting,0.77,Deep pit - measure thickness
```

What happens:
1. **Validate.** Each bad row is reported with its line number and skipped. `--strict` makes any bad row fatal.
2. **Filter** with `--min-confidence 0.5` and `--class corrosion` (repeatable).
3. **Merge** findings within `--merge-radius` (default 0.5 m, `0` turns it off) into one task. The task sits at the mean position and its radius covers every member. It is `ndt_thickness` if any member needs a thickness measurement. Findings whose normals face away from each other (two sides of a plate) are not merged.
4. **Normals.** Rows with `nx,ny,nz` keep theirs. For the rest, `--normals model` (the default) takes the nearest surface of the map campaign's 3D model (its collision proxy, within 1 m), oriented into the tank. If there is no model yet, or no surface nearby, the normal points from the finding towards the area's centre. `--normals centre` always does that, and `--normals require` rejects rows without a normal.
5. **Skip what's there.** Each task gets `suggestionId = finding:<id>` (`finding:<id1>+<id2>` for a merged task). With `--plan`, findings already named by a task in that plan are skipped, so re-running the same CSV adds nothing.
6. **Write** after you confirm (`--yes` skips the question): a new Draft plan, or the existing Draft plan passed with `--plan`. The map is `--map <campaign>`, else the newest **Complete** campaign of the area (you get a picker if there are several and you didn't pass `--yes`). With `--plan`, the plan's own map is used.

The command never marks the plan Ready and never changes existing tasks. Open the plan in the viewer, check the tasks sit on the findings, and mark it Ready there.

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
| `client.plans` | `list(area_space, area_eid)`, `list_tasks(plan_eid)`, `count_tasks([eids])`, `download(space, eid, area_name, output_path)`, `update_status(space, eid, "Draft"\|"Ready"\|"Complete")`, `create(area_eid, map_eid, name, description) -> eid` (Draft), `add_region_tasks(plan_eid, [NewRegionTask]) -> [task_eid]` |
| `client.campaigns` | `list(area_space, area_eid)`, `get(space, eid)`, `create(area_eid, "YYYY-MM-DD") -> eid`, `update_file_ids(space, eid, ply_ids, pcd_ids, pcd_labels)` ⚠️ overwrites, `complete(space, eid)`, `download_map(space, eid, out_dir)`, `download_collision_proxies(campaign_eid, out_dir) -> [Path]` (one per 3D model the campaign shows) |
| `client.artifacts` | `upload_ply(path, area_eid) -> file_id`, `upload_pcd(path, area_eid, label) -> file_id`, `list_mesh_files(area_eid=None) -> [MeshFile]`, `get_mesh_files([file_id]) -> [MeshFile]`, `download(mesh, out_dir) -> Path` |
| `client.threed` | `find_models_for_files([file_xid]) -> {file_xid: CadModel}`, `find_campaign_models([campaign_eid])` (legacy), `create_cad_model_for_file(...)`, `wait_until_processed(model)`; build one with `uidss.threed.pipeline.build_file_cad_model(ply, mesh, client.threed, work_dir)`, or run `uidss.worker.ModelWorker` |
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

### Example: a Draft plan from a findings CSV

What `dss plan import-findings` does, for a pipeline that runs without prompts. [`uidss.findings`](../../sdk/src/uidss/findings.py) is pure (no CDF calls), so you can also build the task list from your own data by creating `Finding(id=…, position=(x, y, z))` objects directly.

```python
import tempfile
from pathlib import Path

from uidss import UidssClient
from uidss.findings import filter_findings, plan_tasks_from_findings, read_findings_csv
from uidss.threed.ply import merge_meshes, read_ply

client = UidssClient.from_env()
AREA_EID = "area-01581"
MAP_EID = "result-9ab2…"                      # the Complete campaign whose frame the CSV uses

findings, row_errors = read_findings_csv(Path("findings.csv"))
for err in row_errors:
    print(f"line {err.line}: {err.message}")
findings = filter_findings(findings, min_confidence=0.5)

with tempfile.TemporaryDirectory() as tmp:     # the 3D models' collision proxies, for normals
    proxies = client.campaigns.download_collision_proxies(MAP_EID, Path(tmp))
    mesh = merge_meshes([read_ply(p) for p in proxies]) if proxies else None

result = plan_tasks_from_findings(findings, mesh=mesh, merge_radius_m=0.5)
print(f"{len(result.tasks)} tasks, {result.count('model')} normals from the model")

plan_eid = client.plans.create(AREA_EID, MAP_EID, "Corrosion run 7", "From the detector")
client.plans.add_region_tasks(plan_eid, [t.task for t in result.tasks])
```

To add to an existing Draft plan without duplicates, pass `existing_suggestion_ids=[t.suggestion_id for t in client.plans.list_tasks(plan_eid) if t.suggestion_id]` to `plan_tasks_from_findings`.

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
✅ `just test` runs with no network access. At the time of writing, ~434 tests pass and 2 fail in `tests/unit/test_vessel_area_service.py`. Those two are known and unrelated to your changes.

Where to add things:
- New CLI command: [`sdk/src/uidss/cli/main.py`](../../sdk/src/uidss/cli/main.py) (Typer), prompts in `cli/selectors.py`
- New CDF entity or behaviour: a service in `sdk/src/uidss/services/`, a dataclass in `models.py`, then wire it into `client.py`
- New file type in mission folders: [`sdk/src/uidss/cli/file_scanner.py`](../../sdk/src/uidss/cli/file_scanner.py)

**Next:** [7. End-to-end exercise →](07-end-to-end-exercise.md)
