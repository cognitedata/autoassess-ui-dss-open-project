# UIDSS SDK — Coding Standards

This is the Python half of the `autoassess-uidss` repo — see the root [`AGENTS.md`](../AGENTS.md) for
the repository-wide layout. Everything below applies only to files under `sdk/`.

## Project Purpose

Python SDK and CLI (`dss`) for the AutoAssess ground station. Provides two operations:

1. **Download inspection plans** from CDF so the ground station knows what to execute.
2. **Upload mission artifacts** (PLY/PCD maps, structural element data) back to CDF after a flight.

The TS app at the root of this repo is the authoritative source for all CDF data model definitions.
The constants in `src/uidss/cdf/data_model.py` **must mirror** [`../src/shared/cdf/dataModel.ts`](../src/shared/cdf/dataModel.ts) exactly. When that file changes, update `data_model.py` to match and bump view versions accordingly.

---

## Tooling

| Tool | Command | Purpose |
|------|---------|---------|
| uv | `uv sync` | Install deps (use `just sync`) |
| just | `just check` | Lint + type-check (must pass before commit) |
| ruff | `just fix` | Auto-fix lint and format |
| ty | via `just check` | Type checking |
| pytest | `just test` | Unit tests (no CDF required) |
| pytest | `just test-all` | All tests including integration |

`just check` must pass with zero errors before every commit.

---

## Code Style

- **Type annotations on every function** — no bare `def f(x):`
- **No bare `except`** — always catch specific exceptions
- **No `print()`** — use `structlog` (`log = structlog.get_logger()`)
- **`pydantic.SecretStr`** for `client_secret` in `UidssSettings`
- **No `Any`** unless truly unavoidable; never `# type: ignore` without a comment explaining why
- Line length: 100 characters

---

## Architecture

### Dependency Injection via Protocols

```python
class PlanServiceProtocol(Protocol):
    def list(self, area_id: str, status: str | None = None) -> list[InspectionPlan]: ...

@dataclass
class CdfPlanService:
    _client: CogniteClient
    # Never reference CdfPlanService outside plan_service.py
```

### Factory override for testing

```python
@dataclass
class UidssClient:
    _plan_service: PlanServiceProtocol
    ...

    @classmethod
    def from_env(cls) -> "UidssClient":
        cdf = make_cognite_client()
        return cls(_plan_service=CdfPlanService(cdf), ...)
```

### No hard-coded dependencies — inject everything.

---

## Testing Philosophy

Write tests **before** implementation for all non-trivial behaviour.

### Test types (in preference order)

1. **Property-based** (`hypothesis`) — for data mapping, label computation, externalId generation
2. **Table-driven** (`@pytest.mark.parametrize`) — for status validation, auth URL selection
3. **Example-based** — for service happy-path and error cases

### Test-first for services

Each service file must have a `tests/unit/test_<name>.py` in the same changeset.

### Integration tests

Guard with `INTEGRATION_TESTS=1`. Run with `just test-all`. Require `.env` with real credentials.

### Mocking style

Prefer Protocol stub classes over `unittest.mock.patch`. Pass stubs via constructor injection.

```python
class StubPlanService:
    def list(self, area_id: str, status: str | None = None) -> list[InspectionPlan]:
        return [mock_plan()]
```

Use `pytest.fixture` in `conftest.py` for reusable stubs.

---

## CDF Interaction Guidelines

- **Upsert over create** — `instances.upsert()` is idempotent; never check-then-create
- **Chunk writes** — max 1000 nodes per `instances.upsert()` call
- **Paginate reads** — loop on `cursor` until `None` for `instances.list()`
- **Direct relations** — `area` properties are `{space, externalId}` dicts, not strings
- **ExternalId scheme**: `plan-{uuid}` for plans, `result-{uuid4()}` for results, `{area_id}-elem-{label}` for structural elements
