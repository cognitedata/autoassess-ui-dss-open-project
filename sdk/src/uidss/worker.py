"""``dss worker`` — build the CDF 3D model of every uploaded mesh that doesn't have one.

The trigger is the upload itself: whoever uploads a mesh CogniteFile (tag ``ply_mesh``) —
the robot's ``autoassess_bridge`` node, ``dss campaign upload``, a script — gets its model
built, whether or not the file belongs to a campaign yet. Each tick:

1. list the mesh files (optionally of one area) and their per-file models;
2. refresh the status of models CDF is still processing (e.g. after a worker restart);
3. skip meshes a legacy campaign-keyed model already shows;
4. build the rest one at a time, oldest first, and wait for CDF to process each.

A build that fails is retried with exponential backoff and given up after ``max_attempts``
(until the worker restarts), so one bad mesh can't make the worker loop on it; the others
are still built. Nothing existing is modified or deleted.
"""

from __future__ import annotations

import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import structlog

from uidss.cdf.data_model import SPACE
from uidss.models import InspectionResult, MeshFile
from uidss.services.artifact_service import MeshFileServiceProtocol
from uidss.services.threed_service import (
    FINAL_STATUSES,
    CadModel,
    ThreeDServiceProtocol,
    covered_by_legacy,
)

log = structlog.get_logger()

_List = list  # avoid shadowing by the protocol method named `list`
BuildFn = Callable[[Path, MeshFile, ThreeDServiceProtocol, Path], CadModel]


class CampaignListerProtocol(Protocol):
    def list(self, area_space: str, area_external_id: str) -> _List[InspectionResult]: ...


@dataclass
class TickReport:
    built: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    backing_off: list[str] = field(default_factory=list)
    given_up: list[str] = field(default_factory=list)  # failed max_attempts times; until restart
    covered_by_legacy: list[str] = field(default_factory=list)
    refreshed: list[str] = field(default_factory=list)
    with_model: int = 0


@dataclass
class _Failure:
    count: int
    next_attempt: float


class ModelWorker:
    def __init__(
        self,
        meshes: MeshFileServiceProtocol,
        campaigns: CampaignListerProtocol,
        threed: ThreeDServiceProtocol,
        build: BuildFn,
        area: str | None = None,
        clock: Callable[[], float] = time.monotonic,
        backoff_base_s: float = 60,
        backoff_max_s: float = 3600,
        wait_timeout_s: float = 1800,
        max_attempts: int = 5,
    ) -> None:
        self._meshes = meshes
        self._campaigns = campaigns
        self._threed = threed
        self._build = build
        self._area = area
        self._clock = clock
        self._backoff_base = backoff_base_s
        self._backoff_max = backoff_max_s
        self._wait_timeout = wait_timeout_s
        self._max_attempts = max_attempts
        self._failures: dict[str, _Failure] = {}

    def tick(self) -> TickReport:
        report = TickReport()
        meshes = self._meshes.list_mesh_files(self._area)
        models = self._threed.find_models_for_files([m.external_id for m in meshes])
        report.with_model = len(models)
        for mesh in meshes:
            model = models.get(mesh.external_id)
            if model is not None and model.status not in FINAL_STATUSES:
                try:
                    self._threed.refresh_status(model)
                    report.refreshed.append(mesh.external_id)
                except Exception as e:  # a broken model must not block the other meshes
                    log.warning("status refresh failed", file=mesh.external_id, error=str(e))

        missing = [m for m in meshes if m.external_id not in models]
        legacy_covered = self._legacy_covered(missing)
        for mesh in sorted(missing, key=lambda m: (m.created_time, m.external_id)):
            if mesh.external_id in legacy_covered:
                report.covered_by_legacy.append(mesh.external_id)
                continue
            failure = self._failures.get(mesh.external_id)
            if failure is not None and failure.count >= self._max_attempts:
                report.given_up.append(mesh.external_id)
                continue
            if failure is not None and self._clock() < failure.next_attempt:
                report.backing_off.append(mesh.external_id)
                continue
            self._build_one(mesh, report)
        return report

    def run(
        self,
        poll_s: float,
        once: bool,
        sleep: Callable[[float], None] = time.sleep,
        stop: Callable[[], bool] = lambda: False,
        on_tick: Callable[[TickReport], None] = lambda _r: None,
    ) -> int:
        """Tick until *stop* (or once). Returns the number of ticks. ``once`` re-raises errors;
        otherwise a tick that fails (e.g. CDF unreachable) is logged and the next one runs."""
        ticks = 0
        while True:
            ticks += 1
            try:
                on_tick(self.tick())
            except Exception as e:  # the daemon must outlive network/CDF hiccups
                if once:
                    raise
                log.warning("worker tick failed", error=str(e))
            if once or stop():
                return ticks
            sleep(poll_s)

    def _legacy_covered(self, meshes: list[MeshFile]) -> set[str]:
        """Meshes that a legacy campaign model of a campaign listing them already shows."""
        by_area: dict[str, list[MeshFile]] = {}
        for mesh in meshes:
            if mesh.area_external_id:
                by_area.setdefault(mesh.area_external_id, []).append(mesh)
        covered: set[str] = set()
        for area, area_meshes in by_area.items():
            ids = {m.file_id for m in area_meshes}
            holders = [c for c in self._campaigns.list(SPACE, area) if ids & set(c.cdf_file_ids)]
            if not holders:
                continue
            legacy = self._threed.find_campaign_models([c.external_id for c in holders])
            for mesh in area_meshes:
                if any(
                    mesh.file_id in c.cdf_file_ids
                    and covered_by_legacy(mesh, legacy.get(c.external_id))
                    for c in holders
                ):
                    covered.add(mesh.external_id)
        return covered

    def _build_one(self, mesh: MeshFile, report: TickReport) -> None:
        log.info("building 3D model", file=mesh.external_id, name=mesh.name)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                ply = self._meshes.download(mesh, Path(tmp) / "source")
                # Someone else (e.g. `dss campaign upload`) may have built it meanwhile.
                if self._threed.find_model_for_file(mesh.external_id) is not None:
                    log.info("model appeared meanwhile; skipped", file=mesh.external_id)
                    return
                model = self._build(ply, mesh, self._threed, Path(tmp) / "build")
        except Exception as e:  # one bad mesh must not stop the worker; it is retried later
            self._record_failure(mesh, e)
            report.failed.append(mesh.external_id)
            return
        self._failures.pop(mesh.external_id, None)
        report.built.append(mesh.external_id)
        try:
            status = self._threed.wait_until_processed(model, timeout_s=self._wait_timeout)
            log.info("3D model ready", file=mesh.external_id, model=model.model_id, status=status)
        except TimeoutError:
            log.info("3D model still processing; later ticks refresh it", file=mesh.external_id)
        except RuntimeError as e:
            # The model exists but CDF could not process it; rebuilding would fail the same way.
            log.warning("3D processing failed", file=mesh.external_id, error=str(e))
            report.failed.append(mesh.external_id)

    def _record_failure(self, mesh: MeshFile, error: Exception) -> None:
        previous = self._failures.get(mesh.external_id)
        count = previous.count + 1 if previous else 1
        delay = min(self._backoff_base * 2 ** (count - 1), self._backoff_max)
        self._failures[mesh.external_id] = _Failure(count, self._clock() + delay)
        log.warning(
            "3D model build failed",
            file=mesh.external_id,
            error=str(error),
            attempt=count,
            retry_in_s=delay,
        )
