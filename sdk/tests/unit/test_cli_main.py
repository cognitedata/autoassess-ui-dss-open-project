"""Tests for the `dss plan list` CLI command."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import typer
from cognite.client.exceptions import CogniteAPIError
from pydantic import BaseModel, ValidationError
from typer.testing import CliRunner

from uidss.cli.main import app
from uidss.models import Area, InspectionPlan, InspectionResult, Vessel
from uidss.services.threed_service import CampaignCadModel

runner = CliRunner()


def _make_validation_error() -> ValidationError:
    class _Settings(BaseModel):
        client_id: str

    try:
        _Settings.model_validate({})
    except ValidationError as e:
        return e
    raise AssertionError("expected ValidationError")


def _stub_client(plans: list[InspectionPlan]) -> tuple[MagicMock, ...]:
    vessel = Vessel(space="autoassess", external_id="v-1", name="Ship A", vessel_type="tanker")
    area = Area(
        space="autoassess",
        external_id="a-1",
        name="BWT Port",
        area_type="ballast_water_tank",
        vessel_external_id="v-1",
    )
    vessels_svc = MagicMock()
    vessels_svc.list.return_value = [vessel]
    areas_svc = MagicMock()
    areas_svc.list.return_value = [area]
    plans_svc = MagicMock()
    plans_svc.list.return_value = plans
    plans_svc.count_tasks.return_value = {p.external_id: 0 for p in plans}
    return (vessels_svc, areas_svc, plans_svc, *(MagicMock() for _ in range(5)))


class TestPlanList:
    def test_renders_the_plan_name_in_the_table(self) -> None:
        plan = InspectionPlan(
            space="autoassess",
            external_id="plan-001",
            area_external_id="a-1",
            status="Draft",
            created_time=0,
            name="Q3 hull survey",
        )
        with patch("uidss.cli.main._get_client", return_value=_stub_client([plan])):
            result = runner.invoke(app, ["plan", "list"])
        assert result.exit_code == 0
        assert "Q3 hull survey" in result.output

    def test_falls_back_to_date_derived_label_when_name_is_none(self) -> None:
        plan = InspectionPlan(
            space="autoassess",
            external_id="plan-001",
            area_external_id="a-1",
            status="Draft",
            created_time=0,
            name=None,
        )
        with patch("uidss.cli.main._get_client", return_value=_stub_client([plan])):
            result = runner.invoke(app, ["plan", "list"])
        assert result.exit_code == 0
        assert "Plan from" in result.output

    def test_prints_message_when_no_plans_found(self) -> None:
        with patch("uidss.cli.main._get_client", return_value=_stub_client([])):
            result = runner.invoke(app, ["plan", "list"])
        assert result.exit_code == 0
        assert "No plans found" in result.output


def _stub_client_for_download_map(plan: InspectionPlan) -> tuple[tuple[MagicMock, ...], MagicMock]:
    vessel = Vessel(space="autoassess", external_id="v-1", name="Ship A", vessel_type="tanker")
    area = Area(
        space="autoassess",
        external_id="a-1",
        name="BWT Port",
        area_type="ballast_water_tank",
        vessel_external_id="v-1",
    )
    vessels_svc = MagicMock()
    vessels_svc.list.return_value = [vessel]
    areas_svc = MagicMock()
    areas_svc.list.return_value = [area]
    plans_svc = MagicMock()
    plans_svc.list.return_value = [plan]
    plans_svc.count_tasks.return_value = {plan.external_id: 0}
    campaign_svc = MagicMock()
    client_tuple = (
        vessels_svc,
        areas_svc,
        plans_svc,
        campaign_svc,
        *(MagicMock() for _ in range(4)),
    )
    return client_tuple, campaign_svc


class TestPlanDownloadMap:
    def test_errors_when_plan_has_no_map(self, tmp_path: Path) -> None:
        plan = InspectionPlan(
            space="autoassess",
            external_id="plan-001",
            area_external_id="a-1",
            status="Ready",
            created_time=0,
            map_external_id=None,
        )
        client_tuple, _ = _stub_client_for_download_map(plan)
        with (
            patch("uidss.cli.main._get_client", return_value=client_tuple),
            patch("uidss.cli.main.pick_plan", return_value=plan),
        ):
            result = runner.invoke(app, ["plan", "download-map", "-o", str(tmp_path)])
        assert result.exit_code == 1
        assert "no associated map" in result.output

    def test_downloads_map_files_for_the_selected_plan(self, tmp_path: Path) -> None:
        plan = InspectionPlan(
            space="autoassess",
            external_id="plan-001",
            area_external_id="a-1",
            status="Ready",
            created_time=0,
            map_external_id="result-001",
        )
        client_tuple, campaign_svc = _stub_client_for_download_map(plan)
        campaign_svc.download_map.return_value = [tmp_path / "result-001" / "mesh.ply"]
        with (
            patch("uidss.cli.main._get_client", return_value=client_tuple),
            patch("uidss.cli.main.pick_plan", return_value=plan),
        ):
            result = runner.invoke(app, ["plan", "download-map", "-o", str(tmp_path)])
        assert result.exit_code == 0
        campaign_svc.download_map.assert_called_once_with(
            "autoassess", "result-001", tmp_path / "result-001"
        )
        assert "mesh.ply" in result.output


class TestFriendlyErrorHandling:
    def test_cognite_api_error_prints_friendly_message(self) -> None:
        with patch(
            "uidss.cli.main._get_client",
            side_effect=CogniteAPIError("boom", code=500),
        ):
            result = runner.invoke(app, ["plan", "list"])
        assert result.exit_code == 1
        assert "Error" in result.output
        assert "boom" in result.output

    def test_settings_validation_error_prints_friendly_message(self) -> None:
        with patch("uidss.cli.main._get_client", side_effect=_make_validation_error()):
            result = runner.invoke(app, ["plan", "list"])
        assert result.exit_code == 1
        assert "Error" in result.output

    def test_value_error_prints_friendly_message(self) -> None:
        with patch("uidss.cli.main._get_client", side_effect=ValueError("bad plan data")):
            result = runner.invoke(app, ["plan", "list"])
        assert result.exit_code == 1
        assert "bad plan data" in result.output

    def test_keyboard_interrupt_prints_aborted(self) -> None:
        with patch("uidss.cli.main._get_client", side_effect=KeyboardInterrupt):
            result = runner.invoke(app, ["plan", "list"])
        assert result.exit_code == 130
        assert "Aborted" in result.output

    def test_typer_exit_from_folder_check_passes_through_unwrapped(self, tmp_path: object) -> None:
        missing = str(tmp_path) + "/does-not-exist"
        result = runner.invoke(app, ["campaign", "upload", missing])
        assert result.exit_code == 1
        assert "Error" in result.output
        assert "directory" in result.output

    def test_wrapper_reraises_typer_exit_directly(self) -> None:
        from uidss.cli.main import _friendly_errors

        @_friendly_errors
        def _raises_exit() -> None:
            raise typer.Exit(3)

        try:
            _raises_exit()
        except typer.Exit as e:
            assert e.exit_code == 3
        else:
            raise AssertionError("expected typer.Exit to propagate")


class TestCampaignBuild3dModel:
    def test_builds_model_from_the_campaigns_ply_and_waits(self, tmp_path: Path) -> None:
        campaign_svc = MagicMock()
        campaign_svc.get.return_value = _campaign(cdf_file_ids=(11,))
        campaign_svc.download_map.side_effect = lambda _s, _e, out: [_write_tiny_ply(out)]
        threed_svc = MagicMock()
        threed_svc.create_cad_model.return_value = CampaignCadModel("result-1", 5, 6, "Queued", 7)
        threed_svc.wait_until_processed.return_value = "Done"

        with patch("uidss.cli.main._get_client", return_value=_client(campaign_svc, threed_svc)):
            result = runner.invoke(app, ["campaign", "build-3d-model", "--campaign", "result-1"])

        assert result.exit_code == 0, result.output
        kwargs = threed_svc.create_cad_model.call_args.kwargs
        assert kwargs["campaign_external_id"] == "result-1"
        assert kwargs["zip_path"].suffix == ".zip"
        threed_svc.wait_until_processed.assert_called_once()
        assert "model 5" in result.output and "Done" in result.output

    def test_errors_when_campaign_has_no_ply_mesh(self) -> None:
        campaign_svc = MagicMock()
        campaign_svc.get.return_value = _campaign(cdf_file_ids=())

        with patch("uidss.cli.main._get_client", return_value=_client(campaign_svc, MagicMock())):
            result = runner.invoke(app, ["campaign", "build-3d-model", "--campaign", "result-1"])

        assert result.exit_code == 1
        assert "no PLY mesh" in result.output

    def test_errors_when_campaign_not_found(self) -> None:
        campaign_svc = MagicMock()
        campaign_svc.get.return_value = None

        with patch("uidss.cli.main._get_client", return_value=_client(campaign_svc, MagicMock())):
            result = runner.invoke(app, ["campaign", "build-3d-model", "--campaign", "nope"])

        assert result.exit_code == 1
        assert "not found" in result.output


def _campaign(cdf_file_ids: tuple[int, ...]) -> InspectionResult:
    return InspectionResult(
        space="autoassess",
        external_id="result-1",
        area_external_id="a-1",
        campaign_date="2026-09-25",
        status="Complete",
        cdf_file_ids=cdf_file_ids,
    )


def _client(campaign_svc: MagicMock, threed_svc: MagicMock) -> tuple[MagicMock, ...]:
    others = [MagicMock() for _ in range(4)]
    return (MagicMock(), MagicMock(), MagicMock(), campaign_svc, *others, threed_svc)


def _write_tiny_ply(out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "mesh.ply"
    path.write_text(
        "ply\nformat ascii 1.0\nelement vertex 3\n"
        "property float x\nproperty float y\nproperty float z\n"
        "element face 1\nproperty list uchar int vertex_index\nend_header\n"
        "0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n"
    )
    return path
