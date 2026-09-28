# AUTOASSESS UI-DSS
## Product Requirements Document
**Version:** 0.9
**Status:** Active — data model migrated to CDF Data Modeling (DMS); rendering architecture rebuilt on a custom Three.js pipeline (see §7); Reports, Recommendations, and Vessel/Area management shipped ahead of original v1 scope
**Last updated:** 2026-08-05

---

## 1. Purpose & Scope

The **UI-DSS (User Interface and Decision Support System)** is the human-facing web application through which inspectors plan inspection campaigns, and review and act on the results of autonomous UAS drone inspections of confined marine spaces — primarily ballast water tanks (BWT) and cargo holds (CH).

### 1.1 In scope

- Ingesting and indexing all inspection data via Cognite Data Fusion (CDF)
- Presenting a unified 3D digital twin with all data layers overlaid, each independently scoped to one or more campaigns
- Enabling non-robotics-expert inspectors to plan inspection campaigns
- Surfacing trend analysis and change detection results

### 1.2 Out of scope

- Building 3D maps, running SLAM, or onboard processing (upstream inputs, owned by WP3/WP6)
- Running ML defect detection or NDT post-processing (outputs arrive as pre-computed overlays from WP5/WP6)
- Low-level drone control or task distribution (handled externally by ground station and WP4)
- Offline / disconnected use — the app is **always cloud-connected** via CDF
- Exportable/printable report documents (PDF or similar) — an in-app, read-only report dashboard shipped ahead of schedule (see §4.5); document export/generation remains Phase 2
- Side-by-side multi-epoch rendering (Phase 2)
- Change detection layer/view — designed in §4.2.3 and §6 but not yet implemented; revisit as Phase 2 or re-prioritise into v1
- Point cloud special-casing for multi-campaign display (Phase 2)
- Mobile native app (web responsive is sufficient)
- Multi-language support beyond English (v1)

---

## 2. Users & Roles

Two roles are in scope for v1. Access is enforced at the CDF API level via OIDC group membership; the UI adapts its feature surface per role.

| Role | Who | Permissions | Key job to be done |
|------|-----|-------------|-------------------|
| **Inspector** | Non-robotics expert present at vessel | Read all vessel data; Create/edit campaigns; Annotate findings | Plan an inspection campaign |
| **Remote Assessor** | Senior surveyor off-site | Read all vessel data; Annotate findings | Review inspection results |

> **Design principle:** Every feature must be operable by an Inspector with no prior robotics knowledge. The 3D viewer, campaign planning, and defect review panels are the core interaction surfaces — they must speak the inspector's domain language, never robotics jargon.

---

## 3. High-Level Feature Map

```
UI-DSS
├── 1. Fleet & Vessel Overview
│   ├── 1a. Vessel list (+ create/rename/delete)
│   └── 1b. Area list (per vessel) (+ create/rename/delete)
├── 2. Digital Twin Viewer  ← scoped to a selected area
│   ├── 2a. Point cloud & mesh rendering (custom Three.js pipeline — see §7)
│   ├── 2b. Per-layer campaign scoping (defaults to latest)
│   ├── 2c. Top navigation bar (back button + area selector)
│   ├── 2d. Semantic overlay — structural element labels
│   ├── 2e. NDT thickness markers
│   ├── 2f. Change detection layer [not yet implemented — see §1.2]
│   ├── 2g. Image hotspot links
│   └── 2h. Visual feedback for current plan draft
├── 3. Inspection Plan Planning
│   ├── 3a. Context menu on geometry click
│   ├── 3b. Plan sidebar (task list + status)
│   └── 3c. Suggestions — rule-based v1, shipped (see §4.3.2)
├── 4. Inspection Review (in the viewer)
└── 5. Reports — in-app area/campaign dashboards (see §4.5)
```

---

## 4. Feature Requirements

> **v0.9 terminology note:** Earlier revisions used a single "Campaign" concept end-to-end. Implementation split this into two DM views (see Section 6): **`InspectionPlanView`** (the pre-execution planning artifact an inspector composes and marks Ready — Section 4.3) and **`InspectionResultView`** (an executed data-collection run and its outputs: point clouds, images, defects, NDT — Sections 4.2, 4.4, 4.5). This document keeps using "campaign" informally where it refers to the reviewable, data-bearing entity (i.e. an `InspectionResultView` record) shown in the layer panel and reports; where a requirement is specifically about the plan-composition workflow, it now says "plan".

### 4.1 Fleet & Vessel Overview

**FR-01** The home screen shall list vessels the authenticated user has access to.

**FR-02** Selecting a vessel navigates to an **area list** showing all inspectable areas for that vessel (e.g. BWT port side, BWT starboard, Cargo Hold). Selecting an area opens the 3D viewer scoped to that area.

**FR-02a** *(Shipped ahead of original v1 scope.)* The user may create, rename, and delete vessels and areas from dedicated settings pages, reachable from the vessel/area list. This was not specified in earlier PRD revisions but is required in practice for onboarding new demo/field datasets without direct CDF access.

