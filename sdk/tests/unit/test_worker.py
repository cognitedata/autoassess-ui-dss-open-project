"""Tests for ModelWorker — builds the 3D model of every uploaded mesh that lacks one."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import pytest

from uidss.models import InspectionResult, MeshFile
from uidss.services.threed_service import CadModel
from uidss.worker import ModelWorker


class TestTick:
    def test_builds_a_mesh_without_a_model_and_waits_for_processing(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")])

        report = env.worker().tick()

        assert report.built == ["f1"]
        assert env.builds == ["f1"]
        assert env.threed.waited == ["f1-cad-model"]
        assert env.meshes.downloaded == [1]

    def test_lists_meshes_of_the_given_area_only(self) -> None:
        env = _Env(meshes=[])

        env.worker(area="area-1").tick()

        assert env.meshes.areas == ["area-1"]

    def test_skips_meshes_that_already_have_a_model(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")], per_file={"f1": _cad("f1")})

        report = env.worker().tick()

        assert report.built == []
        assert env.builds == []

    def test_refreshes_the_status_of_models_still_processing(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")], per_file={"f1": _cad("f1", status="Processing")})

        report = env.worker().tick()

        assert env.threed.refreshed == ["f1-cad-model"]
        assert report.refreshed == ["f1"]
        assert env.builds == []

    def test_skips_meshes_a_legacy_campaign_model_already_shows(self) -> None:
        env = _Env(
            meshes=[_mesh(1, "f1", created=100)],
            campaigns=[_campaign("result-1", (1,))],
            legacy={"result-1": _cad("result-1", created=200)},
        )

        report = env.worker().tick()

        assert report.covered_by_legacy == ["f1"]
        assert env.builds == []

    def test_builds_a_mesh_added_to_a_legacy_campaign_after_its_model(self) -> None:
        env = _Env(
            meshes=[_mesh(1, "f1", created=300)],
            campaigns=[_campaign("result-1", (1,))],
            legacy={"result-1": _cad("result-1", created=200)},
        )

        assert env.worker().tick().built == ["f1"]

    def test_builds_meshes_that_belong_to_no_campaign(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")], campaigns=[])

        assert env.worker().tick().built == ["f1"]

    def test_builds_oldest_first_one_at_a_time(self) -> None:
        env = _Env(meshes=[_mesh(2, "new", created=20), _mesh(1, "old", created=10)])

        env.worker().tick()

        assert env.builds == ["old", "new"]

    def test_does_not_build_when_a_model_appeared_meanwhile(self) -> None:
        # e.g. `dss campaign upload` built it inline while this worker was converting
        env = _Env(meshes=[_mesh(1, "f1")])
        env.threed.appear_on_recheck = {"f1": _cad("f1")}

        report = env.worker().tick()

        assert report.built == []
        assert env.builds == []

    def test_reports_a_model_whose_processing_failed_without_rebuilding_it(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")])
        env.threed.wait_error = RuntimeError("3D processing Failed")

        report = env.worker().tick()

        assert report.built == ["f1"]
        assert report.failed == ["f1"]

    def test_leaves_a_slow_model_to_later_ticks(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")])
        env.threed.wait_error = TimeoutError("still Processing")

        report = env.worker().tick()

        assert report.built == ["f1"]
        assert report.failed == []


class TestBackoff:
    def test_a_failed_build_is_not_retried_before_its_backoff_elapses(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")], build_error=ValueError("bad PLY"))
        worker = env.worker(backoff_base_s=60)

        first = worker.tick()
        env.now += 30
        second = worker.tick()

        assert first.failed == ["f1"]
        assert second.backing_off == ["f1"]
        assert len(env.builds) == 1

    def test_retries_after_the_backoff_and_doubles_it(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")], build_error=ValueError("bad PLY"))
        worker = env.worker(backoff_base_s=60)

        worker.tick()  # fails at t=0, next try at 60
        env.now += 61
        worker.tick()  # fails again, next try at 61 + 120
        env.now += 100
        third = worker.tick()

        assert len(env.builds) == 2
        assert third.backing_off == ["f1"]

    def test_backoff_is_capped(self) -> None:
        env = _Env(meshes=[_mesh(1, "f1")], build_error=ValueError("bad PLY"))
        worker = env.worker(backoff_base_s=60, backoff_max_s=100)

        for _ in range(5):
            worker.tick()
            env.now += 101

        assert len(env.builds) == 5

    def test_one_bad_mesh_does_not_stop_the_others(self) -> None:
        env = _Env(meshes=[_mesh(1, "bad", created=1), _mesh(2, "good", created=2)])
        env.fail_for = {"bad"}

        report = env.worker().tick()

        assert report.failed == ["bad"]
        assert report.built == ["good"]


class TestRun:
    def test_once_runs_a_single_tick(self) -> None:
        env = _Env(meshes=[])
        sleeps: list[float] = []

        ticks = env.worker().run(poll_s=30, once=True, sleep=sleeps.append)

        assert ticks == 1
        assert sleeps == []

    def test_polls_until_stopped(self) -> None:
        env = _Env(meshes=[])
        sleeps: list[float] = []
        worker = env.worker()

        ticks = worker.run(
            poll_s=30, once=False, sleep=sleeps.append, stop=lambda: len(sleeps) >= 2
        )

        assert ticks == 3
        assert sleeps == [30, 30]

    def test_survives_a_tick_that_cannot_reach_cdf(self) -> None:
        env = _Env(meshes=[])
        env.meshes.list_error = OSError("network down")
        sleeps: list[float] = []

        ticks = env.worker().run(
            poll_s=5, once=False, sleep=sleeps.append, stop=lambda: len(sleeps) >= 1
        )

        assert ticks == 2

    def test_once_raises_when_cdf_cannot_be_reached(self) -> None:
        env = _Env(meshes=[])
        env.meshes.list_error = OSError("network down")

        with pytest.raises(OSError):
            env.worker().run(poll_s=5, once=True, sleep=lambda _s: None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _StubMeshes:
    def __init__(self, meshes: list[MeshFile]) -> None:
        self._meshes = meshes
        self.areas: list[str | None] = []
        self.downloaded: list[int] = []
        self.list_error: Exception | None = None

    def list_mesh_files(self, area_external_id: str | None = None) -> list[MeshFile]:
        self.areas.append(area_external_id)
        if self.list_error is not None:
            raise self.list_error
        return list(self._meshes)

    def get_mesh_files(self, file_ids: Sequence[int]) -> list[MeshFile]:
        return [m for m in self._meshes if m.file_id in file_ids]

    def download(self, mesh: MeshFile, output_dir: Path) -> Path:
        self.downloaded.append(mesh.file_id)
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / mesh.name
        path.write_text("ply")
        return path


class _StubCampaigns:
    def __init__(self, campaigns: list[InspectionResult]) -> None:
        self._campaigns = campaigns

    def list(self, area_space: str, area_external_id: str) -> list[InspectionResult]:
        return [c for c in self._campaigns if c.area_external_id == area_external_id]


class _StubThreeD:
    def __init__(self, per_file: dict[str, CadModel], legacy: dict[str, CadModel]) -> None:
        self.per_file = dict(per_file)
        self.legacy = legacy
        self.waited: list[str] = []
        self.refreshed: list[str] = []
        self.appear_on_recheck: dict[str, CadModel] = {}
        self.wait_error: Exception | None = None

    def find_models_for_files(self, file_external_ids: Sequence[str]) -> dict[str, CadModel]:
        return {x: m for x, m in self.per_file.items() if x in file_external_ids}

    def find_model_for_file(self, file_external_id: str) -> CadModel | None:
        self.per_file.update(self.appear_on_recheck)
        return self.per_file.get(file_external_id)

    def find_campaign_models(self, campaign_external_ids: Sequence[str]) -> dict[str, CadModel]:
        return {c: m for c, m in self.legacy.items() if c in campaign_external_ids}

    def refresh_status(self, model: CadModel) -> str:
        self.refreshed.append(model.model_node_id)
        return model.status

    def wait_until_processed(
        self, model: CadModel, timeout_s: float = 1800, poll_s: float = 15
    ) -> str:
        self.waited.append(model.model_node_id)
        if self.wait_error is not None:
            raise self.wait_error
        return "Done"


class _Env:
    """A worker wired to stubs, with a controllable clock."""

    def __init__(
        self,
        meshes: list[MeshFile],
        per_file: dict[str, CadModel] | None = None,
        campaigns: list[InspectionResult] | None = None,
        legacy: dict[str, CadModel] | None = None,
        build_error: Exception | None = None,
    ) -> None:
        self.meshes = _StubMeshes(meshes)
        self.campaigns = _StubCampaigns(campaigns or [])
        self.threed = _StubThreeD(per_file or {}, legacy or {})
        self.builds: list[str] = []
        self.build_error = build_error
        self.fail_for: set[str] = set()
        self.now = 1_000.0

    def build(self, ply: Path, source: MeshFile, threed: _StubThreeD, work_dir: Path) -> CadModel:
        self.builds.append(source.external_id)
        if self.build_error is not None:
            raise self.build_error
        if source.external_id in self.fail_for:
            raise ValueError("bad PLY")
        assert ply.exists()
        return _cad(source.external_id, status="Queued")

    def worker(self, area: str | None = None, **kwargs: float) -> ModelWorker:
        return ModelWorker(
            meshes=self.meshes,
            campaigns=self.campaigns,
            threed=self.threed,
            build=self.build,
            area=area,
            clock=lambda: self.now,
            **kwargs,
        )


def _mesh(file_id: int, external_id: str, created: int = 1) -> MeshFile:
    return MeshFile(file_id, external_id, f"{external_id}.ply", "area-1", created)


def _cad(node: str, status: str = "Done", created: int = 0) -> CadModel:
    return CadModel(f"{node}-cad-model", f"{node}-cad-revision", 5, 6, status, 7, None, created)


def _campaign(external_id: str, file_ids: tuple[int, ...]) -> InspectionResult:
    return InspectionResult(
        space="autoassess",
        external_id=external_id,
        area_external_id="area-1",
        campaign_date="2026-09-28",
        status="Complete",
        cdf_file_ids=file_ids,
    )
