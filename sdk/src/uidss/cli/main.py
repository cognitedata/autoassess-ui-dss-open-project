"""CLI entry point — `dss` command."""

from __future__ import annotations

import functools
import logging
import os
import sys
import tempfile
from collections.abc import Callable, Sequence
from datetime import date
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import structlog
import typer
from cognite.client.exceptions import CogniteAPIError
from pydantic import ValidationError
from rich.console import Console
from rich.table import Table

from uidss.auth import make_cognite_client
from uidss.cdf.data_model import SPACE
from uidss.cli.file_scanner import missing_type_notes, scan_folder
from uidss.cli.selectors import (
    _format_plan_label,
    _ms_to_date,
    ask_campaign_date,
    ask_pcd_label,
    confirm,
    pick_area,
    pick_map_campaign,
    pick_or_create_campaign,
    pick_plan,
    pick_plan_to_complete,
    pick_vessel,
)
from uidss.config import UidssSettings
from uidss.findings import (
    DEFAULT_MERGE_RADIUS_M,
    DEFAULT_RADIUS_M,
    Finding,
    FindingsPlan,
    NormalMode,
    RowError,
    filter_findings,
    plan_tasks_from_findings,
    read_findings_csv,
    require_normals,
)
from uidss.models import Area, InspectionType, MeshFile, Vessel
from uidss.services.area_service import AreaServiceProtocol, CdfAreaService
from uidss.services.artifact_service import CdfArtifactService, MeshFileServiceProtocol
from uidss.services.campaign_metric_service import CdfCampaignMetricService
from uidss.services.campaign_service import CampaignServiceProtocol, CdfCampaignService
from uidss.services.drone_image_service import CdfDroneImageService
from uidss.services.ndt_measurement_service import CdfNdtMeasurementService
from uidss.services.plan_service import CdfPlanService, PlanServiceProtocol
from uidss.services.structural_element_service import CdfStructuralElementService
from uidss.services.threed_service import (
    CdfThreeDService,
    ThreeDServiceProtocol,
    covered_by_legacy,
)
from uidss.services.vessel_service import CdfVesselService, VesselServiceProtocol
from uidss.threed.pipeline import build_file_cad_model
from uidss.threed.ply import PlyMesh, merge_meshes, read_ply
from uidss.worker import ModelWorker, TickReport

log = structlog.get_logger()
console = Console()

app = typer.Typer(name="dss", help="AutoAssess ground station CLI.")
plan_app = typer.Typer(help="Inspection plan commands.")
campaign_app = typer.Typer(help="Campaign upload commands.")
app.add_typer(plan_app, name="plan")
app.add_typer(campaign_app, name="campaign")


def _friendly_errors[**P, R](fn: Callable[P, R]) -> Callable[P, R]:
    """Catch expected CLI-boundary failures and report them without a raw traceback."""

    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return fn(*args, **kwargs)
        except typer.Exit:
            raise
        except KeyboardInterrupt:
            console.print("\nAborted.")
            raise typer.Exit(130) from None
        except CogniteAPIError as e:
            console.print(f"[red]Error:[/red] {e}")
            raise typer.Exit(1) from None
        except ValidationError as e:
            console.print(f"[red]Error:[/red] Invalid configuration — {e}")
            raise typer.Exit(1) from None
        except (ValueError, RuntimeError, FileNotFoundError) as e:
            console.print(f"[red]Error:[/red] {e}")
            raise typer.Exit(1) from None

    return wrapper


@app.callback()
def main(
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Enable debug logging.")] = False,
) -> None:
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(level=level)
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(level),
    )


def _get_client() -> tuple[
    CdfVesselService,
    CdfAreaService,
    CdfPlanService,
    CdfCampaignService,
    CdfArtifactService,
    CdfStructuralElementService,
    CdfNdtMeasurementService,
    CdfCampaignMetricService,
    CdfThreeDService,
]:
    settings = UidssSettings()  # type: ignore
    client = make_cognite_client(settings)
    return (
        CdfVesselService(client),
        CdfAreaService(client),
        CdfPlanService(client),
        CdfCampaignService(client),
        CdfArtifactService(client),
        CdfStructuralElementService(client),
        CdfNdtMeasurementService(client),
        CdfCampaignMetricService(client),
        CdfThreeDService(client),
    )


