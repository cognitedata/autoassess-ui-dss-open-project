"""Tests for the `dss` CLI commands."""

from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import typer
from click.testing import Result
from cognite.client.exceptions import CogniteAPIError
from pydantic import BaseModel, ValidationError
from typer.testing import CliRunner

from uidss.cli.main import app
from uidss.models import (
    Area,
    InspectionPlan,
    InspectionResult,
    InspectionTask,
    NewRegionTask,
    Vessel,
)
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


_FINDINGS_CSV = (
    "id,x,y,z,class,confidence\n"
    "c1,9.9,5,5,corrosion,0.9\n"
    "c2,9.9,5.3,5,corrosion,0.8\n"
    "k1,5,5,0.1,crack,0.7\n"
)


class TestPlanImportFindings:
    def test_dry_run_prints_the_tasks_and_writes_nothing(self, tmp_path: Path) -> None:
        plans = _StubPlanService()

        result = _import(tmp_path, plans, _StubCampaignService(), "--dry-run")

        assert result.exit_code == 0, result.output
        assert plans.created == []
        assert plans.added == []
        output = _plain(result.output)
        assert "Dry run" in output
        assert "3 findings read" in output
        assert "2 tasks" in output

    def test_creates_a_draft_plan_with_one_task_per_merged_finding(self, tmp_path: Path) -> None:
        plans = _StubPlanService()

        result = _import(tmp_path, plans, _StubCampaignService(), "--yes", "--name", "Run 7")

        assert result.exit_code == 0, result.output
        [(area, map_id, name, description)] = plans.created
        assert (area, map_id, name) == ("a-1", "result-new", "Run 7")
        assert description is not None and "findings.csv" in description
        [(plan_id, tasks)] = plans.added
        assert plan_id == "plan-new"
        by_id = {t.suggestion_id: t for t in tasks}
        assert set(by_id) == {"finding:c1+c2", "finding:k1"}
        assert by_id["finding:c1+c2"].normal_vector == pytest.approx((-1.0, 0.0, 0.0))
        assert by_id["finding:k1"].normal_vector == pytest.approx((0.0, 0.0, 1.0))
        assert "plan-new" in _plain(result.output)

    def test_default_map_is_the_newest_complete_campaign(self, tmp_path: Path) -> None:
        plans = _StubPlanService()
        campaigns = _StubCampaignService(
            [
                _result("result-running", "2026-09-27", "InProgress"),
                _result("result-new", "2026-09-26"),
                _result("result-old", "2026-09-01"),
            ]
        )

        result = _import(tmp_path, plans, campaigns, "--yes", map_id=None)

        assert result.exit_code == 0, result.output
        assert plans.created[0][1] == "result-new"
        assert campaigns.proxy_requests == ["result-new"]

    def test_default_plan_name_mentions_the_csv(self, tmp_path: Path) -> None:
        plans = _StubPlanService()

        _import(tmp_path, plans, _StubCampaignService(), "--yes")

        assert plans.created[0][2].startswith("Findings findings ")

    def test_refuses_a_map_that_is_not_a_complete_campaign_of_the_area(
        self, tmp_path: Path
    ) -> None:
        plans = _StubPlanService()

        result = _import(tmp_path, plans, _StubCampaignService(), "--yes", map_id="result-x")

        assert result.exit_code == 1
        assert "result-x" in _plain(result.output)
        assert plans.created == []

    def test_refuses_to_add_to_a_plan_that_is_not_draft(self, tmp_path: Path) -> None:
        plans = _StubPlanService(plans=[_plan("plan-ready", "Ready")])

        result = _import(tmp_path, plans, _StubCampaignService(), "--yes", "--plan", "plan-ready")

        assert result.exit_code == 1
        assert "Draft" in _plain(result.output)
        assert plans.created == []
        assert plans.added == []

    def test_adds_to_an_existing_draft_plan_using_its_map(self, tmp_path: Path) -> None:
        plans = _StubPlanService(plans=[_plan("plan-draft", "Draft", map_id="result-old")])
        campaigns = _StubCampaignService(
            [_result("result-new", "2026-09-26"), _result("result-old", "2026-09-01")]
        )

        result = _import(tmp_path, plans, campaigns, "--yes", "--plan", "plan-draft", map_id=None)

        assert result.exit_code == 0, result.output
        assert plans.created == []
        assert [plan_id for plan_id, _ in plans.added] == ["plan-draft"]
        assert campaigns.proxy_requests == ["result-old"]

    def test_reimport_skips_findings_already_in_the_plan(self, tmp_path: Path) -> None:
        plans = _StubPlanService(
            plans=[_plan("plan-draft", "Draft")],
            tasks=[_task("finding:c1+c2"), _task("finding:k1")],
        )

        result = _import(tmp_path, plans, _StubCampaignService(), "--yes", "--plan", "plan-draft")

        assert result.exit_code == 0, result.output
        assert plans.added == []
        assert "Nothing to import" in _plain(result.output)

    def test_reimport_adds_only_new_findings(self, tmp_path: Path) -> None:
        plans = _StubPlanService(
            plans=[_plan("plan-draft", "Draft")], tasks=[_task("finding:c1+c2")]
        )

        result = _import(tmp_path, plans, _StubCampaignService(), "--yes", "--plan", "plan-draft")

        assert result.exit_code == 0, result.output
        [(_, tasks)] = plans.added
        assert [t.suggestion_id for t in tasks] == ["finding:k1"]

    def test_normals_require_rejects_rows_without_normals(self, tmp_path: Path) -> None:
        plans = _StubPlanService()
        csv = "id,x,y,z,nx,ny,nz\nn1,9.9,5,5,-1,0,0\nbare,5,5,0.1,,,\n"

        result = _import(
            tmp_path, plans, _StubCampaignService(), "--yes", "--normals", "require", csv=csv
        )

        assert result.exit_code == 0, result.output
        assert "line 3" in _plain(result.output)
        [(_, tasks)] = plans.added
        assert [t.suggestion_id for t in tasks] == ["finding:n1"]

    def test_strict_makes_row_errors_fatal(self, tmp_path: Path) -> None:
        plans = _StubPlanService()
        csv = "id,x,y,z\nok,9.9,5,5\nbad,abc,5,5\n"

        result = _import(tmp_path, plans, _StubCampaignService(), "--yes", "--strict", csv=csv)

        assert result.exit_code == 1
        assert "line 3" in _plain(result.output)
        assert plans.created == []

    def test_falls_back_to_centre_normals_without_a_3d_model(self, tmp_path: Path) -> None:
        plans = _StubPlanService()

        result = _import(tmp_path, plans, _StubCampaignService(proxy=False), "--yes")

        assert result.exit_code == 0, result.output
        assert "no 3D model" in _plain(result.output)
        assert len(plans.added[0][1]) == 2

    def test_filters_by_confidence_and_class(self, tmp_path: Path) -> None:
        plans = _StubPlanService()

        result = _import(
            tmp_path,
            plans,
            _StubCampaignService(),
            "--yes",
            "--min-confidence",
            "0.75",
            "--class",
            "corrosion",
        )

        assert result.exit_code == 0, result.output
        [(_, tasks)] = plans.added
        assert [t.suggestion_id for t in tasks] == ["finding:c1+c2"]


