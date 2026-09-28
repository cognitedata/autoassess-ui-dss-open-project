# AutoAssess Drone Sandbox

A self-contained Flows web app for integration week. Integrators write and run **Python in the
browser** (Pyodide, no local setup) against the same `uidss` SDK calls a ground station uses, then
**send off a simulated drone** that flies the plan's tasks over the vessel area:

> run script → see plans → verify them → fly `sim_drone` → watch the tasks → plan Complete (simulated)

- **Left:** CodeMirror Python editor with starter examples, Run / Stop / Reset, console.
- **Right:** 2D simulator (top view x–y and side view x–z): area geofence, structural elements,
  task targets, the drone (with its heading) flying its path, tasks turning green, a task list
  with each task's state (pending → en route → inspecting → inspected / skipped) and the plan's
  status, mission log and summary. The replay is deterministic, time-scaled (1×–25×), pausable
  and scrubbable.

This folder is independent of the root app: its own `package.json`, lockfile, Vite config,
`manifest.json` and `app.json`. It never writes to CDF (plan status updates are simulated in the
browser).

## Run it

```bash
cd sandbox
npm install
npm run dev            # http://localhost:3010, demo mode (bundled data, no login)
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on **3010**, plain HTTP, demo mode. Doesn't open a browser. |
| `npm run dev:fusion` | HTTPS dev server on 3010 plus the Fusion development URL (`…/development/autoassess-drone-sandbox/3010`) for live mode inside Fusion. |
| `npm test` | Vitest (unit, component and **real-Pyodide** integration tests). |
| `npm run typecheck` | `tsc` for the app and the Node-side config. |
| `npm run build` | Type-check and production build into `dist/` (Pyodide files in `dist/pyodide/`). |
| `npm run preview` | Serves `dist/` on **3011** with the **production Flows CSP** on every response. |
| `npm run e2e` | Headless Playwright smoke test (`BASE_URL`, `SCREENSHOT_DIR`, `TAG` env vars). Needs `npx playwright install chromium` once. |

### Demo mode vs live mode

| | Demo mode | Live mode |
|---|---|---|
| When | The page isn't framed (e.g. `localhost:3010`), or `?mode=demo` | Inside Fusion (framed) |
| Data | Bundled fixtures: 1 vessel, 2 areas, 4 plans. BWT 3P uses the 103 structural elements from `sdk/tests/fixtures/ssg.yaml`. One Draft plan is broken on purpose. | Your CDF project, **read-only**, through the host-authenticated `CogniteClient` (`@cognite/app-sdk`'s `CogniteSdkProvider` / `useCogniteSdk`) |
| Switch | – | The header dropdown switches between CDF and the demo data |

If the Fusion handshake fails, the app falls back to demo data and shows a notice.

Live mode loads a **snapshot** before running Python: vessels, areas and plans (soft-deleted ones
excluded), all tasks, and all structural elements from the `autoassess` space (paginated, at most
20 × 1000 nodes per view, requests sent one after another). Use **Reload** to fetch fresh data.
It uses the view versions in `src/data/cdfModel.ts`, a mirror of the repo's authoritative
`src/shared/cdf/dataModel.ts`; `cdfModel.test.ts` fails if they drift apart. The only CDF
capability the data layer gets is `instances.list` (`InstanceReader`), so writing is impossible by
construction.

## Python API

The in-browser `uidss` package has the **same names and shapes as the real SDK**
(`sdk/src/uidss`), so read-side code transfers unchanged to a ground station
(`uv run python script.py`).

```python
from uidss import UidssClient