---

### 4.2 Digital Twin Viewer

The 3D viewer is the centrepiece of UI-DSS. All inspection data — across campaigns — is explored here. There is no separate review mode; reviewing completed campaign data is done by opening the viewer and selecting the relevant epoch.

#### 4.2.1 Rendering Engine

> **Revised in v0.9.** Earlier revisions of this PRD specified Cognite Reveal as the rendering engine. In implementation this was replaced by a custom Three.js pipeline (no `@cognite/reveal` dependency) to keep full control over PLY/PCD loading, caching, and camera behaviour for this project's dataset sizes and workflows. See Section 7 for the current architecture.

**FR-02** The viewer shall render point clouds and meshes directly with **Three.js**, using custom loaders (`PLYLoader`, `PCDLoader`) run off the main thread in a Web Worker (`plyWorker`), with parsed geometry cached in IndexedDB (`parsedGeometryCache`) and raw file responses cached via the Cache API (`plyCache`) to keep repeat loads fast.

**FR-03** For data layers, the viewer shall use a **`ViewerLayerManager`** — a lightweight registry (`Map<LayerType, IViewerLayer>`) that tracks layer instances by type. Not every layer implements the shared `IViewerLayer` interface today; some (image hotspots, defect markers, selection decals) are added to the scene directly by the viewer rather than through the registry. Treat full ECS-style lifecycle management (`initialize/load/unload/update/onPick/dispose` on every layer) as a target for a future cleanup pass, not the current state (see Section 7.3).

**FR-04** The viewer shall maintain interactive frame rates for the point cloud sizes used in field trials on a standard laptop (16GB RAM, modern browser). There is no LOD/streaming engine equivalent to Reveal's — the full point cloud/mesh geometry for the active layers is loaded and cached client-side. Revisit this requirement if dataset sizes approach the ~130M point figure from earlier revisions; the current pipeline has not been benchmarked at that scale.

**FR-05** Camera controls: two selectable modes — **free-fly** (orbit/rotate, pan, dolly-zoom, plus WASD/QE keyboard movement) and **ground-plane** (yaw/pitch with pan constrained to the ground plane) — selectable per user preference and persisted across sessions (`viewerControlsModeStore`).

#### 4.2.2 Plan Draft Feedback

**FR-06** Structural elements that have been added to the current plan draft shall be visually distinguished in the viewer via a colour change on the class-colour sphere marker rendered by `SemanticLayer` for that element. Region tasks shall be shown as a marker at the clicked surface point, via `PlanTasksLayer`.

*(Revised in v0.9 — earlier revisions described a THREE.js wireframe box; `SemanticLayer` renders structural elements as coloured sphere markers, not bounding-box wireframes.)*

No separate layer is needed for element highlighting — this feedback is driven directly by `activePlanStore` (a Zustand store; formerly referred to as `CampaignDraftStore`), which `SemanticLayer` and `PlanTasksLayer` observe to update marker state.

#### 4.2.3 Data Layers

The layer panel is organised as a **tree of campaigns**, each with its available layers underneath. The exact layers available may differ between campaigns depending on what data was collected.

```
Layer panel
├── Campaign 2024-09-15 (latest, expanded by default, all layers on)
│   ├── ● Point cloud
│   ├── ● Defect detections
│   ├── ● NDT measurements
│   ├── ● Images
│   └── ● Change detection
└── Campaign 2024-03-01 (collapsed by default, all layers off)
    ├── ○ Point cloud
    ├── ○ Defect detections
    └── ○ Images
```

**FR-09** The layer panel shall reflect the campaigns available for the current area, ordered by date, most recent first.

**FR-10** Each campaign node is independently collapsible. Collapsing a campaign node hides all its layers from the viewer simultaneously.

**FR-11** The layers available under each campaign are determined dynamically by querying DMS (`instances.list` with a `hasData` filter on each view) for what data exists for that campaign — if a layer type has no nodes for a given campaign it does not appear.

**FR-12** All layers under the latest campaign are enabled by default. All layers under older campaigns are disabled by default.

**FR-13** Individual layers can be toggled on and off independently within a campaign.

The known layer types are (updated in v0.9 to match implementation — see Section 6 for the current data model):

