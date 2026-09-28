---
name: python-code-quality
description: "MUST be used whenever reviewing the uidss-sdk Python package (sdk/) for code quality, maintainability, or clean code issues — before a PR review, after a feature is complete, or when the user asks for a code review of sdk/. Triggers: code quality, code review, clean code, refactor, maintainability, technical debt, Any type, type: ignore, naming, dead code, duplication, DRY, single responsibility, module size, lint, linting."
allowed-tools: Read, Glob, Grep, Bash, Write
metadata:
  argument-hint: "[file or directory under sdk/ to review, or leave blank to review the whole sdk/ package]"
---

# Python Code Quality Review (sdk/)

Review **$ARGUMENTS** (or all of `sdk/` if no argument is given) for code quality issues. Work
through every step in order and report all findings with file paths and line numbers. Run every
command from inside `sdk/`.

---

## Step 1 — Run the tools first

```bash
cd sdk
uv run ruff check .
uv run ruff format --check .
uv run ty check
```

List every error and warning. Fix all errors before proceeding — tool errors are not negotiable.
Do not skip to manual review until the tools are clean.

---

## Step 2 — Eliminate `Any` and `# type: ignore`

```bash
grep -rn --include="*.py" -E ": Any|-> Any|# type: ignore" src/ tests/
```

For each hit, replace with the correct type. Common substitutions:

| Instead of | Use |
|---|---|
| `Any` for unknown external data | `object` + type guard, or a specific dataclass/Pydantic model |
| `Any` for CDF node property dicts | `dict[str, object]`, or map through `_map_node`/`_map_plan_node` |
| `# type: ignore` | Fix the underlying type error; only suppress with a specific code and a comment explaining why (e.g. `UidssSettings()  # type: ignore[call-arg]` — pydantic-settings loads required fields from env) |

Goal: zero `Any` and zero bare `# type: ignore` in `src/`.

---

## Step 3 — Check module size and single responsibility

```bash
find src/ tests/ -name "*.py" | xargs wc -l | sort -rn | head -20
```

Flag every module over **200 lines**. For each, check:
- Does it do more than one thing? (e.g. CDF calls mixed with CLI prompting)
- Can a class be extracted?
- Can a group of related functions move to a helper module?

Split only when it creates a genuinely cleaner separation — a well-named 250-line module is
better than three poorly-named 80-line ones.

---

## Step 4 — Find duplicate logic (DRY)

```bash
# Repeated CDF Files-upload patterns
grep -rn --include="*.py" -E "\.files\.upload\(|instances\.apply\(" src/uidss/services/

# Repeated externalId construction
grep -rn --include="*.py" -E 'f"result-|f"drone-image-|f"plan-' src/

# Repeated pose/quaternion math (a known duplication risk between drone_image_service.py
# and any future TS-side port — see sdk/AGENTS.md)
grep -rn --include="*.py" -E "_slerp|_lerp|_apply_t_bs|_pose_to_mat4" src/
```

For each set of duplicates, extract to a shared helper function within the same service file
(never a cross-service shared module — per `sdk/AGENTS.md`, "Never reference `CdfXService`
outside `x_service.py`" implies the reverse too: don't create a grab-bag `utils.py` that several
services import from — prefer duplicating a two-line helper over introducing a shared coupling
point, unless the duplication is truly substantial).

---

## Step 5 — Check naming conventions

| Artifact | Convention | Example |
|---|---|---|
| Modules and packages | `snake_case` | `campaign_service.py` |
| Classes | `PascalCase` | `CdfCampaignService`, `UidssSettings` |
| Functions and variables | `snake_case` | `make_cognite_client`, `campaign_external_id` |
| Constants (module-level) | `SCREAMING_SNAKE_CASE` | `DRONE_IMAGE_VIEW`, `_CHUNK` |
| Boolean-returning methods | Auxiliary verb prefix or `is_`/`has_` | `is_azure_ad()`, `has_ply` |
| Protocol classes | `PascalCase` + `Protocol` suffix | `PlanServiceProtocol` |

```bash
# Find classes not in PascalCase
grep -rn --include="*.py" -E "^class [a-z]" src/

# Find functions starting with capital letters
grep -rn --include="*.py" -E "^def [A-Z]" src/
```

---

## Step 6 — Remove dead code

```bash
# Debug print statements (forbidden — must use structlog per sdk/AGENTS.md)
grep -rn --include="*.py" -E "^\s*print\(" src/

# Commented-out code blocks (3+ consecutive comment lines)
grep -rn --include="*.py" -c "^\s*#" src/ | grep -v ":0$" | sort -t: -k2 -rn | head -20

# TODO / FIXME / HACK
grep -rn --include="*.py" -E "(TODO|FIXME|HACK|XXX):" src/ tests/
```

Rules:
- `print()` must be replaced with `structlog.get_logger()` calls.
- Commented-out code blocks must be removed — git preserves history.
- `TODO` comments must reference a known issue or be resolved.
- Also check for stale bookkeeping like an "Implementation Stages" checklist going out of date —
  `sdk/AGENTS.md` used to have one that no longer matched reality; prefer no checklist over a
  stale one.

---

## Step 7 — Verify file structure

The expected layout is:

```
sdk/src/uidss/
  __init__.py         — SDK facade re-exports (UidssClient) only
  auth.py             — make_cognite_client() — OAuth client construction only
  client.py           — UidssClient facade — composes services, no business logic
  config.py           — UidssSettings (pydantic-settings) only
  models.py           — frozen dataclasses, one per CDF view, no logic
  cdf/
    data_model.py      — space/container/view constants + view_id/view_key helpers only
  cli/
    main.py             — Typer commands — orchestration only, no CDF calls made directly
    file_scanner.py     — folder-scanning logic only
    selectors.py        — interactive `questionary` prompts only
  services/
    <name>_service.py   — one CdfXService per resource: a Protocol + a @dataclass
                           implementation wrapping CogniteClient, never referenced
                           outside its own file
```

Flag: business logic in `cli/main.py` (it should call into a service, not build `NodeApply`s
itself), CDF calls inside `cli/selectors.py` or `cli/file_scanner.py`, or a service importing
another service module directly (services compose only via the CLI/`UidssClient`, not each other).

---

## Step 8 — Report findings

| Category | File | Line | Issue | Recommendation |
|---|---|---|---|---|
| Type | `src/uidss/services/plan_service.py` | 42 | `response: Any` | Use the mapped model type, or `dict[str, object]` with a type guard |
| Size | `src/uidss/cli/main.py` | — | 280 lines | Extract `campaign_upload`'s file-role-assignment loop to a helper |
| DRY | `services/artifact_service.py:24`, `services/drone_image_service.py:287` | — | Both call `files.upload(...)` with near-identical kwargs | Extract a shared `_upload_file()` helper in whichever file is more central, or accept the duplication if it's genuinely this small |
| Naming | `services/plan_service.py` | 12 | `GetToken()` — function in PascalCase | Rename to `get_token()` |
| Dead | `cli/main.py` | 88 | `print("debug", response)` | Replace with `log.debug(...)` |

If no issues are found in a step, state "No issues found" for that step. Do not skip steps
silently.

---

## Done

Summarize findings by category. Any tool error (`ruff`, `ty`) must be listed as blocking and
fixed first.