# --- plan import-findings helpers -------------------------------------------


class _StubVesselService:
    def list(self) -> list[Vessel]:
        return [_VESSEL]


class _StubAreaService:
    def list(self, vessel_space: str, vessel_external_id: str) -> list[Area]:
        return [_AREA]


class _StubCampaignService:
    def __init__(self, campaigns: list[InspectionResult] | None = None, proxy: bool = True) -> None:
        self._campaigns = campaigns if campaigns is not None else [_result("result-new")]
        self._proxy = proxy
        self.proxy_requests: list[str] = []

    def list(self, area_space: str, area_external_id: str) -> list[InspectionResult]:
        return self._campaigns

    def download_collision_proxy(self, campaign_external_id: str, out_dir: Path) -> Path | None:
        self.proxy_requests.append(campaign_external_id)
        return _write_cube_ply(out_dir, size=10.0) if self._proxy else None


class _StubPlanService:
    def __init__(
        self,
        plans: list[InspectionPlan] | None = None,
        tasks: list[InspectionTask] | None = None,
    ) -> None:
        self._plans = plans or []
        self._tasks = tasks or []
        self.created: list[tuple[str, str, str, str | None]] = []
        self.added: list[tuple[str, list[NewRegionTask]]] = []

    def list(self, area_space: str, area_external_id: str) -> list[InspectionPlan]:
        return self._plans

    def list_tasks(self, plan_external_id: str) -> list[InspectionTask]:
        return self._tasks

    def create(
        self, area_external_id: str, map_external_id: str, name: str, description: str | None
    ) -> str:
        self.created.append((area_external_id, map_external_id, name, description))
        return "plan-new"

    def add_region_tasks(self, plan_external_id: str, tasks: Sequence[NewRegionTask]) -> list[str]:
        self.added.append((plan_external_id, list(tasks)))
        return [f"task-{i}" for i in range(len(tasks))]


