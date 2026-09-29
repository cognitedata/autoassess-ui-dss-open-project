"""Interactive selection helpers using questionary."""

from __future__ import annotations

from datetime import date
from typing import Any

import questionary
import typer
from rich.console import Console

from uidss.models import Area, InspectionPlan, InspectionResult, Vessel

console = Console()


def _exit_with_error(message: str) -> typer.Exit:
    console.print(f"[red]Error:[/red] {message}")
    return typer.Exit(1)


def pick_vessel(vessels: list[Vessel]) -> Vessel:
    if not vessels:
        raise _exit_with_error("No vessels found.")
    if len(vessels) == 1:
        console.print(f"Vessel: [bold]{vessels[0].name}[/bold]")
        return vessels[0]
    choice = questionary.select(
        "Select vessel:",
        choices=[questionary.Choice(v.name, value=v) for v in vessels],
    ).unsafe_ask()
    return choice  # type: ignore[return-value]


def pick_area(areas: list[Area]) -> Area:
    if not areas:
        raise _exit_with_error("No areas found for the selected vessel.")
    if len(areas) == 1:
        console.print(f"Area: [bold]{areas[0].name}[/bold]")
        return areas[0]
    choice = questionary.select(
        "Select area:",
        choices=[questionary.Choice(a.name, value=a) for a in areas],
    ).unsafe_ask()
    return choice  # type: ignore[return-value]


def pick_plan(plans: list[InspectionPlan], task_counts: dict[str, int]) -> InspectionPlan:
    if not plans:
        raise _exit_with_error("No plans found for the selected area.")

    def _label(p: InspectionPlan) -> str:
        dt = _ms_to_date(p.created_time)
        tasks = task_counts.get(p.external_id, 0)
        return f"{_format_plan_label(p)}  ({p.external_id})  {p.status:<8}  {dt}  ({tasks} tasks)"

    choice = questionary.select(
        "Select plan:",
        choices=[questionary.Choice(_label(p), value=p) for p in plans],
    ).unsafe_ask()
    return choice  # type: ignore[return-value]


def pick_plan_to_complete(
    plans: list[InspectionPlan], task_counts: dict[str, int]
) -> InspectionPlan | None:
    ready = [p for p in plans if p.status == "Ready"]
    if not ready:
        return None

    def _label(p: InspectionPlan) -> str:
        dt = _ms_to_date(p.created_time)
        tasks = task_counts.get(p.external_id, 0)
        return f"{_format_plan_label(p)}  ({p.external_id})  {p.status:<8}  {dt}  ({tasks} tasks)"

    choice = questionary.select(
        "Select plan to mark Complete:",
        choices=[questionary.Choice(_label(p), value=p) for p in ready],
    ).unsafe_ask()
    return choice  # type: ignore[return-value]


_CREATE_NEW = "__create_new__"


def pick_or_create_campaign(campaigns: list[InspectionResult]) -> InspectionResult | None:
    """Return an existing campaign or None to signal 'create new'."""

    def _label(r: InspectionResult) -> str:
        return f"{r.external_id}  {r.status:<10}  {r.campaign_date}"

    choices: list[Any] = [questionary.Choice("Create new campaign", value=_CREATE_NEW)]
    choices += [questionary.Choice(_label(r), value=r) for r in campaigns]
    choice = questionary.select("Select campaign:", choices=choices).unsafe_ask()
    if choice == _CREATE_NEW:
        return None
    return choice  # type: ignore[return-value]


def pick_map_campaign(campaigns: list[InspectionResult], interactive: bool) -> InspectionResult:
    """Pick the reference map: a Complete campaign. Newest first; the newest is the default.

    Prompts only when *interactive* and there is more than one Complete campaign.
    """
    complete = [c for c in campaigns if c.status == "Complete"]
    if not complete:
        raise _exit_with_error("The area has no Complete campaign to use as the plan's map.")
    if len(complete) == 1 or not interactive:
        console.print(f"Map: [bold]{complete[0].external_id}[/bold] ({complete[0].campaign_date})")
        return complete[0]
    choice = questionary.select(
        "Select the map (campaign) the findings' coordinates are in:",
        choices=[
            questionary.Choice(f"{c.external_id}  {c.campaign_date}", value=c) for c in complete
        ],
    ).unsafe_ask()
    return choice  # type: ignore[return-value]


def ask_campaign_date() -> str:
    today = date.today().isoformat()
    value = questionary.text(f"Campaign date (YYYY-MM-DD) [{today}]:").unsafe_ask()
    return value.strip() or today


def ask_pcd_label(path_name: str, default: str) -> str:
    value = questionary.text(f"Label for {path_name} [{default}]:").unsafe_ask()
    return value.strip() or default


def confirm(message: str, default: bool = True) -> bool:
    return questionary.confirm(message, default=default).unsafe_ask()  # type: ignore[return-value]


def _ms_to_date(ms: int) -> str:
    if ms <= 0:
        return "—"
    try:
        return date.fromtimestamp(ms / 1000).isoformat()
    except (ValueError, OSError):
        return "—"


def _format_plan_label(p: InspectionPlan) -> str:
    """Return the human-facing label for a plan: its name, or a date-derived fallback."""
    if p.name:
        return p.name
    return f"Plan from {_ms_to_date(p.created_time)}"
