"""CLI entry point — `dss` command."""

from __future__ import annotations

import functools
import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, ParamSpec, TypeVar

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
    pick_or_create_campaign,
    pick_plan,
    pick_plan_to_complete,
    pick_vessel,
)
from uidss.config import UidssSettings
from uidss.services.area_service import CdfAreaService
from uidss.services.artifact_service import CdfArtifactService
from uidss.services.campaign_metric_service import CdfCampaignMetricService
from uidss.services.campaign_service import CdfCampaignService
from uidss.services.drone_image_service import CdfDroneImageService
from uidss.services.ndt_measurement_service import CdfNdtMeasurementService
from uidss.services.plan_service import CdfPlanService
from uidss.services.structural_element_service import CdfStructuralElementService
from uidss.services.threed_service import CdfThreeDService, ThreeDServiceProtocol
from uidss.services.vessel_service import CdfVesselService
from uidss.threed.pipeline import build_campaign_cad_model

log = structlog.get_logger()
console = Console()

app = typer.Typer(name="dss", help="AutoAssess ground station CLI.")
plan_app = typer.Typer(help="Inspection plan commands.")
campaign_app = typer.Typer(help="Campaign upload commands.")
app.add_typer(plan_app, name="plan")
app.add_typer(campaign_app, name="campaign")

_P = ParamSpec("_P")
_R = TypeVar("_R")


def _friendly_errors(fn: Callable[_P, _R]) -> Callable[_P, _R]:
    """Catch expected CLI-boundary failures and report them without a raw traceback."""

    @functools.wraps(fn)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
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
    threed_svc: ThreeDServiceProtocol, campaign_id: str, ply_paths: list[Path], work_dir: Path
) -> None:
    """Convert the campaign's PLY(s) to a CDF CAD model and wait until Reveal can load it."""
    with console.status("  Converting mesh for the 3D viewer (this can take minutes)..."):
        model = build_campaign_cad_model(
            ply_paths, campaign_id, threed_svc, work_dir, workers=os.cpu_count() or 1
        )
    console.print(
        f"  3D model {model.model_id} (revision {model.revision_id}) created; processing in CDF..."
    )
    with console.status("  Waiting for CDF 3D processing..."):
        status = threed_svc.wait_until_processed(model)
    console.print(f"  [green]OK[/green]  3D model {model.model_id} {status}")


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


@campaign_app.command("upload")
@_friendly_errors
def campaign_upload(
    folder: Path = typer.Argument(..., help="Mission output folder to upload"),
    no_3d_model: bool = typer.Option(
        False, "--no-3d-model", help="Skip building the CDF 3D model the viewer streams"
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
    uploaded_plys: list[Path] = []

    for ply in scanned.ply_files:
        console.print(f"\n  {ply.relative_to(folder)}")
        if confirm("  Upload as PLY mesh?"):
            with console.status("  Uploading..."):
                fid = artifacts_svc.upload_ply(ply, area.external_id)
            ply_file_ids.append(fid)
            uploaded_plys.append(ply)
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

    if uploaded_new_file:
        campaigns_svc.update_file_ids(
            campaign_space, campaign_id, ply_file_ids, pcd_file_ids, pcd_file_labels
        )
        console.print("Campaign updated with file IDs.")

    if uploaded_plys and not no_3d_model:
        with tempfile.TemporaryDirectory() as work_dir:
            _build_and_wait(threed_svc, campaign_id, uploaded_plys, Path(work_dir))

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
    """Build the CDF 3D model for an existing campaign from its PLY mesh(es)."""
    vessels_svc, areas_svc, _plans, campaigns_svc, *_rest, threed_svc = _get_client()

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
        work_dir = Path(tmp)
        with console.status("  Downloading the campaign's mesh..."):
            files = campaigns_svc.download_map(SPACE, campaign, work_dir / "source")
        plys = [f for f in files if f.suffix.lower() == ".ply"]
        if not plys:
            raise ValueError(f"Campaign {campaign!r} has no PLY mesh to convert.")
        _build_and_wait(threed_svc, campaign, plys, work_dir / "build")


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