def _build_and_wait(
    threed_svc: ThreeDServiceProtocol, ply_path: Path, source: MeshFile, work_dir: Path
) -> None:
    """Convert one mesh file to its CDF CAD model and wait until Reveal can load it."""
    with console.status(f"  Converting {source.name} for the 3D viewer (this can take minutes)..."):
        model = build_file_cad_model(
            ply_path, source, threed_svc, work_dir, workers=os.cpu_count() or 1
        )
    console.print(
        f"  3D model {model.model_id} (revision {model.revision_id}) created; processing in CDF..."
    )
    with console.status("  Waiting for CDF 3D processing..."):
        status = threed_svc.wait_until_processed(model)
    console.print(f"  [green]OK[/green]  3D model {model.model_id} {status}")


def _build_missing_models(
    meshes_svc: MeshFileServiceProtocol,
    threed_svc: ThreeDServiceProtocol,
    campaign_id: str,
    file_ids: Sequence[int],
    work_dir: Path,
) -> None:
    """Build the models of the campaign's mesh files that don't have one yet."""
    meshes = meshes_svc.get_mesh_files(file_ids)
    known = {m.file_id for m in meshes}
    for file_id in file_ids:
        if file_id not in known:
            console.print(
                f"  [yellow]Note:[/yellow] file {file_id} is not a CogniteFile, so it can't get "
                "a 3D model of its own."
            )
    existing = threed_svc.find_models_for_files([m.external_id for m in meshes])
    legacy = threed_svc.find_campaign_models([campaign_id]).get(campaign_id)
    for mesh in meshes:
        if mesh.external_id in existing:
            console.print(f"  {mesh.external_id} already has a 3D model.")
            continue
        if covered_by_legacy(mesh, legacy):
            console.print(
                f"  {mesh.external_id} is shown by the campaign's legacy 3D model; skipped."
            )
            continue
        mesh_dir = work_dir / str(mesh.file_id)
        with console.status(f"  Downloading {mesh.name}..."):
            ply = meshes_svc.download(mesh, mesh_dir / "source")
        _build_and_wait(threed_svc, ply, mesh, mesh_dir / "build")


@plan_app.command("list")
@_friendly_errors
def plan_list() -> None:
    """List inspection plans for an area."""
    vessels_svc, areas_svc, plans_svc, *_ = _get_client()

    vessel = pick_vessel(vessels_svc.list())
    areas = areas_svc.list(vessel.space, vessel.external_id)
    area = pick_area(areas)
    plans = plans_svc.list(area.space, area.external_id)
    if not plans:
        console.print(f"No plans found for [bold]{area.name}[/bold].")
        return
    task_counts = plans_svc.count_tasks([p.external_id for p in plans])

    table = Table(title=f"Plans for {area.name}")
    table.add_column("Name", max_width=30, overflow="ellipsis")
    table.add_column("ID")
    table.add_column("Status")
    table.add_column("Created")
    table.add_column("Tasks", justify="right")

    for p in plans:
        count = str(task_counts.get(p.external_id, 0))
        table.add_row(
            _format_plan_label(p), p.external_id, p.status, _ms_to_date(p.created_time), count
        )
    console.print(table)


@plan_app.command("download")
@_friendly_errors
def plan_download(
    output_dir: Path = typer.Option(
        Path("."), "--output-dir", "-o", help="Directory for plan.json"
    ),
) -> None:
    """Download a ready inspection plan to plan.json."""
    vessels_svc, areas_svc, plans_svc, *_ = _get_client()

    vessel = pick_vessel(vessels_svc.list())
    areas = areas_svc.list(vessel.space, vessel.external_id)
    area = pick_area(areas)
    plans = plans_svc.list(area.space, area.external_id)
    task_counts = plans_svc.count_tasks([p.external_id for p in plans])
    plan = pick_plan(plans, task_counts)

    output_path = output_dir / f"{plan.external_id}.json"
    plans_svc.download(plan.space, plan.external_id, area.name, output_path)
    console.print(f"Downloaded [bold]{plan.external_id}.json[/bold] to {output_path}")