| Layer type | CDF source | Visual encoding | Priority |
|-------|-----------|-----------------|----------|
| Point cloud | Raw PLY/PCD `CogniteFile`s referenced by `pcdFileIds` on `InspectionResultView`; loaded via custom `PCDLoader`/`PLYLoader` | Per-point vertex colour decoded from PCD label field, or intensity | P0 |
| Mesh | Raw PLY `CogniteFile`s referenced by `InspectionResultView`; loaded via `PLYLoader` (worker thread) | Flat shading, or per-face colour when present | P0 |
| Semantic segmentation | Nodes — `StructuralElementView` (`elementType`, `label`, `center` point) | Class colour marker (sphere) — current classes: manhole, longitudinal, wall, compartment | P0 |
| Images | Nodes — `DroneImageView` (custom node with position/orientation/intrinsics), `cdfFileId` reference to Files API | Billboard sprites; click opens image | P1 |
| Defect detections | Nodes — `DefectDetectionView`; relation to `InspectionResultView` | Flat-colour ring + disc marker per status/class; no probability colour ramp implemented yet | P1 |
| NDT measurements | Nodes — `NdtMeasurementView`; relation to `InspectionResultView` | Flat-colour sphere marker; colour ramp against thickness thresholds not yet implemented (see FR-28 note) | P1 |
| Change detection | **Not implemented** — no `ChangeDetectionView` exists; `CHANGE_DETECTION` is a placeholder toggle in the layer panel with no backing data or renderer | P2 |

**FR-09** Clicking on geometry in the viewer shall open a context menu. The menu contents depend on what was clicked — a semantic structural element or an arbitrary mesh surface position (see Section 4.3.1).

#### 4.2.4 Navigation

**FR-10** The viewer shall include a **top navigation bar** containing:
- A **back button** that returns the user to the vessel overview
- An **area selector** showing the currently selected area; clicking it reveals a dropdown of all available areas for the vessel, allowing the user to switch area directly

**FR-11** Selected or highlighted semantic elements shall be visually distinguished from surrounding geometry. *(Revised in v0.9 — there is no Reveal node appearance API in the current stack; this is done via marker colour/state changes in `SemanticLayer` and click-position decals in `SelectionLayer`.)*

---

### 4.3 Inspection Plan Planning

The inspector composes a plan by clicking geometry in the viewer — the inspector panel appears on the left with actions to add tasks. Tasks accumulate in the **Inspection Plans tab** of the right drawer.

#### Plan Status

*(Revised in v0.9 — `InspectionPlanView.status` is `Draft | Ready | Complete`; there is no `InProgress` value on the plan itself.)*

| Status | Description | Editable |
|--------|-------------|----------|
| **Draft** | Being composed by the inspector | Yes |
| **Ready** | Marked ready for execution by inspector | No |
| **Complete** | Plan fulfilled | No |

UI-DSS manages the Draft ↔ Ready transition. Once execution begins, the ground station's progress is tracked separately on the corresponding `InspectionResultView` record (statuses `InProgress`/`Complete`), not on the plan. **Open question:** confirm with the ground station team whether the plan should also expose an `InProgress` state, or whether tracking execution solely on the result record is sufficient (folds into OQ-5).

#### 4.3.1 Inspection Plans Tab

**FR-18** The Inspection Plans tab displays the current plan's task list and status controls.

**FR-19** Each task row shows: task type (element or region), semantic label or surface position description, inspection type, and a remove button. Tasks are editable only when the plan is in **Draft** status.

**FR-20** The task list is **unordered** — the ground station and robots determine execution order autonomously.

#### 4.3.2 Suggestions

**Shipped in v1** *(revised in v0.9 — no longer deferred).* A rule-based suggestion engine (`recommendationRules.ts`) proposes tasks from two sources: NDT measurements below a repeat-inspection thickness threshold, and confirmed defects on the area. Suggestions surface via a "Suggestions" button in the Inspection Plans tab (visible while the plan is in Draft), opening a modal where the inspector can add any suggestion to the plan as a task (`recommendationToTask`). This is a heuristic v1, not the ML/prior-findings-based engine originally envisioned — revisit scope for v2 once more defect-data structure/volume is available.

#### 4.3.3 Plan Storage & Status

**FR-21** The inspector may save a plan at any point while it is in **Draft** status. Saved drafts are stored in CDF and retrievable across sessions.

**FR-22** The inspector may toggle a plan between **Draft** and **Ready** at will.

**FR-23** A plan stores an **unordered list of inspection tasks**. Each task is a DM node (`InspectionTaskView`) with a relation to its `InspectionPlanView` node (`plan` property). It encodes: `taskType` (`element` | `region`), `targetElementExternalId` as a direct relation to a `StructuralElementView` node (element tasks), `position3d` + `normalVector` + `radiusM` (region tasks), `inspectionType`, and an optional `suggestionId` linking back to the recommendation that produced the task (see 4.3.2). *(Revised in v0.9 — field names and the `suggestionId` addition reflect the shipped schema; the co-definition referenced by OQ-5 should be checked against this as the source of truth.)*

**FR-24** The plan status (Draft / Ready / Complete) is displayed in the Inspection Plans tab. Ready and Complete plans are read-only in UI-DSS.

---

### 4.4 Inspection Review

Reviewing a completed campaign (`InspectionResultView` record) is done directly in the viewer. The inspector selects the relevant campaign in the Layers tab, and uses the Defects tab and inspector panel to explore findings.

**FR-25** The **Defects tab** lists all detected defects for the active campaign layers, sortable by severity and ML confidence. Each row shows: thumbnail, semantic location label, confidence score, and status (New / Under review / Confirmed / Dismissed).

