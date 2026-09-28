---
name: python-testing
description: "Use when writing, reviewing, or improving tests for the uidss-sdk Python package (sdk/). Enforces test-first discipline, Protocol-stub unit tests, and property-based testing with hypothesis. Triggers: write test, add test, test coverage, test first, TDD, hypothesis, property-based, parametrize, fixture, stub, integration test, missing test."
allowed-tools: Read, Glob, Grep, Bash, Write
metadata:
  argument-hint: "[function, class, or module under sdk/ to test, e.g. 'CdfCampaignService.update_file_ids' or 'sdk/src/uidss/services/campaign_service.py']"
---

# Test-First Workflow (sdk/)

Tests for `uidss-sdk` follow three types, in priority order (per `sdk/AGENTS.md`):

1. **Property-based** (`hypothesis`) — for data mapping, label computation, externalId
   generation. Default for anything with a wide input domain (e.g. `is_azure_ad()`'s UUID
   detection).
2. **Table-driven** (`@pytest.mark.parametrize`) — for status validation, auth URL selection,
   or any function with a small, enumerable set of interesting cases.
3. **Example-based** — for service happy-path and error cases.

**Write the test first. Run `just test` from inside `sdk/` — it must go red. Then write the
implementation until it goes green.**

Every service file (`services/<name>_service.py`) must have a matching
`tests/unit/test_<name>_service.py` in the same changeset.

---

## Step 1 — Prefer Protocol stubs over mocking a CDF client

Per `sdk/AGENTS.md`, prefer Protocol stub classes over `unittest.mock.patch`, passed via
constructor injection:

```python
class StubPlanService:
    def list(self, area_id: str, status: str | None = None) -> list[InspectionPlan]:
        return [mock_plan()]
```

For code that talks directly to `CogniteClient` (i.e. inside a `CdfXService` itself, not its
callers), the existing convention in this codebase is a `MagicMock()` standing in for
`CogniteClient`, with only the specific `data_modeling.instances.*` methods configured — see
`tests/unit/test_campaign_service.py`'s `_make_client()` helper. Use that pattern (not `patch`)
when testing a service's own CDF-calling logic.

---

## Step 2 — Write the test

### For a pure function with a wide input domain (property-based — default)

```python
# tests/unit/test_auth.py — real example from this codebase
from hypothesis import given
from hypothesis import strategies as st

from uidss.config import UidssSettings

def make_settings(**overrides: str) -> UidssSettings:
    base = {
        "project": "test-project", "cluster": "westeurope-1", "tenant_id": "test-org",
        "client_id": "test-client-id", "client_secret": "test-secret",
    }
    return UidssSettings.model_validate({**base, **overrides})

@given(st.uuids().map(str))
def test_any_uuid_is_azure_ad(uuid_str: str) -> None:
    settings = make_settings(tenant_id=uuid_str)
    assert settings.is_azure_ad() is True
```

### For a small, enumerable set of cases (table-driven)

```python
@pytest.mark.parametrize(
    ("tenant_id", "expected"),
    [
        ("cog-autoassess", False),
        ("my-org", False),
        ("550e8400-e29b-41d4-a716-446655440000", True),
        ("550E8400-E29B-41D4-A716-446655440000", True),  # uppercase
    ],
)
def test_uuid_detection(tenant_id: str, expected: bool) -> None:
    assert make_settings(tenant_id=tenant_id).is_azure_ad() == expected
```

### For a service that calls CogniteClient (example-based, MagicMock client)

```python
# tests/unit/test_campaign_service.py — real example from this codebase
def _make_client(
    list_nodes: list[MagicMock] | None = None,
    retrieve_node: MagicMock | None = None,
) -> MagicMock:
    client = MagicMock()
    resp = MagicMock()
    resp.__iter__ = MagicMock(return_value=iter(list_nodes or []))
    client.data_modeling.instances.list.return_value = resp
    client.data_modeling.instances.retrieve.return_value.nodes = (
        [retrieve_node] if retrieve_node is not None else []
    )
    return client

def test_appends_to_existing_file_ids_instead_of_overwriting() -> None:
    existing = _make_node("result-001", {"cdfFileIds": [1], "pcdFileIds": [2], "pcdFileLabels": ["Existing"]})
    client = _make_client(retrieve_node=existing)
    CdfCampaignService(client).update_file_ids(SPACE, "result-001", [10], [30], ["New"])
    props = client.data_modeling.instances.apply.call_args.kwargs["nodes"][0].sources[0].properties
    assert props["cdfFileIds"] == [1, 10]
```

### For a CLI command's supporting logic (file_scanner, selectors)

```python
# tests/unit/test_file_scanner.py-style — pure functions, no CDF, no mocking needed
def test_scan_folder_finds_ssg_yaml_but_not_metadata_yaml(tmp_path: Path) -> None:
    (tmp_path / "ssg.yaml").touch()
    (tmp_path / "metadata.yaml").touch()
    scanned = scan_folder(tmp_path)
    assert scanned.ssg_yaml == tmp_path / "ssg.yaml"
```

---

## Step 3 — Run the test (expect red)

```bash
cd sdk && uv run pytest tests/unit/test_<name>.py -v
```

Confirm the test fails with a meaningful error (import error or assertion failure) — not a
collection error. A collection error means there is a syntax problem in the test itself.

---

## Step 4 — Write the implementation

Write the minimum code to make the test pass. Do not add behaviour that no test covers.

---

## Step 5 — Run again (expect green)

```bash
cd sdk && just test
```

All tests must pass. Then run `just check` — the new code must have no lint or type errors.

---

## Step 6 — Check coverage

```bash
cd sdk && just coverage
```

Coverage is a health signal, not a target. Low coverage on a service mapper means edge cases
are untested. Low coverage on `cli/main.py`'s Typer commands is expected — they're thin
orchestration and are exercised more meaningfully by integration tests than by unit tests.

---

## Step 7 — Integration tests

Integration tests live in `sdk/tests/integration/` and are always skipped unless
`INTEGRATION_TESTS=1` is set (enforced by `tests/conftest.py`'s
`pytest_collection_modifyitems`):

```python
# tests/integration/test_plan_roundtrip.py — real example in this codebase
def test_download_then_reupload_roundtrips(cdf_client: CogniteClient) -> None:
    ...
```

Run integration tests:
```bash
cd sdk && INTEGRATION_TESTS=1 just test-all
```

Integration tests require real CDF credentials (`sdk/.env`) and must not leave permanent side
effects — clean up any nodes/files they create.

---

## Fixtures reference

| Fixture / file | Location | Purpose |
|---|---|---|
| `minimal_env` (autouse) | `tests/conftest.py` | Sets fake `COGNITE_*` env vars, isolates every test from real shell credentials |
| `tests/fixtures/drone_images/` | `tests/fixtures/` | Sample TUM-format dataset (`rgb.txt`, `groundtruth.txt`, `rgb/`, `sensor.yaml`) for `CdfDroneImageService` tests |
| `tests/fixtures/ssg.yaml` | `tests/fixtures/` | Sample structural-element definitions for `CdfStructuralElementService` tests |
| `tests/fixtures/metrics.yaml` | `tests/fixtures/` | Sample campaign metrics for `CdfCampaignMetricService` tests |
| `tests/fixtures/ut_global_registered.csv` | `tests/fixtures/` | Sample UT/NDT measurement CSV for `CdfNdtMeasurementService` tests |