@plan_app.command("download-map")
@_friendly_errors
def plan_download_map(
    output_dir: Path = typer.Option(
        Path("."), "--output-dir", "-o", help="Directory for the map's PLY/PCD files"
    ),
) -> None:
    """Download the PLY mesh / PCD point-cloud files a plan uses as its reference map."""
    vessels_svc, areas_svc, plans_svc, campaign_svc, *_ = _get_client()

    vessel = pick_vessel(vessels_svc.list())
    areas = areas_svc.list(vessel.space, vessel.external_id)
    area = pick_area(areas)
    plans = plans_svc.list(area.space, area.external_id)
    task_counts = plans_svc.count_tasks([p.external_id for p in plans])
    plan = pick_plan(plans, task_counts)

    if plan.map_external_id is None:
        raise ValueError(
            "This plan has no associated map — it may predate map tracking. "
            "Open the plan in the viewer and set a map from the edit dialog "
            "(only available while the plan is Draft), then download again."
        )

    map_dir = output_dir / plan.map_external_id
    written = campaign_svc.download_map(plan.space, plan.map_external_id, map_dir)
    for path in written:
        console.print(f"Downloaded [bold]{path.name}[/bold] to {path}")


class _InspectionTypeChoice(StrEnum):
    visual = "visual"
    ndt_thickness = "ndt_thickness"


class _NormalsChoice(StrEnum):
    model = "model"
    centre = "centre"
    require = "require"


_INSPECTION_TYPES: dict[_InspectionTypeChoice, InspectionType] = {
    _InspectionTypeChoice.visual: "visual",
    _InspectionTypeChoice.ndt_thickness: "ndt_thickness",
}
_NORMAL_MODES: dict[_NormalsChoice, NormalMode] = {
    _NormalsChoice.model: "model",
    _NormalsChoice.centre: "centre",
    _NormalsChoice.require: "require",
}
_MAX_ERRORS_SHOWN = 20


