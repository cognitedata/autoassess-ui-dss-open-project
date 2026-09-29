"""Tests for cli/selectors.py (questionary calls mocked)."""

from __future__ import annotations

from unittest.mock import patch

import pytest
import typer

from uidss.cdf.data_model import SPACE
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
from uidss.models import Area, InspectionPlan, InspectionResult, Vessel


def _vessel(name: str = "Ship A") -> Vessel:
    return Vessel(space=SPACE, external_id="v-001", name=name, vessel_type="tanker")


def _area(name: str = "BWT Port") -> Area:
    return Area(
        space=SPACE,
        external_id="a-001",
        name=name,
        area_type="ballast_water_tank",
        vessel_external_id="v-001",
    )


def _plan(
    eid: str = "plan-001",
    status: str = "Ready",
    created_time: int = 1_746_614_400_000,
    name: str | None = None,
    description: str | None = None,
) -> InspectionPlan:
    return InspectionPlan(
        space=SPACE,
        external_id=eid,
        area_external_id="a-001",
        status=status,
        created_time=created_time,
        name=name,
        description=description,
    )  # type: ignore[arg-type]


def _result(
    eid: str = "result-001", status: str = "InProgress", date: str = "2026-05-07"
) -> InspectionResult:
    return InspectionResult(
        space=SPACE, external_id=eid, area_external_id="a-001", campaign_date=date, status=status
    )  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# pick_vessel
# ---------------------------------------------------------------------------


class TestPickVessel:
    def test_returns_only_vessel_without_prompt(self) -> None:
        v = _vessel()
        assert pick_vessel([v]) is v

    def test_exits_with_error_when_empty(self) -> None:
        with pytest.raises(typer.Exit) as exc_info:
            pick_vessel([])
        assert exc_info.value.exit_code == 1

    def test_prompts_when_multiple(self) -> None:
        vessels = [_vessel("A"), _vessel("B")]
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = vessels[1]
            result = pick_vessel(vessels)
        assert result is vessels[1]
        mock_select.assert_called_once()


# ---------------------------------------------------------------------------
# pick_area
# ---------------------------------------------------------------------------


class TestPickArea:
    def test_returns_only_area_without_prompt(self) -> None:
        a = _area()
        assert pick_area([a]) is a

    def test_exits_with_error_when_empty(self) -> None:
        with pytest.raises(typer.Exit) as exc_info:
            pick_area([])
        assert exc_info.value.exit_code == 1

    def test_prompts_when_multiple(self) -> None:
        areas = [_area("A"), _area("B")]
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = areas[0]
            result = pick_area(areas)
        assert result is areas[0]


# ---------------------------------------------------------------------------
# pick_plan
# ---------------------------------------------------------------------------


class TestPickPlan:
    def test_exits_with_error_when_empty(self) -> None:
        with pytest.raises(typer.Exit) as exc_info:
            pick_plan([], {})
        assert exc_info.value.exit_code == 1

    def test_prompts_and_returns_selection(self) -> None:
        plans = [_plan("plan-001"), _plan("plan-002")]
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = plans[1]
            result = pick_plan(plans, {"plan-001": 3, "plan-002": 7})
        assert result is plans[1]

    def test_label_uses_name_when_set(self) -> None:
        plans = [_plan("plan-001", name="Q3 hull survey")]
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = plans[0]
            pick_plan(plans, {})
        choices = mock_select.call_args.kwargs["choices"]
        assert "Q3 hull survey" in choices[0].title

    def test_label_falls_back_to_date_label_when_name_is_none(self) -> None:
        plans = [_plan("plan-001", name=None)]
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = plans[0]
            pick_plan(plans, {})
        choices = mock_select.call_args.kwargs["choices"]
        assert "Plan from" in choices[0].title


# ---------------------------------------------------------------------------
# pick_plan_to_complete
# ---------------------------------------------------------------------------


class TestPickPlanToComplete:
    def test_returns_none_when_no_ready_plans(self) -> None:
        plans = [_plan(status="Draft"), _plan(status="Complete")]
        assert pick_plan_to_complete(plans, {}) is None

    def test_prompts_only_ready_plans(self) -> None:
        ready = _plan("plan-ready", status="Ready")
        plans = [ready, _plan("plan-draft", status="Draft")]
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = ready
            result = pick_plan_to_complete(plans, {})
        assert result is ready
        choices = mock_select.call_args.kwargs["choices"]
        choice_values = [c.value for c in choices]
        assert ready in choice_values
        assert all(v.status == "Ready" for v in choice_values)


