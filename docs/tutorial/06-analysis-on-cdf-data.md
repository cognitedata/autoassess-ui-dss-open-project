# 6. Track C: Analysis on CDF data

This chapter is for partners who want to **read** mission data (maps, point clouds, UT thickness, drone images with poses) into their own algorithms, and **write results back** so they show up in the web viewer.

You'll use Python with:
- the **`uidss`** SDK (high-level helpers), and
- the underlying **`cognite-sdk`** `CogniteClient` for anything `uidss` doesn't wrap.

Setup: [chapter 3](03-setup-credentials.md). The easiest option is to work inside `sdk/` with `uv run python …` or `uv run jupyter …` (add Jupyter with `uv add --dev jupyter` in your own branch). Alternatively, `pip install -e sdk/` into your own environment.

```python
from pathlib import Path

from uidss import UidssClient
from uidss.auth import make_cognite_client
from uidss.cdf.data_model import (
    SPACE, NDT_MEASUREMENT_VIEW, NDT_MEASUREMENT_CONTAINER,
    DEFECT_DETECTION_VIEW, view_id, container_property,
)

uidss = UidssClient.from_env()   # high-level
cdf = make_cognite_client()      # raw cognite-sdk client, same credentials
```

---

## Step 1: Find your campaign

```python
vessel = next(v for v in uidss.vessels.list() if v.name == "Test Vessel")
area = next(a for a in uidss.areas.list(vessel.space, vessel.external_id) if a.name == "BWT 3P")

campaigns = uidss.campaigns.list(area.space, area.external_id)
for c in campaigns:
    print(c.external_id, c.campaign_date, c.status, len(c.cdf_file_ids), "ply,", len(c.pcd_file_ids), "pcd")

campaign = max((c for c in campaigns if c.status == "Complete"), key=lambda c: c.campaign_date)
```

✅ You should see one line per campaign. Each `InspectionResult` has the IDs of its map files.

## Step 2: Download the 3D map (PLY / PCD)

```python
paths = uidss.campaigns.download_map(campaign.space, campaign.external_id, Path("data") / campaign.external_id)
print(paths)   # [.../mesh.ply, .../labeled_cloud.pcd, ...]
```

Load them with your usual tools, for example `open3d.io.read_point_cloud`, `trimesh.load` or `plyfile`. The PCD labels shown in the UI are in `campaign.pcd_file_labels`, in the same order as `campaign.pcd_file_ids`.

## Step 3: UT / NDT thickness measurements

`uidss` doesn't have a reader for these yet, so query DMS directly:

```python
nodes = cdf.data_modeling.instances.list(
    instance_type="node",
    sources=[view_id(NDT_MEASUREMENT_VIEW)],
    filter={
        "equals": {
            "property": container_property(NDT_MEASUREMENT_CONTAINER, "campaign"),
            "value": {"space": campaign.space, "externalId": campaign.external_id},
        }
    },
    limit=-1,          # -1 = paginate through everything
)
rows = [n.properties[view_id(NDT_MEASUREMENT_VIEW)] for n in nodes]
# each row: {"position3d": [x, y, z], "thicknessMm": 8.1, "timestamp": "2026-…Z", "campaign": {...}}

import pandas as pd
df = pd.DataFrame(rows)   # pandas: `uv add pandas` if needed
print(df.thicknessMm.describe())
```

## Step 4: Drone images with camera pose

```python
images = uidss.drone_images.list_for_campaign(campaign.external_id)
img = images[0]
print(img.frame_id, img.position, img.orientation_quat)          # camera pose in map frame
print(img.focal_length_x, img.principal_point_x, img.image_width)  # pinhole intrinsics

# download the actual PNG (the target folder must already exist)
frames = Path("data/frames")
frames.mkdir(parents=True, exist_ok=True)
cdf.files.download_to_path(frames / f"{img.frame_id:05d}.png", id=img.cdf_file_id)
```

Pose and intrinsics give you a projection from 3D to pixels:

```python
import numpy as np
from scipy.spatial.transform import Rotation as R

R_ws = R.from_quat(img.orientation_quat).as_matrix()   # (qx, qy, qz, qw), sensor→world
t_ws = np.array(img.position)
K = np.array([[img.focal_length_x, 0, img.principal_point_x],
              [0, img.focal_length_y, img.principal_point_y],
              [0, 0, 1]])

def project(p_world):
    p_cam = R_ws.T @ (np.asarray(p_world) - t_ws)
    uv = K @ (p_cam / p_cam[2])
    return uv[:2], p_cam[2]   # pixel, depth
```