@plan_app.command("import-findings")
@_friendly_errors
def plan_import_findings(
    csv_path: Path = typer.Argument(
        ...,
        help="Findings CSV: x,y,z (metres, map frame) required; optional id, nx,ny,nz, "
        "radius, inspection_type, class, confidence, description.",
        exists=True,
        dir_okay=False,
    ),
    vessel: str | None = typer.Option(None, "--vessel", help="Vessel external id or name"),
    area: str | None = typer.Option(None, "--area", help="Area external id or name"),
    map_id: str | None = typer.Option(
        None,
        "--map",
        help="Campaign whose map frame the coordinates are in (default: newest Complete)",
    ),
    plan_id: str | None = typer.Option(
        None, "--plan", help="Add to this existing Draft plan instead of creating a new one"
    ),
    name: str | None = typer.Option(
        None, "--name", help="Name of the new plan (default: 'Findings <csv name> <date>')"
    ),
    merge_radius: float = typer.Option(
        DEFAULT_MERGE_RADIUS_M,
        "--merge-radius",
        min=0,
        help="Merge findings within this distance (m) into one task; 0 disables",
    ),
    min_confidence: float | None = typer.Option(
        None, "--min-confidence", min=0, max=1, help="Skip findings below this confidence"
    ),
    classes: list[str] | None = typer.Option(
        None, "--class", help="Only import findings of this class (repeatable)"
    ),
    radius: float = typer.Option(
        DEFAULT_RADIUS_M, "--radius", min=0.01, help="Radius (m) for rows without one"
    ),
    inspection_type: _InspectionTypeChoice = typer.Option(
        _InspectionTypeChoice.visual,
        "--inspection-type",
        help="Inspection type for rows without one",
    ),
    normals: _NormalsChoice = typer.Option(
        _NormalsChoice.model,
        "--normals",
        help="Missing normals: 'model' = nearest surface of the map's 3D model, "
        "'centre' = point towards the area centre, 'require' = reject rows without one",
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show the tasks; write nothing"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Don't ask for confirmation"),
    strict: bool = typer.Option(
        False, "--strict", help="Fail on any invalid row instead of skipping it"
    ),
) -> None:
    """Create a Draft inspection plan from a CSV of findings (one region task per finding).

    Nearby findings are merged, missing normals are estimated from the map campaign's 3D
    model, and findings already in the target plan (same suggestionId) are skipped, so
    re-running with --plan is safe. Never marks the plan Ready.
    """
    # 1. Parse, validate and filter — before touching CDF.
    findings, errors = read_findings_csv(csv_path)
    read_count = len(findings) + len(errors)
    if normals == _NormalsChoice.require:
        findings, missing_normals = require_normals(findings)
        errors = sorted([*errors, *missing_normals], key=lambda e: e.line)
    _print_row_errors(errors)
    if errors and strict:
        raise ValueError(f"{len(errors)} invalid row(s) in {csv_path.name} (--strict).")
    kept = filter_findings(findings, min_confidence, classes)
    console.print(
        f"{read_count} findings read, {len(errors)} rejected, "
        f"{len(findings) - len(kept)} filtered out."
    )
    if not kept:
        console.print("Nothing to import.")
        return

    # 2. Resolve the area, the target plan (or map) and what the plan already contains.
    vessels_svc, areas_svc, plans_svc, campaigns_svc, *_ = _get_client()
    the_vessel, the_area = _resolve_vessel_and_area(vessels_svc, areas_svc, vessel, area)
    map_campaign_id, existing_ids = _resolve_target(
        plans_svc, campaigns_svc, the_area, plan_id, map_id, interactive=not yes
    )

    # 3. Merge, estimate normals, skip what's already there.
    mesh = None
    if normals != _NormalsChoice.require:
        mesh = _load_collision_proxy(campaigns_svc, map_campaign_id)
    result = plan_tasks_from_findings(
        kept,
        merge_radius_m=merge_radius,
        default_radius_m=radius,
        default_inspection_type=_INSPECTION_TYPES[inspection_type],
        normals=_NORMAL_MODES[normals],
        mesh=mesh,
        existing_suggestion_ids=existing_ids,
    )
    _print_findings_plan(result, kept, merge_radius, plan_id)
    if not result.tasks:
        console.print("Nothing to import: every finding is already in the plan.")
        return
    if dry_run:
        console.print("[bold]Dry run[/bold]: nothing was written.")
        return

    target = f"plan {plan_id}" if plan_id else f"a new Draft plan in {the_area.name}"
    if not yes and not confirm(f"Add {len(result.tasks)} task(s) to {target}?"):
        raise typer.Exit(0)

    # 4. Write: a new Draft plan (unless --plan), then the tasks.
    if plan_id is None:
        plan_name = name or f"Findings {csv_path.stem} {date.today().isoformat()}"
        description = (
            f"Imported from {csv_path.name} with dss plan import-findings: "
            f"{len(kept)} findings in {len(result.tasks)} region tasks."
        )
        plan_id = plans_svc.create(the_area.external_id, map_campaign_id, plan_name, description)
        console.print(f"Created Draft plan [bold]{plan_name}[/bold] ({plan_id})")
    try:
        plans_svc.add_region_tasks(plan_id, [t.task for t in result.tasks])
    except CogniteAPIError:
        console.print(
            f"[yellow]Some tasks may not have been written.[/yellow] Re-run with "
            f"--plan {plan_id} to add the missing ones (existing ones are skipped)."
        )
        raise
    console.print(
        f"[green]OK[/green]  Added {len(result.tasks)} task(s) to plan [bold]{plan_id}[/bold] "
        f"({the_vessel.name} / {the_area.name}, map {map_campaign_id})."
    )
    console.print(
        "Review the tasks in the AutoAssess viewer, then mark the plan Ready there "
        "(or with the Python API)."
    )


def _print_row_errors(errors: Sequence[RowError]) -> None:
    for error in errors[:_MAX_ERRORS_SHOWN]:
        console.print(f"  [yellow]line {error.line}[/yellow]: {error.message}", highlight=False)
    if len(errors) > _MAX_ERRORS_SHOWN:
        console.print(f"  ... and {len(errors) - _MAX_ERRORS_SHOWN} more invalid rows")