_VESSEL = Vessel(space="autoassess", external_id="v-1", name="Ship A", vessel_type="tanker")
_AREA = Area(
    space="autoassess",
    external_id="a-1",
    name="BWT Port",
    area_type="ballast_water_tank",
    vessel_external_id="v-1",
)


def _import(
    tmp_path: Path,
    plans: _StubPlanService,
    campaigns: _StubCampaignService,
    *args: str,
    csv: str = _FINDINGS_CSV,
    map_id: str | None = "result-new",
) -> Result:
    csv_path = tmp_path / "findings.csv"
    csv_path.write_text(csv)
    services = (_StubVesselService(), _StubAreaService(), plans, campaigns, *([None] * 5))
    cli_args = ["plan", "import-findings", str(csv_path), "--area", "a-1", *args]
    if map_id is not None:
        cli_args += ["--map", map_id]
    # _get_client is the CLI's only service factory; stubs are injected through it.
    with patch("uidss.cli.main._get_client", return_value=services):
        return runner.invoke(app, cli_args)


def _result(
    external_id: str, campaign_date: str = "2026-09-26", status: str = "Complete"
) -> InspectionResult:
    return InspectionResult(
        space="autoassess",
        external_id=external_id,
        area_external_id="a-1",
        campaign_date=campaign_date,
        status="Complete" if status == "Complete" else "InProgress",
    )


def _plan(external_id: str, status: str, map_id: str = "result-new") -> InspectionPlan:
    return InspectionPlan(
        space="autoassess",
        external_id=external_id,
        area_external_id="a-1",
        status="Ready" if status == "Ready" else "Draft",
        created_time=0,
        map_external_id=map_id,
    )


def _task(suggestion_id: str) -> InspectionTask:
    return InspectionTask(
        space="autoassess",
        external_id=f"task-{suggestion_id}",
        plan_external_id="plan-draft",
        kind="region",
        inspection_type="visual",
        suggestion_id=suggestion_id,
    )


def _plain(output: str) -> str:
    """Strip ANSI styling (FORCE_COLOR in some shells) and join Rich's wrapped lines."""
    return re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", output)


def _write_cube_ply(out_dir: Path, size: float) -> Path:
    """An axis-aligned [0, size]³ box as an ASCII PLY: 8 corners, 12 triangles."""
    out_dir.mkdir(parents=True, exist_ok=True)
    corners = [(x, y, z) for x in (0, size) for y in (0, size) for z in (0, size)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    faces = [tri for a, b, c, d in quads for tri in ((a, b, c), (a, c, d))]
    path = out_dir / "proxy.ply"
    path.write_text(
        "ply\nformat ascii 1.0\nelement vertex 8\n"
        "property float x\nproperty float y\nproperty float z\n"
        "element face 12\nproperty list uchar int vertex_index\nend_header\n"
        + "".join(f"{x} {y} {z}\n" for x, y, z in corners)
        + "".join(f"3 {a} {b} {c}\n" for a, b, c in faces)
    )
    return path


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
