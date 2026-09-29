# UIDSS SDK

Python SDK and CLI (`dss`) for the AutoAssess ground station. Provides two operations:

1. **Download inspection plans** from CDF so the ground station knows what to execute.
2. **Upload mission artifacts** (PLY/PCD maps, structural element data, UTM measurements, drone images) back to CDF after a flight.

> **Data model sync:** `src/uidss/cdf/data_model.py` mirrors the root TS app's
> [`../src/shared/cdf/dataModel.ts`](../src/shared/cdf/dataModel.ts), which is the authoritative
> source. If you change one, update the other and bump view versions to match. See
> [`AGENTS.md`](AGENTS.md) for the full rule.

---

## Installation

```bash
cd sdk
uv sync
```

Requires Python 3.12 (pinned in `.python-version`).

---

## Configuration

All settings are read from environment variables (or a `.env` file in the working directory), prefixed with `COGNITE_`:

```dotenv
COGNITE_PROJECT=my-project
COGNITE_CLUSTER=api
COGNITE_TENANT_ID=<azure-ad-tenant-uuid-or-cognite-idp-id>
COGNITE_CLIENT_ID=<service-account-client-id>
COGNITE_CLIENT_SECRET=<service-account-client-secret>
```

---

## CLI Usage

### Global flags

```
dss [--verbose | -v] <command>
```

`-v` enables debug logging.

---

### `dss plan` — Inspection plan commands

#### List plans for an area

```bash
dss plan list
```

Interactively prompts you to select a vessel and area, then prints a table of all plans with their status, creation date, and task count.

#### Download a plan

```bash
dss plan download
dss plan download --output-dir /path/to/dir
```

Prompts for vessel → area → plan, then writes `<plan-external-id>.json` to the output directory (defaults to the current directory).

#### Create a Draft plan from a CSV of findings

```bash
dss plan import-findings findings.csv --area "BWT 3P" --dry-run      # show the tasks, write nothing
dss plan import-findings findings.csv --area "BWT 3P" --yes          # create a new Draft plan
dss plan import-findings more.csv --area "BWT 3P" --plan plan-… --yes  # add to a Draft plan
```

Turns points of interest from a detection pipeline into one region task per finding. Columns:
`x,y,z` (required, metres, in the map campaign's frame), and optionally `id`, `nx,ny,nz`, `radius`,
`inspection_type` (`visual` | `ndt_thickness`), `class`, `confidence` (0 to 1), `description`.
Findings within `--merge-radius` (0.5 m) are merged. Missing normals come from the map campaign's
3D model (`--normals model|centre|require`). Each task gets `suggestionId = finding:<id>`, so
re-importing into the same `--plan` skips what is already there. Other flags: `--vessel`, `--map`,
`--name`, `--min-confidence`, `--class`, `--radius`, `--inspection-type`, `--strict`. It never marks
the plan Ready. Sample CSV: [`tests/fixtures/findings.csv`](tests/fixtures/findings.csv). Python API:
`uidss.findings.plan_tasks_from_findings` with `client.plans.create` / `client.plans.add_region_tasks`.

---

### `dss worker` — Build 3D models automatically

```bash
dss worker [--area <area external id>] [--poll 30] [--once]
```

Watches the uploaded mesh CogniteFiles (tag `ply_mesh`) and builds the CDF 3D model of each one that has none (`{file}-cad-model`), one at a time. The robot's `autoassess_bridge` and `dss campaign upload --no-3d-model` only upload; the worker does the rest. Failing meshes are retried with backoff and given up after 5 attempts. Run it at boot (systemd/launchd examples in [the tutorial, chapter 4](../docs/tutorial/04-ground-station-sdk.md#14c-automatic-the-robot-uploads-dss-worker-builds)). `dss campaign build-3d-model --campaign <id>` does the same for one campaign, right away.

---

### `dss campaign` — Mission upload commands

#### Upload mission artifacts

```bash
dss campaign upload <folder>
```

Scans `<folder>` for mission output files and walks you through an interactive upload:

| File type | What happens |
|-----------|--------------|
| `*.ply` (with faces) | Uploaded as a PLY mesh artifact |
| `*.ply` (vertex-only) | Converted to binary PCD (colours preserved) and uploaded as a point cloud |
| `*.pcd` | Uploaded as a PCD point cloud (you provide a label) |
| `*.csv` | UTM measurements upserted to CDF |
| `ssg.yaml` | Structural elements upserted to CDF |
| `metrics.yaml` | Campaign metrics upserted to CDF |

You are prompted to select or create a campaign, confirm each upload step, and optionally mark the campaign and/or plan as **Complete** at the end.

Each `.ply` is classified by its header: one with a `face` element is a mesh; a **vertex-only PLY point cloud** — for example D6.2's `ut_measurements_colored.ply` from the NDT registration pipeline — is accepted too, converted to binary PCD on upload (per-vertex RGB colours preserved, named after the source, e.g. `ut_measurements_colored.pcd`) and shown in the viewer's Layers panel like any other point cloud.

**Example:**

```bash
dss campaign upload ~/missions/2024-06-30-hull-survey/
```

#### Upload drone images

```bash
dss campaign upload-drone-images <folder>
dss campaign upload-drone-images <folder> --sensor-yaml /path/to/sensor.yaml
```

Uploads a TUM-format dataset (expects `rgb.txt`, `groundtruth.txt`, and an `rgb/` subdirectory) to an existing or new campaign. The sensor YAML is auto-detected from the folder if not specified with `--sensor-yaml`.

**Example:**

```bash
dss campaign upload-drone-images ~/missions/2024-06-30-hull-survey/tum_dataset/
```

---

## Development

| Tool | Command | Purpose |
| --- | --- | --- |
| uv | `uv sync` (or `just sync`) | Install dependencies |
| just | `just check` | Lint + format check + type-check — must pass before every commit |
| ruff | `just fix` | Auto-fix lint issues and format |
| pytest | `just test` | Unit tests only (no CDF credentials needed) |
| pytest | `just test-all` | Unit + integration tests (`INTEGRATION_TESTS=1`, needs real `.env` credentials) |
| pytest-cov | `just coverage` | Unit tests with coverage report |

See [`AGENTS.md`](AGENTS.md) for the full coding standards (dependency injection via Protocols,
test-first workflow, CDF interaction guidelines).

---

## Architecture

`UidssClient.from_env()` is the main entry point — a dataclass facade with one field per service,
each defined behind a `Protocol` and injected rather than hard-coded (see `AGENTS.md`). Services
live in `src/uidss/services/`: `plan_service`, `vessel_service`, `area_service`,
`structural_element_service`, `artifact_service`, `campaign_service`, `campaign_metric_service`,
`ndt_measurement_service`, `drone_image_service`, and `threed_service`. `src/uidss/findings.py` (with
`threed/normals.py`) is the pure findings → region tasks logic behind `plan import-findings`. CDF
space/container/view constants live in
`src/uidss/cdf/data_model.py` (see the sync note above).
