# 7. End-to-end exercise ("hello mission")

This exercise runs one full mission lifecycle with **no robot**, using the sample files in the repo. Do it in mixed teams (one web person, one ground-station person, one analysis person) on day 1. It makes sure everyone's setup works and that everyone has seen the whole loop.

Replace `<prefix>` with your partner prefix throughout.

---

### ☐ Step 1 (web): Create your sandbox vessel and area

1. Open the app through Fusion ([chapter 5](05-web-viewer.md#part-1-run-it-locally)).
2. **Add vessel** named `<prefix> – Test Vessel`.
3. Open it, then **Add area** `BWT 1`, type `BWT`.

✅ You should see the area in the list. Opening it shows an empty viewer saying "No scan data yet".

### ☐ Step 2 (ground station): Upload a first "mapping" mission

Build a mission folder from the fixtures, plus a PLY map (ask the AutoAssess team for a sample mesh, or use one of your own):

```bash
cd sdk
mkdir -p ~/missions/hello-1
cp tests/fixtures/ssg.yaml tests/fixtures/metrics.yaml tests/fixtures/ut_global_registered.csv ~/missions/hello-1/
cp /path/to/sample_mesh.ply ~/missions/hello-1/
uv run dss campaign upload ~/missions/hello-1
```
Pick your vessel and area, **create a new campaign**, confirm every file, and **mark the campaign Complete** at the end.

✅ You should see upload counts for 1 PLY, **"3D model … Done"** (the mesh is converted for the viewer; a few minutes), 53 NDT measurements, 103 structural elements and 2 metrics.

### ☐ Step 3 (web): Look at the results

1. Reload the area viewer. The mesh streams in within a second or two; toggle **structural elements** and **NDT** in the Layers tab.
2. Open **Report**, then your campaign: stat cards (Coverage 91.3 %, Corrosion rate) and the NDT table.

✅ Structural elements and NDT points appear in the 3D scene. (The fixture coordinates come from a different tank, so they may not line up with your mesh.)

### ☐ Step 4 (web): Plan the follow-up mission

1. **Plans** tab, then **New plan**, named `hello follow-up`. The reference map defaults to the campaign from step 2.
2. Make it the **active** plan.
3. Click a structural element and choose **Add to active plan** (element task, visual).
4. Click a surface point and choose **Add to active plan** (region task, change it to `ndt_thickness`).
5. Optionally, open **Suggestions**: the fixture has UT readings < 10 mm, so repeat-NDT tasks are suggested.
6. Mark the plan **Ready**.

✅ The plan shows as Ready with its task count, and editing is disabled.

### ☐ Step 5 (ground station): Pick up the plan

```bash
uv run dss plan list
uv run dss plan download -o ~/gs/plans
uv run dss plan download-map -o ~/gs/maps
cat ~/gs/plans/plan-*.json
```
✅ The JSON has your tasks, and `mapExternalId` matches the campaign from step 2.

**Discussion point for robot partners:** what does your planner need in this JSON that isn't there? (Ordering hints, standoff distance, sensor settings, coordinate frame metadata…) Write it down; this is input to PRD OQ-5.

### ☐ Step 6 (ground station): Upload the "executed" mission, with images

```bash
mkdir -p ~/missions/hello-2
cp tests/fixtures/ut_global_registered.csv ~/missions/hello-2/
cp -r tests/fixtures/drone_images ~/missions/hello-2/tum
uv run dss campaign upload ~/missions/hello-2                   # new campaign; mark plan Complete at the end
uv run dss campaign upload-drone-images ~/missions/hello-2/tum   # pick the same campaign
```
✅ The plan status is Complete in the web app, and the second campaign appears in the Layers tab and reports. Its image grid shows the fixture frames.

(The fixture images are tiny synthetic frames, so their poses won't line up with a real mesh. That's fine for this exercise.)

### ☐ Step 7 (analysis): Read the data and push a detection

Using [chapter 6](06-analysis-on-cdf-data.md):
1. List campaigns for your area and load the NDT measurements into a DataFrame.
2. Pick the thinnest reading and write a `DefectDetection` of class `corrosion` at its `position3d`, with half-extents `(0.1, 0.1, 0.05)` and probability `0.9`.

✅ Reload the viewer. Your defect appears in the **Defects** tab; fly to it and set it to **Confirmed**.

### ☐ Step 8 (web): Close the loop

Create a new Draft plan and open **Suggestions**. The Confirmed defect now produces a suggested task.

✅ 🎉 You've run the whole loop: plan, execute, upload, analyse, review, re-plan.

### ☐ Step 9: Clean up

Delete your test vessel from its settings page (soft delete), or leave it for the rest of the week if you'll keep using it.

---

## Suggested integration-week projects

| Track | Project ideas |
|---|---|
| Ground station | Non-interactive `dss` commands (`--plan-id`, `--campaign-id` flags); a watcher that auto-uploads when a mission folder appears; agreeing the plan-JSON v2 schema; new artifact types in `file_scanner.py` |
| Web | New viewer layer for your data type; oriented bounding boxes for structural elements; thickness colour ramps; change detection between two campaigns |
| Analysis | ML defect detection on drone images, projected into 3D; corrosion scoring as a PCD layer; coverage metrics into `CampaignMetric`; NDT trend analysis across campaigns |

**Next:** [8. Gotchas and FAQ →](08-gotchas-and-faq.md)