def _resolve_vessel_and_area(
    vessels_svc: VesselServiceProtocol,
    areas_svc: AreaServiceProtocol,
    vessel: str | None,
    area: str | None,
) -> tuple[Vessel, Area]:
    """--vessel/--area by external id or name; interactive pickers for what's missing."""
    vessels = vessels_svc.list()
    if vessel is not None:
        vessels = [v for v in vessels if vessel in (v.external_id, v.name)]
        if not vessels:
            raise ValueError(f"Vessel {vessel!r} not found.")
    if area is None:
        picked = pick_vessel(vessels)
        return picked, pick_area(areas_svc.list(picked.space, picked.external_id))
    matches = [
        (v, a)
        for v in vessels
        for a in areas_svc.list(v.space, v.external_id)
        if area in (a.external_id, a.name)
    ]
    if not matches:
        raise ValueError(f"Area {area!r} not found.")
    if len(matches) > 1:
        raise ValueError(f"Area {area!r} is ambiguous; pass --vessel or the area's external id.")
    return matches[0]


def _resolve_target(
    plans_svc: PlanServiceProtocol,
    campaigns_svc: CampaignServiceProtocol,
    area: Area,
    plan_id: str | None,
    map_id: str | None,
    interactive: bool,
) -> tuple[str, list[str]]:
    """Return (map campaign id, suggestion ids already in the target plan)."""
    if plan_id is not None:
        plans = plans_svc.list(area.space, area.external_id)
        plan = next((p for p in plans if p.external_id == plan_id), None)
        if plan is None:
            raise ValueError(f"Plan {plan_id!r} not found in area {area.name}.")
        if plan.status != "Draft":
            raise ValueError(
                f"Plan {plan_id} is {plan.status}; findings can only be added to a Draft plan."
            )
        if plan.map_external_id is None:
            raise ValueError(f"Plan {plan_id} has no map; set one in the viewer first.")
        if map_id is not None and map_id != plan.map_external_id:
            raise ValueError(f"--map {map_id} is not the plan's map ({plan.map_external_id}).")
        tasks = plans_svc.list_tasks(plan_id)
        return plan.map_external_id, [t.suggestion_id for t in tasks if t.suggestion_id]

    campaigns = campaigns_svc.list(area.space, area.external_id)
    if map_id is None:
        picked = pick_map_campaign(campaigns, interactive=interactive and sys.stdin.isatty())
        return picked.external_id, []
    if not any(c.external_id == map_id and c.status == "Complete" for c in campaigns):
        raise ValueError(f"--map {map_id} is not a Complete campaign of area {area.name}.")
    return map_id, []


def _load_collision_proxy(
    campaigns_svc: CampaignServiceProtocol, campaign_id: str
) -> PlyMesh | None:
    with (
        tempfile.TemporaryDirectory() as tmp,
        console.status("Downloading the map's 3D model (collision proxy)..."),
    ):
        paths = campaigns_svc.download_collision_proxies(campaign_id, Path(tmp))
        mesh = merge_meshes([read_ply(p) for p in paths]) if paths else None
    if mesh is None:
        console.print(
            f"[yellow]Note:[/yellow] campaign {campaign_id} has no 3D model yet "
            "(`dss worker` or `dss campaign build-3d-model` builds it), so missing normals "
            "point towards the findings' centre."
        )
    return mesh


def _print_findings_plan(
    result: FindingsPlan, kept: Sequence[Finding], merge_radius: float, plan_id: str | None
) -> None:
    if result.tasks:
        table = Table(title="Tasks to add")
        table.add_column("#", justify="right")
        table.add_column("Suggestion id", overflow="fold")
        table.add_column("Position (x, y, z)")
        table.add_column("Normal")
        table.add_column("From")
        table.add_column("Radius", justify="right")
        table.add_column("Type")
        for i, planned in enumerate(result.tasks, start=1):
            task = planned.task
            table.add_row(
                str(i),
                task.suggestion_id or "",
                _fmt_vec(task.position3d),
                _fmt_vec(task.normal_vector),
                planned.normal_source,
                f"{task.radius_m:.2f}",
                task.inspection_type,
            )
        console.print(table)
    if result.already_in_plan:
        console.print(f"{result.already_in_plan} findings are already in plan {plan_id}.")
    new_findings = sum(len(t.cluster.member_ids) for t in result.tasks)
    console.print(
        f"{new_findings} new findings merged into {len(result.tasks)} tasks "
        f"(merge radius {merge_radius:g} m)."
    )
    if result.tasks:
        console.print(
            f"Normals: {result.count('csv')} from the CSV, {result.count('model')} estimated "
            f"from the 3D model, {result.count('centre')} pointing at the area centre (fallback)."
        )


