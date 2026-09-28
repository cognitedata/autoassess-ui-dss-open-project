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
  and scrubbable. When the **simulated gbplanner** flew, its explored map, RRG graph, best path,
  camera view and inspection viewpoints are drawn too, with a planner status strip.

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

### Simulated gbplanner: `SimGbPlanner`

A **simulated gbplanner3 / OmniPlanner** (NTNU ARL,
[ntnu-arl/gbplanner_ros](https://github.com/ntnu-arl/gbplanner_ros), branch `gbplanner3`) that
flies `sim_drone`. The **interface** is gbplanner's: the real service and topic names, and
ROS-shaped messages with the `.msg`/`.srv` field names. The **planner** behind it is a small,
deterministic TypeScript stand-in (`src/planner`), not the real C++ planner. Name the instance
`sim_gbplanner`.

```python
from dss_sandbox import SimDrone
from dss_sandbox.gbplanner import SimGbPlanner, planner_msgs, geometry_msgs, std_msgs, std_srvs

sim_drone = SimDrone(speed_mps=1.0, max_flight_time_s=1800)
sim_drone.load_plan(plan)                           # the plan's area becomes the (synthetic) tank
sim_gbplanner = SimGbPlanner(sim_drone, config="bwt_inspection", seed=0, verbose=True)
ros = sim_gbplanner.ros                             # rospy-like: call / publish / subscribe / spin
ros.subscribe("/gbplanner_path", on_path)           # callback(nav_msgs.Path), once per planning iteration
ros.call("pci_initialization_trigger")              # take off, move in
ros.call("planner_control_interface/std_srvs/automatic_planning")
ros.spin()                                          # until idle (or ros.spin(until_s=...))
sim_drone.land()
print(sim_gbplanner.report().summary())
```

| Sandbox call | On a ground station (rospy) | Type |
|---|---|---|
| `ros.call("pci_initialization_trigger")` | service `pci_initialization_trigger` | `planner_msgs/pci_initialization` |
| `ros.call("planner_control_interface/std_srvs/automatic_planning")` | same service | `std_srvs/Trigger` |
| `ros.call("planner_control_interface/std_srvs/single_planning")` | same service | `std_srvs/Trigger` |
| `ros.call("planner_control_interface/std_srvs/homing_trigger")` | same service | `std_srvs/Trigger` |
| `ros.call("planner_control_interface/std_srvs/go_to_waypoint")` | same service | `std_srvs/Trigger` |
| `ros.call("planner_control_interface/std_srvs/stop")` | same service | `std_srvs/Trigger` |
| `ros.call("planner_control_interface/std_srvs/inspection_srv_trigger")` | same service | `std_srvs/Trigger` |
| `ros.call("gbplanner/set_global_bound", req)` | same service | `planner_msgs/planner_set_global_bound` |
| `ros.call("gbplanner/switch_operation_mode", SetBool.Request(data=True))` | same service (true = WP / target reach) | `std_srvs/SetBool` |
| `ros.call("gbplanner/set_planning_trigger_mode", req)` | same service | `planner_msgs/planner_set_planning_mode` |
| `ros.publish("/move_base_simple/goal", to_pose_stamped(pose))` | topic `/move_base_simple/goal` | `geometry_msgs/PoseStamped` |
| `ros.publish("/robot_status", RobotStatus(time_remaining=...))` | topic `/robot_status` | `planner_msgs/RobotStatus` |
| `ros.publish("planner_control_interface/stop_request", Bool(data=True))` | topic `planner_control_interface/stop_request` | `std_msgs/Bool` |
| `ros.subscribe("/gbplanner_path", cb)` | topic `/gbplanner_path` (what the BWT rviz config shows) | `nav_msgs/Path` |
| `ros.subscribe("/robot_status", cb)` | topic `/robot_status` | `planner_msgs/RobotStatus` |
| `ros.spin()` | `rospy.spin()`, with the robot flying the path | |

- **Names:** a leading `/` is optional. An unknown service or topic raises `ValueError` listing
  the supported ones (`SERVICES`, `INPUT_TOPICS`, `OUTPUT_TOPICS`). A request or message of the
  wrong type raises `TypeError`. `call()` without a request sends the default `Request()`.
- **Messages** are plain dataclasses in `std_msgs` (`Header(seq, stamp, frame_id)`, `Bool`),
  `geometry_msgs` (`Point`, `Quaternion`, `Pose`, `PoseStamped`), `nav_msgs` (`Path`), `std_srvs`
  (`Trigger`, `SetBool`, with `.Request`/`.Response` and `TriggerRequest`-style aliases) and
  `planner_msgs` (`PlanningBound`, `RobotStatus`, `TriggerMode`, `BoundMode`, `PlanningMode`,
  `ExecutionPathMode`, `PlannerStatus`, and the services `planner_set_global_bound`,
  `planner_set_planning_mode`, `pci_initialization`). `stamp` is float seconds of simulated
  flight time (rospy: `rospy.Time`), `frame_id` is `"world"`.
- **Poses:** `to_pose_stamped(pose, frame_id="world", stamp=0.0)` and `to_sandbox_pose(msg)`
  convert, `quaternion_from_euler` / `euler_from_quaternion` work like `tf.transformations`. ROS
  pitch is nose-down positive, the sandbox `Pose.pitch` is camera elevation, so
  **ROS pitch = −`Pose.pitch`**.
- **`SimGbPlanner(sim_drone, config="bwt_inspection" | "cave_exploration", seed=0, verbose=True)`**
  needs a loaded plan (the area). `.ros`, `.drone`, `.mode`, `.config`, `.synthetic_tank`,
  `.status()` (a `planner_msgs.PlannerStatus`, sandbox convenience), `.report()`. With
  `verbose=True` the planner's log prints as `[gbplanner] ...` lines.
- **`report()`** → `GbPlannerReport(config, mode, iterations, explored_pct, surface_coverage_pct,
  distance_m, duration_s, viewpoints, covered_tasks, uncovered_tasks, voxel_resolution_m, voxels,
  synthetic_tank)`, `.summary()`. `covered_tasks` maps plan task ids to the simulated time the
  inspection camera covered them (within viewing range, in the field of view, line of sight, facing
  a region's normal). `mode` is `idle | initialization | exploration | inspection | target-reach |
  waypoint | homing`.
- **Behaviour:** `bwt_inspection` works the tank **one compartment at a time**, like the real
  BWT behaviour tree (`le_insp_opening`: SetNextCompartment → explore → inspect → pass the
  opening → repeat). The tank is segmented into compartments at the transverse frames; each
  compartment is explored (local RRG, volumetric gain, repositioning to frontiers inside the
  compartment) until exhausted, then its mapped surfaces get an inspection tour (greedy set
  cover of camera viewpoints up to `min_coverage_percentage` / `max_inspection_vertices`,
  ordered along the global graph), then a target reach through the manhole enters the next
  compartment; homing after the last one. `report().compartments` lists explored % / coverage %
  per compartment. `cave_exploration` explores globally and goes home. **WP mode** (`switch_operation_mode` true) is target reach: each goal on
  `/move_base_simple/goal` is approached through unknown space and given up after a few
  iterations without progress, or at once if the goal is outside the global bound or inside mapped
  structure. `go_to_waypoint` follows the global graph through known free space only. A
  **HomingCheck** over every path (battery and published `time_remaining`) triggers homing.
- **In the panel:** the explored map (free / structure / inspected surface, projected per view),
  the current iteration's RRG graph and best path, the camera's field of view, the numbered
  inspection viewpoints (faded once flown to), all at the playback time, with layer toggles; a
  status strip (mode, iteration, explored %, coverage %, time remaining, "Compartment k/N" while
  the BWT flow sequences compartments, tasks covered) and tasks marked "covered at t = … s".

**How the simulation differs from gbplanner3** (be careful what you conclude from it):

- **The tank is synthetic.** The real campaign point cloud isn't loaded: a voxel world (0.15 m) is
  generated from the area bounds and structural elements: a closed shell with an access hatch at
  the take-off point, transverse frames with holes at manhole elements, small plates and 1.2 m
  longitudinal bars. Ideal, noise-free mapping (a voxel is final once seen).
- **Much simpler algorithms and smaller numbers:** 120 vertices per local RRG (gbplanner: 400),
  300 inspection candidate positions (500), 8 headings × 3 pitches per candidate. Kinematic flight
  along straight segments at constant speed, no dynamics, no MPC.
- **Deliberate deviations:** RRG sampling is biased towards the openings (manholes) the synthetic
  tank was built with; inspection viewpoints may be pitched (±0.6 rad); compartments are x-slabs
  between the synthetic tank's transverse frames (the real planner segments its map), and the
  per-compartment inspection uses proportionally fewer candidate positions to stay inside the
  compute budget; the init motion's `z_drop` is omitted.
- Only the services and topics in the table exist (plus the `/autoassess/*` topics of the
  [simulated autoassess_bridge](#simulated-autoassess_bridge-autoassess) below); parameters
  (`gbplanner_config.yaml`) are fixed
  per config (values copied from the gbplanner3 `bwt_inspection` / `cave_exploration` configs
  where they apply, see `src/planner/configs.ts`).
- Timing: example 5 (a full BWT run over the demo tank's 5 compartments, ~205 s simulated,
  ~135 viewpoints) takes about 3.5 s of compute in the browser worker.

Attribution: service/topic names, message definitions and parameter values come from NTNU ARL's
gbplanner_ros (gbplanner3), BSD-3-Clause, © Autonomous Robots Lab, NTNU. No gbplanner code is
included.

### Simulated autoassess_bridge (`/autoassess/*`)

On the robot, AutoAssess is reached through the **autoassess_bridge** ROS node
(`gbplanner_ros/autoassess_bridge`): it follows the newest Ready plan in CDF and publishes it
latched, buffers findings from the detection stack, and at mission end uploads the mission and
reports progress. `sim_gbplanner.ros` answers the same topics in the browser, fed from the plan
loaded into `sim_drone` (see starter example 7):

| Sandbox call | Real autoassess_bridge behaviour | Type |
|---|---|---|
| `ros.subscribe("/autoassess/plan", cb)` | latched plan.json of the newest Ready plan (`dss plan download` text). Sandbox: the plan loaded with `sim_drone.load_plan(plan)`, re-serialised | `std_msgs/String` |
| `ros.subscribe("/autoassess/plan_id", cb)` | latched plan externalId | `std_msgs/String` |
| `ros.subscribe("/autoassess/inspection_targets", cb)` | latched: one inspection pose per task in task order (region: `standoff_m` 0.8 out along the normal; element: 0.8 above the centre looking down; tasks without a target left out and logged) | `geometry_msgs/PoseArray` |
| `ros.publish("/autoassess/findings", msg)` | JSON, one object or an array: `x, y, z` required; `id` (no `+`, ≤ 200 chars, default = a hash, deduped first-wins), `nx, ny, nz` (all or none, non-zero), `radius` (> 0), `inspection_type` (`visual` \| `ndt_thickness`), `class`, `confidence` (0..1), `description`. Bad entries are skipped and logged (once per distinct error), good ones buffered for the mission. Sandbox nicety: a plain dict / list is accepted too | `std_msgs/String` |
| landing (or `ros.call("autoassess_bridge/upload_mission")`) | mission end: the node exports the voxblox mesh, uploads mesh + point clouds as a CDF campaign, and turns the buffered findings into **defect detections** on that campaign (status New, source ml) — reviewed in the AutoAssess Defects tab, where confirmed ones become tasks via the Suggestions flow. Sandbox: the upload and the defect detections are **simulated** (console: `simulated: N defect detections created on the campaign (not written to CDF)`); each buffered finding becomes id `defect-<finding id>` | `std_srvs/Trigger` |
| `ros.subscribe("/autoassess/upload_status", cb)` | latched JSON: `state` (`idle → exporting_mesh → uploading → complete` \| `failed`), `missionId`, `areaExternalId`, `planExternalId`, `campaignExternalId`, `cdfFileIds`, …, `message`, `updatedAt`, and on the final status `findings: {count, defectExternalIds}` (`null` without findings) | `std_msgs/String` |

Limitations of the twin: nothing is uploaded and no campaign or defect nodes are written to CDF
(the campaign/defect ids exist only in the status JSON); `/ballast_tank/pointcloud` (the
reference map) and the global-bound push from the real node are not simulated (example 5 sets
the bound itself); the plan topics deliver on subscribe but are not re-published if another plan
is loaded later; `cdfFileIds` stay empty and `updatedAt` is simulated flight seconds, not wall
time. A mission ends at `sim_drone.land()` (the real node detects homing + stillness on
odometry); each take-off starts a new mission (`mission-001`, `mission-002`, …).

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
5. **gbplanner: explore + inspect:** `SimGbPlanner` in BWT mode: sets the global bound from the
   area bounds (`gbplanner/set_global_bound`), subscribes to `/gbplanner_path`, calls
   `pci_initialization_trigger` and `automatic_planning`, spins until it's home. The flow works
   the tank one compartment at a time (explore → inspect → pass the manhole), and the report
   prints coverage per compartment and which plan tasks the camera covered, and when. In demo
   mode: 5 compartments, 8/8 covered.
6. **gbplanner: target reach per task:** WP mode (`gbplanner/switch_operation_mode`), one
   `/move_base_simple/goal` per plan task (trying a few standoff poses when the planner refuses one
   inside the structure), `sim_drone.inspect` when reached, then `homing_trigger`. In demo mode:
   7/8 inspected (one region task has no free standoff pose in the synthetic tank).
7. **bridge: plans in, findings out:** the autoassess_bridge integration a partner runs on the
   robot: read the latched plan from `/autoassess/plan` (+ `plan_id`, `inspection_targets`), fly
   the tasks, publish findings on `/autoassess/findings` (including a bad one, which is skipped
   and logged), land, and watch `/autoassess/upload_status` go
   `idle → exporting_mesh → uploading → complete` with the simulated defect detections.

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
  (simulator + playback, pure), `src/planner` (simulated gbplanner: synthetic tank, voxel map,
  RRG, inspection, PCI state machine, playback; pure), `src/python` (worker, session, bridge,
  `py/` packages), `src/features` (view models + components), `src/examples`.

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
  geofence), and constant speed. `SimDrone` alone can fly through structure; only the simulated
  gbplanner plans around its (synthetic) voxel map.
- **The simulated gbplanner is not gbplanner:** same interface, simplified planner, synthetic
  tank (see [Simulated gbplanner](#simulated-gbplanner-simgbplanner)). Use it to develop the
  integration (calls, messages, callbacks), not to predict the real planner's paths or coverage.
- **The simulated autoassess_bridge writes nothing:** the upload, campaign and defect-detection
  ids exist only in the `/autoassess/upload_status` JSON (see its mapping table). The findings
  validation and buffering rules match the real node's.
- **The panel shows a run after it finishes:** a script that doesn't `await` runs synchronously in
  the worker, so the mission (and the planner map) reaches the UI when the script ends, then
  replays. A gbplanner run must also fit in the 30 s run timeout (example 5 needs about 2.5 s).
- **Stop restarts Python**, which wipes the in-memory filesystem, like Reset.
- In-place interrupts would need COOP/COEP headers, which Flows doesn't provide.
- Live mode is unit-tested against a fake `instances.list` but hasn't been run inside Fusion yet.
