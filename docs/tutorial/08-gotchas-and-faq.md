# 8. Gotchas, etiquette and FAQ

## Shared-project etiquette

Everyone shares **one CDF project** (`autoassess-dev`) during the week. To avoid stepping on each other:

1. **Prefix everything you create** with your partner prefix: vessel names (`ntnu – Test Vessel`), external IDs you choose (`ml-ntnu-…`), file names.
2. **Stay inside your own vessels and areas.** Don't edit, complete or delete other teams' plans, campaigns or defects.
3. **No schema changes** (new containers, views or properties) without the AutoAssess team. Views are shared by everyone.
4. **Don't deploy the web app** (`npm run deploy`). Run it locally with `npm run dev`.
5. **Throttle bulk jobs.** Batch ≤ 1000 nodes per write and avoid large parallel fan-outs.
6. **Never commit secrets.** `.env` files are gitignored; keep it that way.
7. Clean up throwaway test data when you're done.

## Known issues

These are current limitations of the stack. Work around them, or pick one as an integration-week task.

| # | Issue | Impact / workaround |
|---|---|---|
| 1 | **Older files are classic Files API files.** Everything uploaded before the CogniteFile switch, and anything from `scripts/upload-3d.ts`, has no instance ID. | They still load by numeric ID. Only create new files as `CogniteFile` ([chapter 2](02-data-model.md#files-api-vs-data-modeling-read-this-its-the-non-obvious-part)). |
| 2 | **The CLI is interactive only.** | For automation, use the Python API ([chapter 4, part 2](04-ground-station-sdk.md#part-2-scripting-with-the-python-api-non-interactive)). |
| 3 | `dss plan download` lets you pick **any** plan status. | Pick a **Ready** plan. Draft plans may still change. |
| 4 | `campaigns.update_file_ids` **overwrites** the file lists. | Pass the existing IDs plus your new ones (the CLI already does this). |
| 5 | Every PLY/PCD upload creates a **new** `CogniteFile` (unique external ID), even if a file with the same name exists. | Re-running an upload duplicates files; avoid re-uploading. Drone images use deterministic IDs per campaign and frame. |
| 6 | `DroneImage` links to its campaign by **text** (`campaignExternalId`), not by a direct relation. | Filter on `DroneImageContainer.campaignExternalId` with a plain string. |
| 7 | `upload-drone-images` writes a zero bounding box and doesn't update the campaign's file lists. | Expected for now. |
| 8 | `npm run setup-dm` doesn't create `InspectionPlanView` v4 (`map`). | Only matters if you set up your **own** CDF project: run `sdk/scripts/migrate_inspection_plan_map_2026_08_26.py` afterwards. |
| 9 | `mock-data/` isn't in the repo, so `npm run upload-3d` and the `generate-*-pcd` scripts don't work out of the box. | Ask the AutoAssess team for sample data. |
| 10 | There's no CI, and `npm run lint` already fails on existing import-order issues; `just test` has 2 known failures in `test_vessel_area_service.py`. | Before a PR, run `npm test`, lint the files you changed, and `just check && just test`. |
| 11 | Campaigns uploaded before 3D models existed don't render. | Run `dss campaign build-3d-model --campaign <id>`; the viewer shows the exact command. |
| 12 | **CDF download URLs expire after about 30 seconds** in this project (not the hour you may expect). | Fetch a URL right before you download, and never cache it. `files.download*` in the Python SDK already does this. |

## Troubleshooting

**`dss` fails with an auth or 401 error**
- Run from `sdk/` (the `.env` file is read from the current directory), or export the `COGNITE_*` variables.
- `COGNITE_TENANT_ID=cog-autoassess` (an org name, not a UUID) selects the Cognite IdP. A UUID selects Entra ID, which is wrong for the shared project.
- Check for stray spaces or quotes around the secret.

**`dss` fails with 403 Forbidden**
- Your service account lacks a capability (data modeling or files). Tell the AutoAssess team which call failed; run with `-v` for details.

**Web app shows "Failed to connect to Fusion"**
- You opened `localhost:3001` directly. Open it through the Fusion URL instead ([chapter 5](05-web-viewer.md#part-1-run-it-locally)).
- Accept the local HTTPS certificate by visiting `https://localhost:3001` once.

**Viewer is empty or says to run `dss campaign upload`**
- The area has no campaign with PLY files. Check that the campaign's `cdfFileIds` isn't empty.
- Check that the layer is toggled on in the Layers tab (hidden layers aren't downloaded).

**"3D model not built yet"**
- The campaign has a mesh but no CDF 3D model. Run the `dss campaign build-3d-model --campaign <id>` command shown in the notice. If it says "being processed", wait: the viewer picks the model up automatically.

**Everything fails with 401 after the app was open for hours**
- Your Fusion session expired. Reload the page (you may be asked to pick your account again).

**"WebGL context lost" or the browser tab crashes**
- The mesh is too big for the GPU. Decimate it (for example to under 5 M faces) or close other GPU-heavy tabs.

**Old mesh still shows after re-upload**
- Reveal caches model sectors in the browser (Cache Storage `reveal-3d-resources-v1`). Clear site data in DevTools → Application → Storage.

**I can't create a plan**
- A plan needs a reference map, which is a **Complete** campaign in that area. Mark your campaign Complete at the end of `dss campaign upload`.

**I can't edit a plan**
- Ready plans are read-only. Switch it back to Draft in the Plans tab. The map can only be changed in Draft.

## FAQ

**Which coordinate frame are the positions in?**
The world frame of the campaign's map files, in metres. A plan's task coordinates are in the frame of its `map` campaign (`mapExternalId`).

**Is `SimDrone` part of the SDK? What do I use on my real drone?**
No. `SimDrone` exists only in the Drone Sandbox (`sandbox/`), and its examples always name it `sim_drone`. The `uidss` calls in the sandbox (`vessels`, `areas`, `plans.list/download`) are the real SDK API. For your drone, write a class with the same verbs (`takeoff()`, `goto(Pose)`, `inspect(task_id)`, `return_home()`, `land()`), then run `dss campaign upload` on the mission folder. In the sandbox, `plans.update_status(...)` is simulated and never writes to CDF.

**Can I use my own CDF project?**
Yes, but you'd need to create the data model (`npm run setup-dm`, then the migrations in `sdk/scripts/`), set up auth and add a deployment to `app.json`. For the integration week, use the shared project.

**How do I show a partner exactly what I'm looking at?**
Copy the Fusion URL from the address bar. It contains the app route and the camera view ([chapter 5](05-web-viewer.md#sharing-a-view)).

**Where are the coding standards?**
[`AGENTS.md`](../../AGENTS.md) for the web app and [`sdk/AGENTS.md`](../../sdk/AGENTS.md) for the SDK. If you change `src/shared/cdf/dataModel.ts`, mirror it in `sdk/src/uidss/cdf/data_model.py`.

**How do I contribute back?**
Work on a branch, run the checks from known issue #10, and open a PR against `main` with a short description. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

**Who do I ask?**
The AutoAssess team channel for the integration week. Include the command you ran, the `-v` output, and your vessel and area names.

← [Back to the index](README.md)