The camera axis convention follows the `T_BS` extrinsic in the mission's `sensor.yaml` (supereight2 optical frame: z forward). Check it against a known structural element before relying on it.

## Step 5: Structural elements and metrics

```python
metrics = uidss.campaign_metrics.list_for_campaign(campaign.external_id)
tasks = uidss.plans.list_tasks("plan-…")   # what was supposed to be inspected
```

Structural elements (`StructuralElementView`) are per **area**. Query them like NDT above, filtering on `StructuralElementContainer.area`.

---

## Step 6: Write results back (ML defect detections)

Anything written as a `DefectDetection` node linked to a campaign **appears in the viewer's Defects tab** and 3D scene, and in the area report. Inspectors can then confirm or dismiss it.

```python
import uuid
from cognite.client.data_classes.data_modeling import NodeApply, NodeOrEdgeData

def defect_node(campaign_eid: str, area_eid: str, cls: str, prob: float,
                center, half_extents, euler=(0.0, 0.0, 0.0), normal=None) -> NodeApply:
    props = {
        "campaign": {"space": SPACE, "externalId": campaign_eid},
        "area": {"space": SPACE, "externalId": area_eid},
        "defectClass": cls,                      # e.g. "corrosion", "crack", "deformation"
        "probability": prob,                     # 0..1
        "boundingBox3d": [*center, *half_extents, *euler],   # 9 floats, metres / radians
        "status": "New",
        "source": "ml",
    }
    if normal is not None:
        props["normal3d"] = list(normal)
    return NodeApply(
        space=SPACE,
        external_id=f"ml-ntnu-{uuid.uuid4()}",   # ← use your partner prefix
        sources=[NodeOrEdgeData(source=view_id(DEFECT_DETECTION_VIEW), properties=props)],
    )

nodes = [defect_node(campaign.external_id, area.external_id, "corrosion", 0.87,
                     center=(2.1, 1.0, 0.9), half_extents=(0.1, 0.1, 0.02))]

for i in range(0, len(nodes), 1000):                     # ≤ 1000 per request
    cdf.data_modeling.instances.apply(nodes=nodes[i:i + 1000])
```

✅ Reload the viewer for that area and open the **Defects** tab. Your detection is listed; "fly to" moves the camera to the box centre.

Other things you can write:
- **Campaign metrics** (coverage, corrosion rate, …): write a `metrics.yaml` and call `uidss.campaign_metrics.upsert_from_yaml(path, campaign_eid)`. They show as stat cards in the campaign report.
- **Derived point clouds** (for example a per-point corrosion score as the PCD `label` field): `uidss.artifacts.upload_pcd(path, area_eid, "Corrosion score")`. Then **append** the ID to the campaign. `update_file_ids` overwrites, so pass the existing IDs too:
  ```python
  fid = uidss.artifacts.upload_pcd(Path("score.pcd"), area.external_id, "Corrosion score")
  c = uidss.campaigns.get(campaign.space, campaign.external_id)
  uidss.campaigns.update_file_ids(c.space, c.external_id,
      list(c.cdf_file_ids), [*c.pcd_file_ids, fid], [*c.pcd_file_labels, "Corrosion score"])
  ```
- Need a **new kind of result** that doesn't fit an existing view? Talk to the AutoAssess team first ([schema changes](02-data-model.md#changing-the-data-model)).

## DMS best practices

- **Batch writes** at ≤ 1000 nodes per `instances.apply`.
- **Paginate** reads (`limit=-1`, or loop with cursors). Never assume one page is everything.
- Use **deterministic external IDs** when re-running a pipeline should overwrite (upsert) instead of duplicating, for example `ml-<partner>-<campaign>-<n>`.
- Don't fire hundreds of parallel requests; the project has concurrency limits (HTTP 429). The SDK retries, but be gentle.
- Clean up test data you create (`cdf.data_modeling.instances.delete(...)`) on the shared project.

**Next:** [7. End-to-end exercise →](07-end-to-end-exercise.md)
