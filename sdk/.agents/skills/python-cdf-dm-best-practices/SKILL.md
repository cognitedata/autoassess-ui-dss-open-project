---
name: python-cdf-dm-best-practices
description: "Reference skill for CDF Data Modeling API best practices in the uidss-sdk Python codebase (sdk/). Apply when writing or reviewing any code under sdk/ that calls the CDF DM API. Triggers: DMS limits, 429 error, rate limit, pagination, cursor, next_cursor, batching, instances.apply, instances.list, instances.query, upsert, concurrency, chunk, NodeApply, EdgeApply."
allowed-tools: Read, Grep, Write
metadata:
  argument-hint: ""
---

# CDF Data Modeling: Python Best Practices

Reference skill for `sdk/` (the `uidss` Python package). Apply these patterns when writing or
reviewing any code that calls the CDF Data Modeling API from `sdk/src/uidss/services/*.py`.

For current concurrency limits and resource limits, see:
**https://docs.cognite.com/cdf/dm/dm_reference/dm_limits_and_restrictions**

---

## Chunking write operations

`instances.apply()` accepts up to **1000 nodes/edges per call**. Always chunk before calling —
see `CdfDroneImageService.upload()` in `services/drone_image_service.py` for the existing pattern:

```python
_CHUNK = 1000  # max nodes per apply call

def _chunks(items: list[NodeApply], size: int) -> Iterator[list[NodeApply]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]

for chunk in _chunks(nodes, _CHUNK):
    self._client.data_modeling.instances.apply(nodes=chunk)
```

---

## Paginating instances.list()

`instances.list()` returns at most `limit` items. Always loop on `cursor` until it is `None` —
see `CdfAreaService.list()` / `CdfVesselService.list()` for the existing pattern:

```python
cursor: str | None = None
items: list[SomeModel] = []
while True:
    page = client.data_modeling.instances.list(
        instance_type="node",
        sources=[view_id(SOME_VIEW)],
        cursor=cursor,
        limit=1000,
    )
    items.extend(_map_node(item) for item in page)
    cursor = page.next_cursor
    if cursor is None:
        break
```

Never assume one page is the complete result. A response with `limit` items but `next_cursor=None`
means that page happened to be the last one — the loop handles this correctly.

---

## Upsert semantics

Always use `instances.apply()` — it creates nodes that don't exist and updates nodes that do.
Never use a "check if exists then create" pattern:

```python
# BAD — two round-trips, race condition, unnecessary complexity
existing = client.data_modeling.instances.retrieve(nodes=[(space, external_id)], sources=[...])
if not existing.nodes:
    client.data_modeling.instances.apply(nodes=[node])

# GOOD — one round-trip, idempotent
client.data_modeling.instances.apply(nodes=[node])
```

Exception: when a write must **append** to an existing array property (e.g.
`CdfCampaignService.update_file_ids` appending to `pcdFileIds`/`cdfFileIds` rather than
overwriting), a `retrieve()` read-before-write is required and correct — see that method for
the pattern. This is a merge, not a "check existence" guard, so it's fine.

---

## Deletion concurrency

Delete operations have a stricter concurrency budget than apply. Use a lower batch size and
avoid parallel delete calls:

```python
DELETE_CHUNK_SIZE = 1000  # check docs for current limit

def delete_nodes(client: CogniteClient, ids: list[tuple[str, str]]) -> None:
    for batch in _chunks(ids, DELETE_CHUNK_SIZE):
        client.data_modeling.instances.delete(nodes=list(batch))
        # Sequential — do not use threading or concurrent.futures here
```

---

## ExternalId conventions

uidss-sdk does **not** centralize externalId construction in one helper — each service builds
its own ids inline, following the scheme documented in `sdk/AGENTS.md`'s "CDF Interaction
Guidelines" table:

| Resource | Scheme | Built in |
|---|---|---|
| Inspection plan | `plan-{uuid}` | (plans are created outside this SDK; it only reads/downloads them) |
| Campaign (InspectionResult) | `result-{uuid4()}` | `CdfCampaignService.create()` |
| Structural element | `{area_id}-elem-{label}` | `CdfStructuralElementService.upsert_from_ssg()` |
| Drone image | `drone-image-{campaign_external_id}-frame-{frame_id}` | `CdfDroneImageService.upload()` |

When adding a new resource type, follow this table rather than inventing a new scheme, and add
a row to it in `sdk/AGENTS.md` when you do.

---

## NodeApply construction pattern

```python
from cognite.client.data_classes.data_modeling import NodeApply, NodeOrEdgeData, ViewId

from uidss.cdf.data_model import INSPECTION_RESULT_VIEW, SPACE

def build_campaign_node(external_id: str, area_external_id: str, campaign_date: str) -> NodeApply:
    return NodeApply(
        space=SPACE,
        external_id=external_id,
        sources=[
            NodeOrEdgeData(
                source=ViewId(*INSPECTION_RESULT_VIEW),
                properties={
                    "area": {"space": SPACE, "externalId": area_external_id},
                    "campaignDate": campaign_date,
                    "status": "InProgress",
                    "cdfFileIds": [],
                    "pcdFileIds": [],
                    "pcdFileLabels": [],
                },
            )
        ],
    )
```

This mirrors `CdfCampaignService.create()` in `services/campaign_service.py` — use it as the
reference implementation.

---

## Common pitfalls

### 1. Forgetting to paginate
```python
# BAD — silently drops data when there are > limit nodes
page = client.data_modeling.instances.list(limit=1000)
return list(page)

# GOOD — loop on cursor, see "Paginating instances.list()" above
```

### 2. Reading `node.properties` with the wrong key shape
`node.properties` is keyed by `ViewId`, not by the wire-format `"ExternalId/version"` string —
use the `view_id(SOME_VIEW)` helper from `uidss.cdf.data_model`, not `view_key(SOME_VIEW)`, when
indexing into a mapped SDK node's `.properties`:

```python
# GOOD — matches every existing _map_node in services/
view_props = props.get(view_id(SOME_VIEW)) or {}
```

`view_key()` (the `"ExternalId/version"` string form) is only needed when hand-building a raw
REST payload — it is not used to read `node.properties`.

### 3. Applying nodes one-by-one
```python
# BAD — N round-trips
for node in nodes:
    client.data_modeling.instances.apply(nodes=[node])

# GOOD — one round-trip per 1000 nodes, see "Chunking write operations" above
```

---

## Checklist

- [ ] All `instances.apply()` calls chunk to ≤ 1000 nodes/edges
- [ ] All `instances.list()` calls loop on `cursor` until `None`
- [ ] Deletions are sequential, not concurrent
- [ ] ExternalIds match the scheme documented in `sdk/AGENTS.md`
- [ ] Upsert semantics — no "check then create" patterns (append-merge reads, like
      `update_file_ids`, are the one legitimate exception)
- [ ] Consult [DMS limits](https://docs.cognite.com/cdf/dm/dm_reference/dm_limits_and_restrictions) for current 429 thresholds