client = UidssClient.from_env()          # sandbox: the browser's snapshot (demo or CDF)
client.vessels.list()                                    # -> list[Vessel]
client.areas.list(vessel_space, vessel_external_id)      # -> list[Area]
client.plans.list(area_space, area_external_id)          # -> list[InspectionPlan], newest first
client.plans.count_tasks([plan_eid, ...])                # -> dict[str, int]
client.plans.list_tasks(plan_eid)                        # -> list[InspectionTask]
client.plans.download(space, plan_eid, area_name, Path("plans/p.json"))  # writes plan.json
```

- Models (`uidss.models`) are the SDK's frozen dataclasses: `Vessel`, `Area`, `InspectionPlan`,
  `InspectionTask`, `ElementTarget`, `StructuralElement`. Constants: `uidss.cdf.data_model`.
- `plans.download()` writes **exactly the SDK's `plan.json` layout** (`planExternalId`, `name`,
  `description`, `areaExternalId`, `areaName`, `mapExternalId`, `downloadedAt`, `tasks[]`) into
  Pyodide's in-memory filesystem. Read it back with `json.loads(Path(...).read_text())`. Files
  last until **Reset**.
- **Nothing is ever written to CDF.** `plans.update_status(space, eid, "Complete")` is
  **simulated**: after a `SimDrone` flight of that plan has landed in the same run it changes the
  browser's copy of the data only (the plan's status pill flips to Complete, later `plans.list()`
  calls return it, the console prints `simulated: plan <id> → Complete (not written to CDF)`).
  **Reload** or switching the data source undoes it. Any other status, or a plan that wasn't
  flown and landed, raises `SandboxReadOnlyError` (a `PermissionError`).
- The upload services (`client.campaigns`, `artifacts`, `structural_elements`, `measurements`,
  `campaign_metrics`, `drone_images`, `threed`) aren't available: accessing them raises an
  `AttributeError` that says so (so `hasattr(client, "campaigns")` is `False`). On a ground station
  `dss campaign upload` runs before `update_status`.

### The simulated drone: `SimDrone`

`SimDrone` is the sandbox's drone. Name the instance `sim_drone` so it's obvious it is the
simulator, not your robot. Its flight verbs are the interface a real drone driver implements;
every call blocks until the step is done (in simulated time) and is drawn in the simulator panel.

```python
from dss_sandbox import SimDrone, Pose, pose_for_task, BatteryLowError

sim_drone = SimDrone(speed_mps=0.5, max_flight_time_s=900.0, home=None)  # home None = area take-off point
issues = sim_drone.load_plan(plan)          # plan.json dict or path -> list[PreflightIssue]
sim_drone.takeoff(height_m=1.0)             # -> Pose
p = sim_drone.goto(Pose(x, y, z, roll=0.0, pitch=0.0, yaw=1.57))   # straight leg -> reached Pose
sim_drone.inspect(task_id, seconds=None)    # hover + capture here; None = 3 s visual / 8 s ndt_thickness
sim_drone.return_home()                     # -> Pose above home at take-off height
sim_drone.land()                            # -> Pose; tasks not inspected by now count as skipped

sim_drone.pose, sim_drone.state             # Pose, "landed" | "flying"
sim_drone.flight_time_s, sim_drone.distance_m
sim_drone.preflight_check()                 # -> list[PreflightIssue(task_id, severity, code, message)]
sim_drone.on_event(callback)                # callback(MissionEvent(t, kind, message, task_id)) as each step happens
sim_drone.report()                          # -> MissionReport(plan_external_id, visited, skipped, distance_m,
                                            #    duration_s, events, telemetry); .summary()
sim_drone.fly_plan(plan, order=None, standoff_m=0.8)   # -> MissionReport (the whole loop, see below)
```

- **`Pose(x, y, z, roll=0, pitch=0, yaw=0)`**: frozen dataclass, metres in the area's map frame
  (`mapExternalId`), radians. `yaw` is the heading counter-clockwise from +x, `pitch` the camera
  elevation (−π/2 looks straight down). `.position`, `.distance_to(other)`,
  `Pose.facing(target, normal, standoff_m)`.
- **`pose_for_task(task, standoff_m=0.8, approach_from=None)`**: the hover pose for a plan.json
  task, facing its surface. Region tasks back off along `normalVector`; element tasks stop short of
  the element centre on the line from `approach_from` (from above if not given). Raises
  `ValueError` for a task without a pose.
- **Errors:** `RuntimeError` for the wrong state (e.g. `goto` before `takeoff`), `ValueError` for
  bad input or `inspect` of a task with a pre-flight error (the task is recorded as skipped),
  `BatteryLowError` (a `RuntimeError`) when a `goto`/`inspect` would leave too little battery to get
  home; the drone doesn't move, you `return_home()` and `land()`.
- **`fly_plan`** is plain Python on top of the verbs (read it in `dss_sandbox/simdrone.py`):
  `load_plan` → `takeoff` → for each task (in `order`, or greedy nearest-neighbour) `goto(pose_for_task(...))`
  + `inspect` → `return_home` → `land`. It skips tasks with pre-flight errors and turns back on
  `BatteryLowError`.
- One simulated drone per run: a new `SimDrone(...)` replaces the previous one (not while flying).

| | On your ground station (you implement for your drone) | Sandbox only |
|---|---|---|
| Flight verbs | `takeoff()`, `goto(Pose)`, `inspect(task_id)`, `return_home()`, `land()` | `SimDrone` implements them kinematically |
| Feedback | mission events (take-off, arrived, inspected, skipped, landed), current pose, battery | `on_event`, `pose`, `state`, `flight_time_s`, `distance_m`, `report()` |
| Mission logic | your planner; `fly_plan` is a template | `fly_plan`, `pose_for_task`, `Pose` (copy them if they fit) |
| Checks | your pre-flight | `preflight_check()`, `area_bounds()`, `structural_elements()` |
| After landing | `dss campaign upload`, then `client.plans.update_status(..., "Complete")` | `update_status(..., "Complete")` simulated; uploads unavailable |

Area helpers:

```python
from dss_sandbox import area_bounds, structural_elements