**FR-26** Clicking a defect row flies the camera to that location and opens the inspector panel for that element. Clicking a defect marker in the viewer selects the corresponding row in the Defects tab. These two directions are bidirectionally synced.

**FR-27** The Inspector or Remote Assessor may annotate each finding via the inspector panel: add a comment, adjust severity, link to a prior finding for tracking evolution.

**FR-28** NDT measurements are reviewable in the inspector panel when an element or surface position with NDT data is selected. Measurements are shown in a table with values colour-coded against minimum acceptable thickness thresholds (per OQ-6).

---

### 4.5 Trend Analysis & Reports

**FR-26** Change detection results for a campaign shall be visualisable via the `CHANGE_DETECTION` layer — candidate defect positions with associated regions of interest, computed upstream by WP6 from comparison with the previous campaign. **Not yet implemented** — no `ChangeDetectionView` or backing renderer exists (see §1.2). Treat this as a gap to schedule, not a shipped requirement.

**FR-29** *(New in v0.9 — shipped ahead of schedule.)* An in-app **Reports** section provides read-only dashboards for trend analysis, reachable from the viewer:
- An **area report** page trending NDT thickness across campaigns (box plot) and summarising defect counts by class and status, with a grid of campaign cards.
- A **campaign report** page with overview stat cards, a per-campaign NDT table and box plot, and a drone-image grid with lightbox (linking back into the 3D viewer at the image's capture position via `flyToImage`).

This is a live, in-browser dashboard computed from already-fetched CDF data — it does not produce an exportable or printable document. Document export/generation (PDF or similar) remains out of scope per §1.2.

> **Future work:** Side-by-side rendering of two inspection epochs from the same camera position and orientation.

---

## 5. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-01 | Performance | First meaningful 3D render within 3s on a standard laptop (16GB RAM, Chrome latest) |
| NFR-02 | Performance | Layer toggle responds within 500ms |
| NFR-03 | Performance | Viewer maintains interactive frame rates for point clouds up to ~130M points. *(Revised in v0.9 — no Reveal LOD streaming exists; the current custom Three.js/PLY pipeline has not been benchmarked at this scale — see §4.2.1 FR-04.)* |
| NFR-04 | Connectivity | Always cloud-connected; no offline mode required |
| NFR-05 | Browser support | Chrome, Firefox, Edge latest stable; WebGL 2.0 required |
| NFR-06 | Accessibility | WCAG 2.1 AA for all non-3D UI surfaces |
| NFR-07 | Audit trail | All user actions on campaigns (create, save, mark ready, annotate) are logged as `AuditEventView` DM nodes with `timestamp`, `userId`, `action`, and a direct relation to the relevant Campaign node. **Not yet implemented** — no `AuditEventView`, container, service, or logging call exists anywhere in the codebase. Needs a scoping decision: still required for v1, or deferred? |
| NFR-08 | Terminology | All domain-facing text follows IMO / DNV standards; no robotics jargon visible to inspectors |
| NFR-09 | Security | Auth via CDF OIDC integration; role-based access enforced at CDF API level |

---

## 6. Data Model (CDF Resource Mapping)

> **Data model discipline:** A view property is added only when a corresponding UI element exists in the current implementation stage. Properties that are not read or displayed by the app are not modelled — defer them to the stage that introduces the UI. This keeps the schema minimal and prevents dead fields accumulating between stages.

> **v0.9 rewrite.** This section previously described a target schema (single `CampaignView`, `CogniteVisualizable`/`Cognite3DObject`/`CognitePointCloudVolume` for structural elements, `CogniteFile` for images, `ChangeDetectionView`) that diverged from what was actually built. It now describes the schema as implemented in `src/shared/cdf/dataModel.ts`. Divergences from the earlier target are called out inline — some are deliberate simplifications, others (change detection, audit trail, OBB-based element geometry) are open gaps, not decisions.

### 6.1 Data Model Structure

All structured domain data is stored in CDF Data Modeling (DMS) within a single DMS space, `autoassess` (confirms OQ-7: one shared space, not one per vessel owner). Relationships between concepts are typed DM edges/direct relations, not metadata strings on individual resources.

```
autoassess (DMS space)
├── VesselView (node)
│   └── AreaView (node) ──────────────────── relation → Vessel
│       ├── StructuralElementView (node) ─── relation → Area
│       ├── InspectionPlanView (node) ────── relation → Area
│       │   └── InspectionTaskView (node) ── relation → InspectionPlan (`plan`)
│       │                                    relation → StructuralElementView (element tasks)
│       └── InspectionResultView (node) ──── relation → Area
│           ├── DefectDetectionView (node) ─ relation → InspectionResult
│           ├── NdtMeasurementView (node) ── relation → InspectionResult
│           ├── DroneImageView (node) ────── relation → InspectionResult (`campaignExternalId`)
│           ├── CampaignMetricView (node) ── relation → InspectionResult
│           └── ChangeDetectionView ──────── NOT IMPLEMENTED (see §1.2)
```

**Divergences from the earlier target schema, as implemented today:**
- **No single `CampaignView`.** Split into `InspectionPlanView` (pre-execution planning, statuses `Draft`/`Ready`/`Complete`) and `InspectionResultView` (executed data-collection run, statuses `InProgress`/`Complete`, holding `cdfFileIds`/`pcdFileIds`/`pcdFileLabels`). See the terminology note at the top of Section 4.
- **Structural elements have no OBB geometry.** `StructuralElementView` is `elementType` + `label` + a single `center` point — there is no `CogniteVisualizable` implementation, no `Cognite3DObject`, and no `CognitePointCloudVolume` linkage anywhere in the codebase. Semantic highlighting in the viewer is a point marker, not a volume (§4.2.1, §7.5). This is a real gap against `KO-5`'s <1cm registration accuracy claim if precise element extents are ever needed — flag for a decision rather than assuming it's fine.
- **Images are a custom node, not `CogniteFile`.** `DroneImageView` carries position/orientation/camera-intrinsics metadata plus a `cdfFileId` reference into the Files API for the actual image blob — richer than the original `CogniteFile` + `position3d` plan, needed for the fly-to-image and reprojection features.
- **`CampaignMetricView` is new** — feeds the Reports feature (§4.5); not part of any earlier PRD revision.
- **`ChangeDetectionView` does not exist** — unimplemented, not just unused (§1.2).
- **`AuditEventView` does not exist** — NFR-07 is entirely unimplemented.
- **3D point cloud/mesh data is not `CognitePointCloudModel`/`CogniteCADModel`.** It's raw PLY/PCD files referenced by `pcdFileIds`/`cdfFileIds` on `InspectionResultView` and streamed through the custom Three.js pipeline (§7), not the ThreeDModels API.

### 6.2 Resource Map

| Domain concept | DMS resource | Key properties / relations |
|----------------|-------------|---------------------------|
| Vessel | Node — `VesselView` | `vesselType` |
| Area | Node — `AreaView` + relation to Vessel | `areaType` |
| Structural element | Node — `StructuralElementView` | `elementType` (manhole, longitudinal, wall, compartment — no separate "web frame" class implemented), `label`, `center` (single point, not an OBB); relation to Area |
| Point cloud / mesh | Raw PLY/PCD `CogniteFile`s | Referenced via `pcdFileIds`/`cdfFileIds`/`pcdFileLabels` on `InspectionResultView`; loaded client-side by the custom Three.js pipeline (§7), not via ThreeDModels/Reveal |
| Inspection plan | Node — `InspectionPlanView` + relation to Area | `status` (`Draft`\|`Ready`\|`Complete`), `areaExternalId`, `createdTime`. No `createdBy` field exists yet — gap against the earlier target. |
| Inspection result (executed campaign) | Node — `InspectionResultView` + relation to Area | `status` (`InProgress`\|`Complete`), `date`, `cdfFileIds`, `pcdFileIds`, `pcdFileLabels` |
| Inspection task | Node — `InspectionTaskView` + relation to `InspectionPlanView` (`plan`) | `taskType`/`taskKind` (`element`\|`region`); `targetElementExternalId` → `StructuralElementView` (element tasks) / `position3d` + `normalVector` + `radiusM` (region tasks); `inspectionType`; `suggestionId` (new — links to a recommendation, §4.3.2) |
| Defect detection | Node — `DefectDetectionView` + relation to `InspectionResultView` | `probability`, `defectClass`, `boundingBox3d` (flat `number[]`, not a structured OBB type) |
| NDT measurement | Node — `NdtMeasurementView` + relation to `InspectionResultView`; optional relation to `StructuralElementView` | `thicknessMm`, `position3d` |
| Drone image | Node — `DroneImageView` (not `CogniteFile`) + relation to `InspectionResultView` (`campaignExternalId`) | `frameId`, `timestamp`, `position`, `orientationQuat`, `cdfFileId` (→ Files API), AABB (`bboxMin`/`bboxMax`), camera intrinsics |
| Campaign metric | Node — `CampaignMetricView` + relation to `InspectionResultView` | Used by the Reports feature (§4.5); not in earlier PRD revisions |
| Change detection | **Not implemented.** Target shape (unbuilt): Node — `ChangeDetectionView` + relations to two `InspectionResultView` nodes | `position3d`, `regionRadiusM` |

---

## 7. 3D Viewer Architecture

> **v0.9 rewrite.** This section previously described a Reveal-based architecture that was not built. It now describes the custom Three.js pipeline actually implemented in `src/features/viewer/`.

### 7.1 Design rationale

There is no `@cognite/reveal` dependency in this project. Point cloud/mesh rendering, LOD-equivalent behaviour, and CDF auth integration are all handled by hand-rolled Three.js code instead: `PlyViewer.tsx` owns the `THREE.Scene`/`Camera`/`WebGLRenderer`; `plyWorker.ts` parses PLY files off the main thread; `plyCache.ts` (Cache API) and `parsedGeometryCache.ts` (IndexedDB) avoid re-fetching/re-parsing on repeat visits; `PCDLoader` (Three.js) loads point clouds directly. A thin **`ViewerLayerManager`** (a `Map`-based registry, not an ECS system) tracks the layers that do implement a shared interface; several layers are wired directly into the scene by `PlyViewer` instead.

The viewer and plan panel share state through **`activePlanStore`** (Zustand) plus several purpose-specific stores (`layerVisibilityStore`, `pcdVisibilityStore`, `colorModeStore`, `viewerSettingsStore`, `viewerControlsModeStore`) rather than one unified draft store. `SemanticLayer` and `PlanTasksLayer` observe `activePlanStore` to reflect the current plan draft in the scene.

### 7.2 Component diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  React App (Vite)                                               │
│          ↑                  ↑                                   │
│          └── activePlanStore + layerVisibility/pcdVisibility/ ──┘│
│              colorMode/viewerSettings/viewerControlsMode stores  │
│              (Zustand, split by concern)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PlyViewer                                                │  │
│  │                                                          │  │
│  │  ┌─────────────────┐   ┌──────────────────────────────┐  │  │
│  │  │  Three.js Scene │   │  ViewerLayerManager          │  │  │
│  │  │  ─────────────  │   │  ──────────────────────────  │  │  │
│  │  │  Point cloud    │   │  Map<LayerType, IViewerLayer> │  │  │
│  │  │  (PCDLoader)    │   │                              │  │  │
│  │  │  Mesh           │   │  ┌──────────────────────┐    │  │  │
│  │  │  (PLYLoader,    │   │  │ SemanticLayer         │    │  │  │
│  │  │   plyWorker)    │◄──┤  │ NdtMeasurementLayer   │    │  │  │
│  │  │  Free-fly /     │   │  │ MeshLayer             │    │  │  │
│  │  │  ground-plane   │   │  │ (implement IViewerLayer)│  │  │  │
│  │  │  camera         │   │  └──────────────────────┘    │  │  │
│  │  │  Raycasting ────┼───►  Added directly to scene:    │  │  │
│  │  └─────────────────┘   │  PlanTasksLayer, ImageLayer, │  │  │
│  │                        │  DefectDetectionLayer,       │  │  │
│  │                        │  SelectionLayer              │  │  │
│  │                        └──────────────────────────────┘  │  │
│  │                                                          │  │
│  │  Context menu (HTML overlay)                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ InspectionPlans  │  │ DefectsPanel /   │  │ LayerPanel       │  │
│  │ Panel            │  │ NDT Table        │  │(campaign tree)   │  │
│  │(tasks + status)  │  │                  │  │                  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  @cognite/sdk   |   three.js                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Layer interface

```typescript
type LayerType =
  | 'POINT_CLOUD'
  | 'MESH'
  | 'SEMANTIC_SEG'
  | 'IMAGES'
  | 'DEFECT_DETECTIONS'
  | 'NDT_MEASUREMENTS'
  | 'CHANGE_DETECTION'; // placeholder only — no backing layer (see §1.2)

interface IViewerLayer {
  readonly layerType: LayerType;
  readonly group: THREE.Group;
}
```

This is intentionally minimal compared to earlier PRD revisions — there is no `initialize/load/unload/update/onPick/dispose` lifecycle. Only `SemanticLayer`, `NdtMeasurementLayer`, and `MeshLayer` implement `IViewerLayer` and register with `ViewerLayerManager`; `PlanTasksLayer`, `ImageLayer`, `DefectDetectionLayer`, and `SelectionLayer` are constructed and added to the scene directly by `PlyViewer` without going through the registry. **Follow-up:** decide whether to converge all layers on one lifecycle interface (closer to the original design intent) or formally document the two-tier pattern as intentional.

### 7.4 Marker rendering strategy

*(Renamed from "Heatmap rendering strategy" in v0.9 — no heatmap/colour-ramp rendering exists yet.)*

Defect detections and NDT measurements are rendered as discrete, flat-colour markers rather than density heatmaps:
- **Defect detections** (`DefectDetectionLayer`): a `RingGeometry` + `CircleGeometry` pair per detection, `MeshBasicMaterial`, plus an invisible hit-sphere for picking. Colour reflects status/class, not a continuous probability ramp.
- **NDT measurements** (`NdtMeasurementLayer`): a semi-transparent `SphereGeometry`/`MeshBasicMaterial` per measurement. Colour is not yet mapped against thickness thresholds (see FR-28 note).

There is no `ShaderMaterial`/`THREE.Points` colour-ramp implementation and no UV-projected texture path for dense data. **Follow-up:** if defect-probability or NDT-thickness colour ramps are still wanted, they need to be designed and built — treat the earlier `THREE.Points`/shader approach as one option, not a decision already made.

### 7.5 Semantic highlighting

Structural elements are `StructuralElementView` DM nodes with a single `center` point (§6) — there is no oriented bounding box and no Reveal `NodeAppearanceProvider` (which doesn't exist in this stack).

`SemanticLayer` owns structural element interaction:
- **On area load:** fetch all `StructuralElementView` nodes for the area from DMS; render each as a class-coloured `SphereGeometry`/`MeshBasicMaterial` marker at its `center` point.
- **On pick:** raycast against the marker meshes to identify the hit element.
- **On selection:** change the marker's material to the highlight colour.
- Point clouds additionally support per-point label colouring via `pcdLabelColorizer.ts`, which decodes a label field from the PCD binary header and maps it through the same class-colour palette (`ELEMENT_COLORS`).
- Free-space clicks (not on a semantic marker) are handled by `SelectionLayer`, which draws a ring+disc decal at the hit point.

**Follow-up:** if precise element extents (not just a centroid) are needed for measurement/registration accuracy claims (`KO-5`), this needs its own design — nothing in the current model carries element geometry beyond a point.

### 7.6 PlanTasksLayer

*(Renamed from "TaskLayer" in v0.9 to match the actual class name.)*

`PlanTasksLayer` renders visual markers for the current plan draft. It is **not** backed by CDF directly — tasks exist as local state in `activePlanStore`, populated from/persisted to `InspectionTaskView` via `InspectionTaskService` when the plan is saved.

| Task type | Trigger | 3D representation | Task payload |
|-----------|---------|-------------------|-----------------|
| **Element task** | Click on a semantic element marker | Marker at element `center` | `targetElementExternalId` (relation to `StructuralElementView`), `inspectionType` |
| **Region task** | Click on arbitrary surface point | Marker at clicked surface point | `position3d`, `normalVector`, `radiusM`, `inspectionType` |

```typescript
type InspectionTask =
  | {
      taskKind: 'element';
      id: string;
      targetElementExternalId: string; // relation to StructuralElementView
      inspectionType: InspectionType;
    }
  | {
      taskKind: 'region';
      id: string;
      position3d: [number, number, number];
      normalVector: [number, number, number];
      radiusM: number;
      inspectionType: InspectionType;
    };
```

*(Revised in v0.9 — field names/casing match the shipped `InspectionTaskService` shape, not the earlier `kind`/`targetElement`/`Vector3` draft.)*

```
Inspector explores the 3D model (campaign/result selector defaults to latest)
        │
        ├── ELEMENT CLICK ────────────────────────────────────────────┐
        │   Inspector clicks a semantic element marker                │
        │   Context menu appears (screen space)                       │
        │     ├── Add visual inspection task                          │
        │     ├── Add NDT thickness task                              │
        │     └── (other contextual actions)                          │
        │   Inspector picks type → task created, menu dismissed       │
        │   activePlanStore adds element task (elementRef, type)      │
        │   Element marker colour changes (SemanticLayer)             │
        │   InspectionPlansPanel: new row appended                    │
        │                                                             │
        ├── SURFACE POINT CLICK ──────────────────────────────────────┤
        │   Inspector clicks arbitrary surface point                  │
        │   Raycaster computes hit point + surface normal             │
        │   Context menu appears with region options + radius slider  │
        │     ├── Add visual inspection task (region)                 │
        │     └── Add NDT thickness task (region)                     │
        │   Inspector adjusts radius → live preview updates           │
        │   Inspector confirms → task created, menu dismissed         │
        │   activePlanStore adds region task (pos, normal, radius)    │
        │   Marker rendered on mesh surface (PlanTasksLayer)          │
        │   InspectionPlansPanel: new row appended                    │
        │                                                             │
        └── ALL PATHS CONVERGE ───────────────────────────────────────┘
                │
                ▼
        Inspector saves plan (Draft) ←────────────────────────────────┐
        Inspector marks plan as Ready                                 │
        Inspector may revert to Draft ─────────────────────────────────┘
          (ground station picks up execution → tracked as a separate
           InspectionResultView record, InProgress → Complete)
```

---

## 8. Tech Stack

*(Updated in v0.9 to match `package.json` — several rows changed.)*

| Concern | Technology | Rationale |
|---------|-----------|-----------|
| Framework | React 19 + Vite | Bumped from the originally specified React 18 |
| 3D viewer | Three.js (`three`), custom pipeline — **no `@cognite/reveal`** | Full control over PLY/PCD loading, caching, and camera behaviour; see §7 |
| 3D primitives / overlays | Three.js directly (own `Scene`), `PLYLoader`/`PCDLoader`, Web Worker parsing | Custom layers; flat-colour markers (no shaders/heatmaps yet — see §7.4) |
| CDF integration | `@cognite/sdk` — DMS (`client.instances`, `client.spaces`, `client.views`) + Files API | All structured domain data via DMS; point cloud/mesh/image files via Files API, not ThreeDModels |
| Global state | Zustand | Lightweight; split across several purpose-specific stores (§7.1) rather than one shared draft store |
| UI components | `@cognite/aura` + Tailwind CSS | Replaces the originally specified `@cognite/cogs.js` |
| Charts (trend/reports) | Recharts | Time-series and box plots in the Reports feature (§4.5) |
| Routing | React Router v7 | Bumped from the originally specified v6 |
| Testing | Vitest + React Testing Library | As specified |

---

## 9. Open Questions

| # | Question | Blocks | Owner | Status |
|---|----------|--------|-------|--------|
| OQ-5 | Inspection task JSON schema — co-definition with ground station team | FR-20 | WP4 + WP7 | **Likely resolved in practice** — `InspectionTaskView` is implemented and in use (§6.2, §7.6); needs sign-off from the ground station team that the shipped shape (`taskKind`, `targetElementExternalId`, `position3d`/`normalVector`/`radiusM`) is what they expect to consume, and a decision on whether plan status needs an `InProgress` value (§4.3) |
| OQ-6 | NDT thresholds per element class — to be specified by DNV | FR-25/FR-28 | DNV | Open — colour-coding against thresholds is also not yet implemented in the viewer (§7.4), so this blocks code, not just spec |
| OQ-7 | CDF tenant and DMS space structure — one space per vessel owner or shared? | Section 6 | CGN | **Resolved** — implementation uses a single shared space, `autoassess`, confirmed in `dataModel.ts` and `.env`/`manifest.json` |
| OQ-8 | *(New in v0.9)* Is the Change Detection layer (§4.2.3, §6) still required for v1, or should it move fully to Phase 2? Nothing is built today. | §1.2, FR-26 | Product | Open |
| OQ-9 | *(New in v0.9)* Is the audit trail (NFR-07) still a v1 requirement? Nothing is built today — no `AuditEventView`, no logging call. | NFR-07 | Product/Compliance | Open |
| OQ-10 | *(New in v0.9)* Does the lack of oriented-bounding-box geometry for structural elements (single `center` point only) put `KO-5`'s <1cm registration accuracy claim at risk for any planned use case? | KO-5, §6 | Product/DNV | Open |

---

## 10. Acceptance Criteria (KPI Traceability)

| Proposal KPI | UI-DSS acceptance criterion |
|-------------|----------------------------|
| **KPI-6:** Inspector completes inspection in < 6h | A non-expert user can plan, save, and mark ready a full BWT inspection campaign within 6 hours, measured in moderated usability testing |
| **KO-5:** < 1cm relative accuracy of defect/NDT registration | Viewer renders measurement positions using CDF-provided coordinates with no additional positional error introduced by the rendering pipeline |
| **KO-6:** Campaign planning, storage, and visualisation from GUI | All operations completable without leaving the app |
| **KO-7:** 3 demonstrations in 3 vessel types | App validated against bulk carrier (M38), container (M42), and tanker (M46) real inspection datasets |

---

## 11. Feature Priority Summary

*(Status column added in v0.9 to reflect actual implementation state.)*

| Feature | Priority | Phase | Status |
|---------|----------|-------|--------|
| Fleet & vessel overview | P0 | MVP | Shipped |
| Vessel/area create, rename, delete | — | *(not previously scoped)* | Shipped |
| 3D viewer — point cloud + mesh (custom Three.js pipeline) | P0 | MVP | Shipped (Reveal replaced — §7) |
| 3D viewer — per-layer campaign scoping | P0 | MVP | Shipped |
| 3D viewer — semantic overlay | P0 | MVP | Shipped (point marker, not OBB — §6, §7.5) |
| Context menu (element + region tasks) | P0 | MVP | Shipped |
| Plan panel + storage + ready transition | P0 | MVP | Shipped |
| Post-campaign defect panel + annotation | P0 | MVP | Shipped |
| Post-campaign NDT thickness table | P0 | MVP | Shipped (colour-coding vs. thresholds pending OQ-6) |
| Image hotspot layer | P1 | MVP | Shipped |
| Defect heatmap overlay | P1 | MVP | Partially shipped — flat-colour markers only, no probability colour ramp (§7.4) |
| NDT thickness heatmap overlay | P1 | MVP | Partially shipped — flat-colour markers only, no thickness colour ramp (§7.4) |
| Change detection layer | P2 | MVP or Phase 2 | **Not started** — see OQ-8 |
| Suggestions | — | ~~Deferred to v2~~ **Shipped** (rule-based v1 — §4.3.2) | Shipped |
| Reports (in-app dashboards) | — | *(not previously scoped)* | Shipped — see §4.5; not the same as exportable report generation below |
| Report generation (exportable/printable documents) | — | Phase 2 | Not started |
| Side-by-side epoch rendering | — | Phase 2 | Not started |
| Audit trail (NFR-07) | — | *(not previously scoped as a phase)* | **Not started** — see OQ-9 |