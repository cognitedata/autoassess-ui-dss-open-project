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

---

### `dss campaign` — Mission upload commands

#### Upload mission artifacts

```bash
dss campaign upload <folder>
```

Scans `<folder>` for mission output files and walks you through an interactive upload:

| File type | What happens |
|-----------|--------------|
| `*.ply` | Uploaded as a PLY mesh artifact |
| `*.pcd` | Uploaded as a PCD point cloud (you provide a label) |
| `*.csv` | UTM measurements upserted to CDF |
| `ssg.yaml` | Structural elements upserted to CDF |
| `metrics.yaml` | Campaign metrics upserted to CDF |

You are prompted to select or create a campaign, confirm each upload step, and optionally mark the campaign and/or plan as **Complete** at the end.

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
`ndt_measurement_service`, and `drone_image_service`. CDF space/container/view constants live in
`src/uidss/cdf/data_model.py` (see the sync note above).