area_bounds(area_eid)            # -> Bounds(min, max) | None  (.contains(p), .size)
structural_elements(area_eid)    # -> list[ElementInfo(external_id, element_type, label, center)]
```

### Simulator model

Kinematic only, no physics: `takeoff` climbs straight up from `home` (default: the low −x end of
the area), `goto` flies a straight line at `speed_mps`, `inspect` hovers, `return_home` flies to the
point above home, `land` descends.

- **Inspection time:** 3 s for `visual`, 8 s for `ndt_thickness` (or `seconds=`).
- **Pre-flight errors** (the task can't be inspected): no pose, or a target outside the area bounds.
- **Area bounds** are the box around the area's structural elements plus 0.3 m. An area without
  elements has no geofence.
- **Battery:** `goto` and `inspect` refuse (`BatteryLowError`) when the step plus the way home
  would exceed `max_flight_time_s`. Tasks left at landing are reported as skipped (reason: the
  pre-flight error, `battery reserve reached`, or `not inspected`).
- **Task states in the panel:** pending → en route (the legs flown before a task's inspection are
  attributed to it) → inspecting → inspected, or skipped.

The simulator lives in TypeScript (`src/sim/simulator.ts`, `FlightRecorder`), so Python's report
and the UI animation come from the same computation.

## Starter examples

1. **List plans:** the same calls as `dss plan list`: vessels → areas → plans with task counts.
2. **Verify a plan:** downloads every `plan.json` and checks that every task has a pose, targets are
   inside the area bounds, and normals are unit length. It also counts tasks by type. In demo mode
   the Draft plan fails 3 checks.
3. **Fly the mission:** picks the newest Ready plan, downloads it, flies it with
   `sim_drone = SimDrone(); sim_drone.fly_plan(plan)` (nearest-neighbour order), prints the events
   and the summary, and marks the plan Complete with `client.plans.update_status(...)`
   (simulated, nothing is written to CDF).
4. **Hand-fly with poses:** the same mission written out with the verbs: `load_plan`, `takeoff`,
   `pose_for_task` + `goto` + `inspect` per task, `return_home`, `land`, with `on_event` printing.
   This is the template for a real drone driver.

Ctrl/⌘+Enter runs the editor contents. Edits are kept per example while you switch between them.
**Reset** restores the current example and starts a fresh interpreter.

## How it works

```
main thread                                   Web Worker (module)
───────────                                   ──────────────────
SnapshotSource (demo | CDF read-only) ─┐
useSandboxViewModel ── PythonRuntime ──┼─ postMessage ─▶ workerHandler ─▶ PythonSession (Pyodide)
     │                  (stop/timeout =│                     │  uidss / dss_sandbox (.py, bundled)
     │                   terminate)    │                     └─ _sandbox_bridge (JS) ─▶ src/sim