# ---------------------------------------------------------------------------
# pick_or_create_campaign
# ---------------------------------------------------------------------------


class TestPickOrCreateCampaign:
    def test_returns_none_for_create_new(self) -> None:
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = "__create_new__"
            result = pick_or_create_campaign([])
        assert result is None

    def test_returns_existing_campaign(self) -> None:
        r = _result()
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = r
            result = pick_or_create_campaign([r])
        assert result is r


class TestPickMapCampaign:
    def test_exits_with_error_when_no_complete_campaign(self) -> None:
        with pytest.raises(typer.Exit):
            pick_map_campaign([_result("result-1", "InProgress")], interactive=True)

    def test_returns_the_only_complete_campaign_without_prompt(self) -> None:
        done = _result("result-2", "Complete")
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            result = pick_map_campaign([_result("result-1", "InProgress"), done], interactive=True)
        assert result is done
        mock_select.assert_not_called()

    def test_non_interactive_returns_the_newest_complete_campaign(self) -> None:
        newest = _result("result-new", "Complete", "2026-09-26")
        older = _result("result-old", "Complete", "2026-09-01")
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            result = pick_map_campaign([newest, older], interactive=False)
        assert result is newest
        mock_select.assert_not_called()

    def test_interactive_prompts_among_complete_campaigns(self) -> None:
        newest = _result("result-new", "Complete", "2026-09-26")
        older = _result("result-old", "Complete", "2026-09-01")
        running = _result("result-run", "InProgress", "2026-09-27")
        with patch("uidss.cli.selectors.questionary.select") as mock_select:
            mock_select.return_value.unsafe_ask.return_value = older
            result = pick_map_campaign([running, newest, older], interactive=True)
        assert result is older
        choices = mock_select.call_args.kwargs["choices"]
        assert [c.value for c in choices] == [newest, older]


# ---------------------------------------------------------------------------
# ask_campaign_date / ask_pcd_label / confirm
# ---------------------------------------------------------------------------


class TestTextInputs:
    def test_ask_campaign_date_uses_input(self) -> None:
        with patch("uidss.cli.selectors.questionary.text") as mock_text:
            mock_text.return_value.unsafe_ask.return_value = "2026-01-15"
            result = ask_campaign_date()
        assert result == "2026-01-15"

    def test_ask_campaign_date_defaults_to_today_on_empty(self) -> None:
        from datetime import date

        with patch("uidss.cli.selectors.questionary.text") as mock_text:
            mock_text.return_value.unsafe_ask.return_value = ""
            result = ask_campaign_date()
        assert result == date.today().isoformat()

    def test_ask_pcd_label_uses_input(self) -> None:
        with patch("uidss.cli.selectors.questionary.text") as mock_text:
            mock_text.return_value.unsafe_ask.return_value = "My label"
            result = ask_pcd_label("cloud.pcd", "Pointcloud")
        assert result == "My label"

    def test_ask_pcd_label_uses_default_on_empty(self) -> None:
        with patch("uidss.cli.selectors.questionary.text") as mock_text:
            mock_text.return_value.unsafe_ask.return_value = ""
            result = ask_pcd_label("cloud.pcd", "Pointcloud")
        assert result == "Pointcloud"

    def test_confirm_returns_bool(self) -> None:
        with patch("uidss.cli.selectors.questionary.confirm") as mock_confirm:
            mock_confirm.return_value.unsafe_ask.return_value = True
            assert confirm("Proceed?") is True


# ---------------------------------------------------------------------------
# _ms_to_date
# ---------------------------------------------------------------------------


class TestFormatPlanLabel:
    def test_returns_name_when_set(self) -> None:
        plan = _plan(name="Q3 hull survey")
        assert _format_plan_label(plan) == "Q3 hull survey"

    def test_falls_back_to_date_label_when_name_is_none(self) -> None:
        plan = _plan(name=None, created_time=1_746_614_400_000)
        label = _format_plan_label(plan)
        assert label.startswith("Plan from ")
        assert _ms_to_date(plan.created_time) in label


class TestMsToDate:
    def test_zero_returns_dash(self) -> None:
        assert _ms_to_date(0) == "—"

    def test_negative_returns_dash(self) -> None:
        assert _ms_to_date(-1) == "—"

    def test_valid_timestamp(self) -> None:
        result = _ms_to_date(1_746_614_400_000)
        assert result.startswith("2025") or result.startswith("2026")