def _fmt_vec(v: tuple[float, float, float]) -> str:
    return f"{v[0]:.2f}, {v[1]:.2f}, {v[2]:.2f}"


@app.command("worker")
@_friendly_errors
def worker(
    area: str | None = typer.Option(
        None, "--area", help="Only build meshes of this area (external id); default: all areas"
    ),
    poll: float = typer.Option(30, "--poll", min=1, help="Seconds between checks"),
    once: bool = typer.Option(False, "--once", help="Check once, build what's missing, exit"),
) -> None:
    """Build the 3D model of every uploaded mesh that doesn't have one, as meshes arrive.

    Meant to run at boot on the ground station (see the tutorial for a systemd/launchd unit).
    Robots with autoassess_bridge, `dss campaign upload` and scripts only upload the mesh; the
    worker converts it and creates its CDF 3D model, one at a time.
    """
    _v, _a, _p, campaigns_svc, artifacts_svc, *_rest, threed_svc = _get_client()
    model_worker = ModelWorker(
        meshes=artifacts_svc,
        campaigns=campaigns_svc,
        threed=threed_svc,
        build=functools.partial(build_file_cad_model, workers=os.cpu_count() or 1),
        area=area,
    )
    scope = f"area {area}" if area else "all areas"
    console.print(
        f"dss worker: building missing 3D models for {scope}"
        + ("" if once else f", every {poll:g} s")
    )
    model_worker.run(poll_s=poll, once=once, on_tick=_print_tick)


def _print_tick(report: TickReport) -> None:
    parts = [
        f"built {len(report.built)}",
        f"failed {len(report.failed)}",
        f"with a model {report.with_model}",
    ]
    if report.covered_by_legacy:
        parts.append(f"shown by legacy campaign models {len(report.covered_by_legacy)}")
    if report.backing_off:
        parts.append(f"waiting to retry {len(report.backing_off)}")
    if report.given_up:
        parts.append(f"given up (restart the worker to retry) {len(report.given_up)}")
    console.print("  " + ", ".join(parts), highlight=False)
    for xid in report.built:
        console.print(f"  [green]built[/green] {xid}", highlight=False)
    for xid in report.failed:
        console.print(f"  [red]failed[/red] {xid} (see the log; retried later)", highlight=False)