SimulatorPanel ◀── mission ◀───────────┘◀──── stdout / stderr / mission / snapshot-patch / done
useMissionPlaybackViewModel (rAF replay)
```

- Pyodide runs in a module Web Worker, so the UI never freezes. **Stop** (and the 30 s run
  timeout) terminates the worker and boots a fresh one (about 1.5 s), because interrupting Python
  in place would need `SharedArrayBuffer` and cross-origin isolation, which a Fusion-embedded app
  can't count on.
- The SDK's calls are synchronous (like the real SDK), so the data is a snapshot loaded before the
  run. The worker never awaits CDF mid-script.
- Code layout: `src/data` (sources), `src/domain` (types, plan.json parser), `src/sim`
  (simulator + playback, pure), `src/python` (worker, session, bridge, `py/` packages),
  `src/features` (view models + components), `src/examples`.

## CSP notes (Flows `manifest.json`)

The Flows CSP is `script-src 'self'`, `connect-src 'self' https://*.cognitedata.com …`,
`worker-src 'self' blob:` (see `@cognite/app-sdk/dist/vite/manifest-csp.js`). What the sandbox
needs:

- **`'wasm-unsafe-eval'` in `script-src`.** This is the only manifest entry:
  `{"sources": ["'wasm-unsafe-eval'"], "directives": ["script-src"]}`. Without it, WebAssembly
  compilation is blocked (verified: removing it makes Pyodide fail inside the worker).
- **Pyodide is self-hosted.** `pyodide.asm.mjs`, `pyodide.asm.wasm`, and
  `pyodide-lock.json` are copied from `node_modules/pyodide` into `dist/pyodide/` (and served at
  `/pyodide/` in dev) by a small plugin in `vite.config.ts`. `indexURL` and `packageBaseUrl` both
  point there. The jsdelivr URL in the worker bundle is Pyodide's default package CDN, which is
  overridden and never contacted. No micropip packages are loaded.
- **The Python standard library is embedded in the worker.** Flows App Hosting refuses to host
  archive files (`.zip`, `.bin`, `.data` were all rejected), so `python_stdlib.zip` is imported with
  Vite's `?inline` into `sandbox.worker.ts`, and `src/python/embeddedStdlib.ts` answers Pyodide's
  request for it from those bytes. This adds about 3.4 MB to the worker script.
- **Workers:** the worker is a same-origin module script (`worker-src 'self'` is enough, no
  `blob:` needed). Everything is loaded with `import()` and `fetch()` from `'self'`. There's no
  `eval`, no inline scripts, and no CDN.
- `npm run preview` sends the **production** CSP on *every* response, including the worker
  script, whose own CSP governs the worker. The smoke test passes there with zero CSP violations.
- The app-sdk dev CSP plugin runs in `serve` only. In a build it would inline its
  CSP-reporter `<script>`, which the production CSP blocks.
- If a host serves `.wasm` without `application/wasm`, `instantiateStreaming` throws and Pyodide
  would hang. `src/python/wasmFallback.ts` then compiles from bytes instead (verified in a browser
  against a server that sends `application/octet-stream`). A 60 s boot timeout turns any other
  silent Pyodide hang into a visible error.

## Deploying as a Flows app (not done)

`app.json` is prepared (`externalId: autoassess-drone-sandbox`, same org/project as the root app,
`published: false`). When you want it:

```bash
cd sandbox && npm run build
npx @cognite/cli@latest apps deploy --interactive
```

Check that the hosting accepts the ~13 MB `dist/pyodide/` payload (the 9.6 MB wasm is the biggest
file).

## Known limitations

- **Download size:** about 14 MB on first load (wasm 9.6 MB, 3.6 MB gzipped; stdlib 2.5 MB; app
  JS about 0.7 MB). After that the browser caches it. Python is ready about 1.5 s after the assets
  arrive.
- **Stdlib only.** numpy, pandas and other packages would need their wheels self-hosted too
  (micropip and the CDN are blocked by the CSP).
- **Snapshot, not live queries.** Changes in CDF show up after **Reload**. Very large projects are
  capped at 20 000 nodes per view.
- **Read-only.** Mission uploads are refused and plan status updates are only simulated in the
  browser, on purpose. Both work on a real ground station.
- **The simulator is kinematic:** no obstacles, collisions or tank walls (only the bounding-box
  geofence), and constant speed.
- **Stop restarts Python**, which wipes the in-memory filesystem, like Reset.
- In-place interrupts would need COOP/COEP headers, which Flows doesn't provide.
- Live mode is unit-tested against a fake `instances.list` but hasn't been run inside Fusion yet.
