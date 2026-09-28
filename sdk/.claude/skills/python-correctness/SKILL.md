---
name: python-correctness
description: "MUST be used whenever reviewing the uidss-sdk Python package (sdk/) for bugs, missing error handling, unhandled exceptions, or incorrect edge-case behaviour. Triggers: correctness, error handling, bug, edge case, crash, unhandled exception, bare except, None check, Optional, pagination, empty list, retry, robustness, silent failure."
allowed-tools: Read, Glob, Grep, Bash, Write
metadata:
  argument-hint: "[file or directory under sdk/ to review, or leave blank to review the whole sdk/ package]"
---

# Correctness & Error Handling Review (sdk/)

Review **$ARGUMENTS** (or all of `sdk/` if no argument is given) for correctness issues and
missing error handling. Work through every step and report all findings with file paths and
line numbers.

Note: `uidss-sdk` is a request/response CLI (`dss`), not a long-running poller — there is no
checkpoint/state-store to audit. Every command talks to CDF once per invocation and exits.

---

## Step 1 — Map the data flows

Read these files before checking anything else:

- `src/uidss/config.py` — `UidssSettings`, env var loading and derived properties (`is_azure_ad()`, `token_url()`, `cdf_base_url()`)
- `src/uidss/auth.py` — `make_cognite_client()`, OAuth token acquisition
- `src/uidss/cli/main.py` — command orchestration: `plan list`, `plan download`, `campaign upload`, `campaign upload-drone-images`
- `src/uidss/cli/file_scanner.py` — folder scanning (`.ply`/`.pcd`/`.csv`/`ssg.yaml`/`metrics.yaml` detection)
- `src/uidss/services/*.py` — every actual CDF read/write

For each CDF call, note:
- What happens when it fails (network timeout, 401, 404, 429, 5xx)?
- What happens when the result is empty (no vessels, no areas, no plans, no matching files in a folder)?
- What happens when the user cancels an interactive prompt (`questionary` returns `None` on Ctrl-C)?

---

## Step 2 — Audit exception handling

```bash
grep -rn --include="*.py" -E "except\s*:" src/
grep -rn --include="*.py" -A 2 "except Exception" src/
grep -rn --include="*.py" -A 1 "except" src/ | grep -E "^\s*(pass|\.\.\.)"
```

Rules (per `sdk/AGENTS.md`):
- No bare `except:` — always catch a specific type.
- No swallowed exceptions — every `except` block must either re-raise, log and re-raise, or log
  and return a sentinel the caller handles.
- `tenacity` retries (if used) must have `reraise=True` or an explicit `after` callback so final
  failures are logged, not silently exhausted.

---

## Step 3 — Verify CDF node properties are mapped through a typed model

Raw `node.properties` dicts must never leak past a service boundary — every `services/*.py`
module has a `_map_node`/`_map_plan_node`/`_map_task_node`-style function that converts a raw
node into a frozen dataclass from `models.py`:

```bash
# Find CLI or test code reaching into raw .properties instead of using a mapped model
grep -rn --include="*.py" -E "\.properties\[" src/uidss/cli/
```

```python
# GOOD — services/campaign_service.py
return _map_node(response.nodes[0])

# BAD — reading raw properties outside the service that owns the mapping
campaign_date = node.properties[view_id(INSPECTION_RESULT_VIEW)]["campaignDate"]
```

---

## Step 4 — Check Optional field safety

```bash
grep -rn --include="*.py" -E "\.\w+\.\w+" src/uidss/services/
```

For each chained attribute access, verify the intermediate value cannot be `None`. In particular:
- `InspectionTask.target_element` is `ElementTarget | None` — every read must guard it (see
  `plan_service.py`'s `_map_task_node`, which only resolves `target_element` when `kind == "element"`).
- `--sensor-yaml` in `campaign upload-drone-images` is optional — `_resolve_sensor_yaml()` must
  raise a clear `FileNotFoundError`, not `None`-propagate, when no sensor YAML can be found.

```python
# BAD — crashes if target_element is None
radius = task.target_element.element_type

# GOOD
radius = task.target_element.element_type if task.target_element is not None else None
```

---

## Step 5 — Verify pagination correctness

Every `instances.list()` call must loop until `cursor` is `None`:

```bash
grep -rn --include="*.py" -B 2 -A 10 "cursor" src/uidss/services/
```

For each pagination loop, verify:
- The loop condition checks `cursor is not None`, not `len(results) > 0`.
- The cursor is passed correctly on each subsequent request.
- There is no unbounded loop without a way to terminate if CDF ever returns a non-`None` cursor
  indefinitely (defensive, but worth a glance for any hand-rolled loop that isn't the standard
  `while True: ... if cursor is None: break` shape used elsewhere in `services/`).

---

## Step 6 — Check edge cases

For each major code path, verify behaviour when:

| Scenario | Expected behaviour |
|---|---|
| Vessel has zero areas | `pick_area()` gets an empty list — must not crash the picker |
| Area has zero plans | `plan list` prints "No plans found for `<area>`" and returns, no exception |
| Mission folder has no `.ply`/`.pcd`/`.csv`/`ssg.yaml`/`metrics.yaml` | `missing_type_notes()` reports every missing type; `campaign upload` still runs (just uploads nothing) |
| `campaign upload` run twice on the same campaign | `update_file_ids` is a plain overwrite, so `campaign_upload` in `cli/main.py` must seed its `ply_file_ids`/`pcd_file_ids`/`pcd_file_labels` accumulators from `existing_campaign`'s current state before appending new uploads — a real bug existed here where the second run's ids clobbered the first run's |
| Sensor YAML has fewer than 16 `T_BS` values | `parse_sensor_yaml()` raises `ValueError` with a clear message, not an `IndexError` |
| CDF `instances.apply()` returns a partial error | Error propagates (the SDK's own exception type); no partial-success is silently treated as full success |
| User cancels a `questionary` prompt (Ctrl-C) | `confirm()`/`pick_*()` return `None`/default rather than raising an unhandled `KeyboardInterrupt` mid-upload |

---

## Step 7 — Report findings

| Severity | File | Line | Issue | Recommendation |
|---|---|---|---|---|
| HIGH | `services/drone_image_service.py` | 273 | `_resolve_sensor_yaml` raises generic `FileNotFoundError` with no candidate list on some inputs | Confirm the message always lists both checked candidate paths |
| MEDIUM | `cli/main.py` | 233 | `plans_svc.list(...)` re-fetched after upload instead of reusing `plans` from earlier in the function | Reuse instead of re-fetching, or explicitly comment why a fresh read is needed (status may have changed) |
| LOW | `services/campaign_service.py` | 106 | `_retrieve` swallows a not-found node into an empty-defaults `InspectionResult` rather than raising | Confirm this is intentional (append-to-nothing is a valid state) — if so, a one-line comment would help |

If no issues are found in a step, state "No issues found" for that step. Do not skip steps
silently.

---

## Done

Summarize by severity. Flag any HIGH issues that could cause data loss (e.g. the append-not-
overwrite campaign file-id bug class), silent failures, or crashes mid-upload.