@campaign_app.command("upload")
@_friendly_errors
def campaign_upload(
    folder: Path = typer.Argument(..., help="Mission output folder to upload"),
    no_3d_model: bool = typer.Option(
        False, "--no-3d-model", help="Leave building the 3D model to `dss worker`"
    ),
) -> None:
    """Upload mission artifacts from a folder to CDF."""
    if not folder.is_dir():
        console.print(f"[red]Error:[/red] {folder} is not a directory.")
        raise typer.Exit(1)

    scanned = scan_folder(folder)
    notes = missing_type_notes(scanned)

    console.print("\nFound candidate files:")
    for f in scanned.ply_files:
        console.print(f"  {f.relative_to(folder)}")
    for f in scanned.point_cloud_ply_files:
        console.print(f"  {f.relative_to(folder)} (point cloud)")
    for f in scanned.pcd_files:
        console.print(f"  {f.relative_to(folder)}")
    for f in scanned.csv_files:
        console.print(f"  {f.relative_to(folder)}")
    if scanned.ssg_yaml:
        console.print(f"  {scanned.ssg_yaml.relative_to(folder)}")
    if scanned.metrics_yaml:
        console.print(f"  {scanned.metrics_yaml.relative_to(folder)}")
    for note in notes:
        console.print(f"[yellow]Note:[/yellow] {note}")

    (
        vessels_svc,
        areas_svc,
        plans_svc,
        campaigns_svc,
        artifacts_svc,
        elements_svc,
        measurements_svc,
        metrics_svc,
        threed_svc,
    ) = _get_client()

    vessel = pick_vessel(vessels_svc.list())
    areas = areas_svc.list(vessel.space, vessel.external_id)
    area = pick_area(areas)

    existing = campaigns_svc.list(area.space, area.external_id)
    existing_campaign = pick_or_create_campaign(existing)

    if existing_campaign is None:
        campaign_date = ask_campaign_date()
        campaign_id = campaigns_svc.create(area.external_id, campaign_date)
        campaign_space = area.space
        console.print(f"Created campaign [bold]{campaign_id}[/bold]")
        ply_file_ids: list[int] = []
        pcd_file_ids: list[int] = []
        pcd_file_labels: list[str] = []
    else:
        campaign_id = existing_campaign.external_id
        campaign_space = existing_campaign.space
        # update_file_ids() is a plain overwrite upsert, so seed the accumulators
        # from the campaign's current state — otherwise a second `campaign upload`
        # run on the same campaign (e.g. PCD today, having uploaded a PLY
        # yesterday) would wipe out the previous run's file ids.
        ply_file_ids = list(existing_campaign.cdf_file_ids)
        pcd_file_ids = list(existing_campaign.pcd_file_ids)
        pcd_file_labels = list(existing_campaign.pcd_file_labels)

    # --- Assign roles and upload ---
    uploaded_new_file = False
    uploaded_ply_ids: list[int] = []

    for ply in scanned.ply_files:
        console.print(f"\n  {ply.relative_to(folder)}")
        if confirm("  Upload as PLY mesh?"):
            with console.status("  Uploading..."):
                fid = artifacts_svc.upload_ply(ply, area.external_id)
            ply_file_ids.append(fid)
            uploaded_ply_ids.append(fid)
            uploaded_new_file = True
            console.print(f"  [green]OK[/green]  (file id {fid})")

    for pcd in scanned.pcd_files:
        console.print(f"\n  {pcd.relative_to(folder)}")
        if confirm("  Upload as PCD point cloud?"):
            default_label = pcd.stem.replace("_", " ").title()
            label = ask_pcd_label(pcd.name, default_label)
            with console.status("  Uploading..."):
                fid = artifacts_svc.upload_pcd(pcd, area.external_id, label)
            pcd_file_ids.append(fid)
            pcd_file_labels.append(label)
            uploaded_new_file = True
            console.print(f"  [green]OK[/green]  (file id {fid})")

    for ply_cloud in scanned.point_cloud_ply_files:
        console.print(f"\n  {ply_cloud.relative_to(folder)} (vertex-only PLY)")
        if confirm("  Upload as point cloud (converted to PCD, colours preserved)?"):
            default_label = ply_cloud.stem.replace("_", " ").title()
            label = ask_pcd_label(ply_cloud.name, default_label)
            with console.status("  Converting and uploading..."):
                fid = artifacts_svc.upload_ply_pointcloud(ply_cloud, area.external_id, label)
            pcd_file_ids.append(fid)
            pcd_file_labels.append(label)
            uploaded_new_file = True
            console.print(f"  [green]OK[/green]  (file id {fid})")

    if uploaded_new_file:
        campaigns_svc.update_file_ids(
            campaign_space, campaign_id, ply_file_ids, pcd_file_ids, pcd_file_labels
        )
        console.print("Campaign updated with file IDs.")

    if uploaded_ply_ids and not no_3d_model:
        with tempfile.TemporaryDirectory() as work_dir:
            _build_missing_models(
                artifacts_svc, threed_svc, campaign_id, uploaded_ply_ids, Path(work_dir)
            )

    for csv_file in scanned.csv_files:
        console.print(f"\n  {csv_file.relative_to(folder)}")
        missing = measurements_svc.missing_columns(csv_file)
        if missing:
            console.print(
                f"  [yellow]Skipping[/yellow] — missing expected columns: {sorted(missing)}"
            )
            continue
        if confirm("  Upload UTM measurements from CSV?"):
            with console.status("  Upserting measurements..."):
                count = measurements_svc.create_from_csv(csv_file, campaign_id)
            console.print(f"  [green]OK[/green]  ({count} measurements)")

    if scanned.ssg_yaml and confirm("\nUpsert structural elements from ssg.yaml?"):
        with console.status("  Upserting structural elements..."):
            count = elements_svc.upsert_from_ssg(area.external_id, scanned.ssg_yaml)
        console.print(f"  [green]OK[/green]  ({count} elements)")

    if scanned.metrics_yaml and confirm("\nUpsert metrics from metrics.yaml?"):
        with console.status("  Upserting metrics..."):
            count = metrics_svc.upsert_from_yaml(scanned.metrics_yaml, campaign_id)
        console.print(f"  [green]OK[/green]  ({count} metrics)")

    if confirm("\nMark campaign as Complete?"):
        campaigns_svc.complete(campaign_space, campaign_id)
        console.print("Campaign marked Complete.")

    if confirm("Mark a plan as Complete?", default=False):
        plans = plans_svc.list(area.space, area.external_id)
        task_counts = plans_svc.count_tasks([p.external_id for p in plans])
        plan = pick_plan_to_complete(plans, task_counts)
        if plan:
            plans_svc.update_status(plan.space, plan.external_id, "Complete")
            console.print(f"Plan {plan.external_id} marked Complete.")


