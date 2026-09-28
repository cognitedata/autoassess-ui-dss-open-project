# 1. Architecture & mission lifecycle

## The big picture

```mermaid
flowchart LR
  subgraph GS["Ground station / robot"]
    ROBOT["Robot / drone<br/>(partner software)"]
    DSS["dss CLI / uidss Python SDK<br/>(sdk/)"]
    ROBOT <-->|plan.json, map files,<br/>mission output folder| DSS
  end

  subgraph CDF["Cognite Data Fusion — project autoassess-dev"]
    DMS[("Data Modeling (DMS)<br/>space: autoassess<br/>Vessel, Area, Plan, Task,<br/>Result, NDT, Defects, Images…")]
    FILES[("Files (CogniteFile)<br/>.ply meshes, .pcd clouds,<br/>.png drone images")]
  end

  subgraph WEB["Cognite Fusion (browser)"]
    APP["AutoAssess web viewer<br/>React + Three.js Flows app<br/>(repo root src/)"]
  end

  subgraph ANALYSIS["Partner analysis"]
    ALGO["Your algorithms<br/>(Python, cognite-sdk / uidss)"]
  end

  DSS <-->|OAuth client credentials| DMS
  DSS -->|upload| FILES
  APP <-->|user token from Fusion host| DMS
  APP -->|download URLs| FILES
  ALGO <--> DMS
  ALGO <--> FILES
```

Key points:

- **CDF is the only integration point.** The ground station and the web viewer never talk directly. Everything goes through CDF Data Modeling (structured data) and files stored as `CogniteFile` nodes (large binaries).
- **The web app has no backend.** It runs inside Cognite Fusion, which supplies the user's auth token. All logic is in the browser.
- **The ground station uses a service account** (client credentials), configured in `sdk/.env`.

## The mission lifecycle

```mermaid
sequenceDiagram
  actor Insp as Inspector (web)
  participant CDF
  participant GS as Ground station (dss)
  participant R as Robot

  Insp->>CDF: 1. Create InspectionPlan (Draft), pick reference map
  Insp->>CDF: 2. Add tasks (click element / surface in 3D)
  Insp->>CDF: 3. Mark plan Ready (read-only from now on)
  GS->>CDF: 4. dss plan download  →  plan.json
  GS->>CDF: 5. dss plan download-map  →  reference .ply/.pcd
  GS->>R: 6. Hand plan + map to robot (robot decides task order)
  R-->>GS: 7. Mission output folder (.ply, .pcd, UT .csv, ssg.yaml, metrics.yaml, images)
  GS->>CDF: 8. dss campaign upload / upload-drone-images  →  new InspectionResult ("campaign")
  GS->>CDF: 9. Mark campaign Complete (and plan Complete)
  Insp->>CDF: 10. Review in 3D viewer + campaign report, triage defects
  Insp->>CDF: 11. Suggestions → new plan for next mission
```

Vocabulary you'll hear:

| Term | Meaning |
|---|---|
| **Vessel** | A ship. Top-level entity. |
| **Area** | A confined space on a vessel (e.g. a ballast water tank `BWT` or cargo hold `CH`). All 3D data is per area. |
| **Inspection plan** | A set of tasks for one area. Status `Draft` → `Ready` → `Complete`. |
| **Task** | *Element task* (inspect a structural element, e.g. a manhole) or *region task* (inspect a surface point with normal + radius). Inspection type `visual` or `ndt_thickness`. |
| **Campaign** / **Inspection result** | One executed mission. Holds the uploaded map files and all measured data. Stored as `InspectionResult` nodes. |
| **Reference map** | A completed campaign that a new plan's coordinates refer to. The robot localises against it. |
| **Structural element** | A labelled semantic object in the area (manhole, longitudinal, wall, compartment), produced by the scene-graph (`ssg.yaml`). |

## Repo layout

```
autoassess-ui-dss/
├── src/                        # Web viewer (TypeScript/React)
│   ├── App.tsx                 # Routes
│   ├── shared/cdf/dataModel.ts # ★ Authoritative CDF identifiers (space/views/containers)
│   ├── features/vessels/       # Vessel list + settings
│   ├── features/areas/         # Area list + settings
│   ├── features/viewer/        # 3D viewer, layers, plans, defects, all CDF services
│   ├── features/reports/       # Area & campaign reports
│   ├── features/recommendations/ # Suggested follow-up tasks
│   └── __mocks__/              # Test data factories
├── scripts/                    # Data model setup + seed scripts (setup-dm.ts, upload-3d.ts, …)
├── app.json / manifest.json    # Flows app deploy config + CSP network permissions
├── PRD.md                      # Product requirements
└── sdk/                        # Ground-station Python project
    ├── src/uidss/
    │   ├── cli/                # `dss` CLI (Typer)
    │   ├── services/           # One service per CDF entity
    │   ├── cdf/data_model.py   # Mirror of src/shared/cdf/dataModel.ts
    │   ├── client.py           # UidssClient facade
    │   ├── models.py           # Domain dataclasses
    │   └── config.py, auth.py  # .env settings, CDF auth
    ├── scripts/                # Data model migrations
    └── tests/                  # unit/, integration/, fixtures/ (sample mission files!)
```

**Next:** [2. The CDF data model →](02-data-model.md)