@campaign_app.command("build-3d-model")
@_friendly_errors
def campaign_build_3d_model(
    campaign: str | None = typer.Option(
        None, "--campaign", "-c", help="Campaign external id (skips the pickers)"
    ),
) -> None:
    """Build the CDF 3D models of a campaign's mesh files that don't have one yet.

    Each mesh file gets its own model, so it keeps it when it moves to another campaign.
    `dss worker` does the same automatically for every uploaded mesh.
    """
    vessels_svc, areas_svc, _plans, campaigns_svc, artifacts_svc, *_rest, threed_svc = _get_client()

    if campaign is None:
        vessel = pick_vessel(vessels_svc.list())
        area = pick_area(areas_svc.list(vessel.space, vessel.external_id))
        picked = pick_or_create_campaign(campaigns_svc.list(area.space, area.external_id))
        if picked is None:
            raise ValueError("Pick an existing campaign; build-3d-model does not create one.")
        campaign = picked.external_id

    result = campaigns_svc.get(SPACE, campaign)
    if result is None:
        raise ValueError(f"Campaign {campaign!r} not found.")
    if not result.cdf_file_ids:
        raise ValueError(f"Campaign {campaign!r} has no PLY mesh to convert.")

    with tempfile.TemporaryDirectory() as tmp:
        _build_missing_models(artifacts_svc, threed_svc, campaign, result.cdf_file_ids, Path(tmp))


@campaign_app.command("upload-drone-images")
@_friendly_errors
def campaign_upload_drone_images(
    folder: Path = typer.Argument(..., help="Folder with rgb.txt, groundtruth.txt, and rgb/"),
    sensor_yaml: Path = typer.Option(
        None,
        "--sensor-yaml",
        "-s",
        help="Path to supereight2 sensor YAML (auto-detected if omitted)",
    ),
) -> None:
    """Upload drone images from a TUM-format dataset folder to CDF."""
    if not folder.is_dir():
        console.print(f"[red]Error:[/red] {folder} is not a directory.")
        raise typer.Exit(1)

    settings = UidssSettings()  # type: ignore
    client = make_cognite_client(settings)
    vessels_svc = CdfVesselService(client)
    areas_svc = CdfAreaService(client)
    campaigns_svc = CdfCampaignService(client)
    drone_images_svc = CdfDroneImageService(client)

    vessel = pick_vessel(vessels_svc.list())
    areas = areas_svc.list(vessel.space, vessel.external_id)
    area = pick_area(areas)

    existing = campaigns_svc.list(area.space, area.external_id)
    existing_campaign = pick_or_create_campaign(existing)

    if existing_campaign is None:
        campaign_date = ask_campaign_date()
        campaign_id = campaigns_svc.create(area.external_id, campaign_date)
        console.print(f"Created campaign [bold]{campaign_id}[/bold]")
    else:
        campaign_id = existing_campaign.external_id

    console.print(f"\nWill upload drone images from [bold]{folder}[/bold]")
    console.print(f"Campaign: [bold]{campaign_id}[/bold]")
    if not confirm("Proceed?"):
        raise typer.Exit(0)

    with console.status("Uploading drone images..."):
        count = drone_images_svc.upload(
            folder,
            campaign_id,
            sensor_yaml=sensor_yaml if sensor_yaml else None,
        )
    console.print(f"[green]OK[/green]  Uploaded {count} drone images.")
