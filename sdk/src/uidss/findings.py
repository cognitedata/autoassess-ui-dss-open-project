"""Findings (points of interest) → region tasks for a Draft inspection plan.

Pipelines such as defect or change detection write a CSV of findings in the map campaign's
frame. This module parses and validates it, filters and merges nearby findings, estimates
missing surface normals from the campaign's collision-proxy mesh, and returns the region
tasks to add to a plan. It is pure: writing to CDF is the caller's job
(``client.plans.create`` / ``client.plans.add_region_tasks``, or ``dss plan import-findings``).

CSV format (header names are case-insensitive and trimmed; unknown columns are ignored):

============================ =========================================================
column                       meaning
============================ =========================================================
``x, y, z`` (required)       position in metres, in the map campaign's frame
``id``                       stable finding id (default: a hash of the row's values)
``nx, ny, nz``               surface normal (all three or none; normalised on read)
``radius``                   task radius in metres (default 0.3)
``inspection_type``          ``visual`` | ``ndt_thickness`` (default ``visual``)
``class``                    finding class, e.g. ``corrosion``
``confidence``               0 to 1
``description``              free text
============================ =========================================================

Each task gets ``suggestionId = "finding:<id>"`` (``finding:<id1>+<id2>…`` for a merged
cluster), which links it back to its findings and makes re-imports idempotent.
"""

from __future__ import annotations

import csv
import hashlib
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from uidss.models import InspectionType, NewRegionTask, Vec3
from uidss.threed.normals import NormalEstimator, fallback_normal, mesh_centre
from uidss.threed.ply import PlyMesh

NormalMode = Literal["model", "centre", "require"]
NormalSource = Literal["csv", "model", "centre"]

DEFAULT_RADIUS_M = 0.3
DEFAULT_MERGE_RADIUS_M = 0.5
DEFAULT_MAX_NORMAL_DISTANCE_M = 1.0
SUGGESTION_PREFIX = "finding:"
MAX_SUGGESTION_ID_LENGTH = 255
MAX_ID_LENGTH = 200

REQUIRED_COLUMNS = ("x", "y", "z")
KNOWN_COLUMNS = frozenset(
    {
        "id",
        "x",
        "y",
        "z",
        "nx",
        "ny",
        "nz",
        "radius",
        "inspection_type",
        "class",
        "confidence",
        "description",
    }
)
_INSPECTION_TYPES: dict[str, InspectionType] = {
    "visual": "visual",
    "ndt_thickness": "ndt_thickness",
}


@dataclass(frozen=True)
class Finding:
    """One CSV row. ``None`` means "not given" (defaults are applied when merging)."""

    id: str
    position: Vec3
    normal: Vec3 | None = None
    radius_m: float | None = None
    inspection_type: InspectionType | None = None
    finding_class: str | None = None
    confidence: float | None = None
    description: str | None = None
    line: int = 0  # 1-based line in the CSV (header is line 1)


@dataclass(frozen=True)
class RowError:
    line: int
    message: str


@dataclass(frozen=True)
class FindingCluster:
    """One or more nearby findings that become a single region task."""

    member_ids: tuple[str, ...]
    position: Vec3  # mean of the members
    normal: Vec3 | None  # mean of the members' known normals, if any
    radius_m: float  # covers every member's own radius
    inspection_type: InspectionType  # ndt_thickness if any member needs it
    classes: tuple[str, ...] = ()
    confidence: float | None = None  # highest member confidence


@dataclass(frozen=True)
class PlannedTask:
    task: NewRegionTask
    cluster: FindingCluster
    normal_source: NormalSource  # csv | model (collision proxy) | centre (fallback)


@dataclass(frozen=True)
class FindingsPlan:
    tasks: list[PlannedTask]
    already_in_plan: int = 0  # findings skipped because a task already covers them
    interior_point: Vec3 | None = None  # what normals were oriented towards

    def count(self, source: NormalSource) -> int:
        return sum(1 for t in self.tasks if t.normal_source == source)


class _InvalidRowError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Reading and filtering
# ---------------------------------------------------------------------------


def read_findings_csv(path: Path) -> tuple[list[Finding], list[RowError]]:
    """Parse a findings CSV. Bad rows are returned as ``RowError`` s, not raised.

    Raises ``ValueError`` only for file-level problems (no header, missing x/y/z column).
    """
    findings: list[Finding] = []
    errors: list[RowError] = []
    first_line: dict[str, int] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header is None or not any(h.strip() for h in header):
            raise ValueError(f"{path} is empty — expected a header row with x,y,z")
        names = [h.strip().lower() for h in header]
        missing = [c for c in REQUIRED_COLUMNS if c not in names]
        if missing:
            raise ValueError(f"{path} is missing required column(s): {', '.join(missing)}")
        for cells in reader:
            line = reader.line_num
            if not any(cell.strip() for cell in cells):
                continue
            row = {
                name: cells[i].strip()
                for i, name in enumerate(names)
                if i < len(cells) and name in KNOWN_COLUMNS
            }
            try:
                finding = _parse_row(row, line)
            except _InvalidRowError as e:
                errors.append(RowError(line, str(e)))
                continue
            if finding.id in first_line:
                first = first_line[finding.id]
                message = f"duplicate id {finding.id!r} (first used on line {first})"
                errors.append(RowError(line, message))
                continue
            first_line[finding.id] = line
            findings.append(finding)
    return findings, errors


def filter_findings(
    findings: Sequence[Finding],
    min_confidence: float | None = None,
    classes: Iterable[str] | None = None,
) -> list[Finding]:
    """Keep findings at or above *min_confidence* and in *classes* (case-insensitive).

    Findings without a confidence are kept by the confidence filter; findings without a class
    are dropped by the class filter.
    """
    wanted = {c.strip().lower() for c in classes} if classes else None
    kept: list[Finding] = []
    for f in findings:
        confidence = f.confidence
        if min_confidence is not None and confidence is not None and confidence < min_confidence:
            continue
        if wanted is not None and (f.finding_class or "").lower() not in wanted:
            continue
        kept.append(f)
    return kept


def require_normals(findings: Sequence[Finding]) -> tuple[list[Finding], list[RowError]]:
    """Split off findings without a normal, as row errors (for ``--normals require``)."""
    kept = [f for f in findings if f.normal is not None]
    errors = [
        RowError(f.line, "missing normal: nx, ny, nz are required with normals=require")
        for f in findings
        if f.normal is None
    ]
    return kept, errors


# ---------------------------------------------------------------------------
# Merging and suggestion ids
# ---------------------------------------------------------------------------


@dataclass
class _ClusterBuilder:
    members: list[Finding] = field(default_factory=list)
    position_sum: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    normal_sum: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])

    def add(self, f: Finding) -> None:
        self.members.append(f)
        for i in range(3):
            self.position_sum[i] += f.position[i]
            if f.normal is not None:
                self.normal_sum[i] += f.normal[i]

    @property
    def centre(self) -> Vec3:
        n = len(self.members)
        return (self.position_sum[0] / n, self.position_sum[1] / n, self.position_sum[2] / n)

    def accepts_normal(self, normal: Vec3 | None) -> bool:
        # Don't merge findings that face away from each other (two sides of a thin plate).
        return normal is None or _dot(tuple(self.normal_sum), normal) >= 0


def merge_findings(
    findings: Sequence[Finding],
    merge_radius_m: float = DEFAULT_MERGE_RADIUS_M,
    default_radius_m: float = DEFAULT_RADIUS_M,
    default_inspection_type: InspectionType = "visual",
) -> list[FindingCluster]:
    """Greedy clustering: each finding joins the nearest cluster whose centre is within
    *merge_radius_m* (and whose normal doesn't face away), else starts a new one.
    ``merge_radius_m <= 0`` disables merging.
    """
    builders: list[_ClusterBuilder] = []
    for f in findings:
        best: _ClusterBuilder | None = None
        best_distance = math.inf
        if merge_radius_m > 0:
            for b in builders:
                distance = math.dist(b.centre, f.position)
                closer = distance <= merge_radius_m and distance < best_distance
                if closer and b.accepts_normal(f.normal):
                    best, best_distance = b, distance
        if best is None:
            best = _ClusterBuilder()
            builders.append(best)
        best.add(f)
    return [_finish(b, default_radius_m, default_inspection_type) for b in builders]


def finding_suggestion_id(cluster: FindingCluster) -> str:
    """``finding:<id>`` / ``finding:<id1>+<id2>…`` (sorted), capped at 255 characters.

    When capped, as many ids as fit are kept, followed by ``+~<hash>`` of the full id.
    """
    ids = sorted(cluster.member_ids)
    full = SUGGESTION_PREFIX + "+".join(ids)
    if len(full) <= MAX_SUGGESTION_ID_LENGTH:
        return full
    digest = "~" + hashlib.sha256(full.encode()).hexdigest()[:12]
    kept: list[str] = []
    length = len(SUGGESTION_PREFIX) + len(digest)
    for finding_id in ids:
        if length + len(finding_id) + 1 > MAX_SUGGESTION_ID_LENGTH:
            break
        kept.append(finding_id)
        length += len(finding_id) + 1
    return SUGGESTION_PREFIX + "+".join([*kept, digest])


def covered_finding_ids(suggestion_ids: Iterable[str]) -> set[str]:
    """Finding ids named by existing tasks' ``finding:`` suggestion ids."""
    covered: set[str] = set()
    for sid in suggestion_ids:
        if not sid.startswith(SUGGESTION_PREFIX):
            continue
        for token in sid.removeprefix(SUGGESTION_PREFIX).split("+"):
            if token and not token.startswith("~"):
                covered.add(token)
    return covered


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


def plan_tasks_from_findings(
    findings: Sequence[Finding],
    *,
    merge_radius_m: float = DEFAULT_MERGE_RADIUS_M,
    default_radius_m: float = DEFAULT_RADIUS_M,
    default_inspection_type: InspectionType = "visual",
    normals: NormalMode = "model",
    mesh: PlyMesh | None = None,
    interior_point: Vec3 | None = None,
    existing_suggestion_ids: Iterable[str] = (),
    max_normal_distance_m: float = DEFAULT_MAX_NORMAL_DISTANCE_M,
) -> FindingsPlan:
    """Turn findings into region tasks (nothing is written).

    - Findings already covered by *existing_suggestion_ids* (the target plan's tasks) are
      skipped, so re-imports add nothing twice.
    - Normals: the CSV's if given; else (``model``) the nearest collision-proxy triangle's
      normal within *max_normal_distance_m*; else (and always for ``centre``) the direction
      towards *interior_point*. ``require`` raises if any finding lacks a normal.
    - *interior_point* defaults to the mesh's bounding-box centre, else the findings'.
    """
    existing = set(existing_suggestion_ids)
    covered = covered_finding_ids(existing)
    fresh = [f for f in findings if f.id not in covered]
    if normals == "require":
        missing = [f for f in fresh if f.normal is None]
        if missing:
            lines = ", ".join(str(f.line) for f in missing[:10])
            raise ValueError(f"{len(missing)} finding(s) have no normal (lines {lines})")

    clusters = merge_findings(fresh, merge_radius_m, default_radius_m, default_inspection_type)
    skipped = len(findings) - len(fresh)
    kept: list[FindingCluster] = []
    for cluster in clusters:
        if finding_suggestion_id(cluster) in existing:
            skipped += len(cluster.member_ids)
        else:
            kept.append(cluster)
    if not kept:
        return FindingsPlan(tasks=[], already_in_plan=skipped)

    interior = interior_point or (mesh_centre(mesh) if mesh is not None else None)
    interior = interior or _bbox_centre([f.position for f in findings])
    estimator = (
        NormalEstimator(mesh, interior, max_normal_distance_m)
        if mesh is not None and normals == "model"
        else None
    )
    tasks = [_plan_task(c, estimator, interior) for c in kept]
    return FindingsPlan(tasks=tasks, already_in_plan=skipped, interior_point=interior)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _plan_task(
    cluster: FindingCluster, estimator: NormalEstimator | None, interior: Vec3
) -> PlannedTask:
    source: NormalSource = "csv"
    normal = cluster.normal
    if normal is None and estimator is not None:
        normal = estimator.estimate(cluster.position)
        source = "model"
    if normal is None:
        normal = fallback_normal(cluster.position, interior)
        source = "centre"
    task = NewRegionTask(
        position3d=cluster.position,
        normal_vector=normal,
        radius_m=cluster.radius_m,
        inspection_type=cluster.inspection_type,
        suggestion_id=finding_suggestion_id(cluster),
    )
    return PlannedTask(task=task, cluster=cluster, normal_source=source)


def _finish(
    b: _ClusterBuilder, default_radius_m: float, default_inspection_type: InspectionType
) -> FindingCluster:
    centre = b.centre
    radius = max(
        math.dist(f.position, centre) + (f.radius_m if f.radius_m is not None else default_radius_m)
        for f in b.members
    )
    needs_ndt = any(
        (f.inspection_type or default_inspection_type) == "ndt_thickness" for f in b.members
    )
    confidences = [f.confidence for f in b.members if f.confidence is not None]
    return FindingCluster(
        member_ids=tuple(f.id for f in b.members),
        position=centre,
        normal=_unit(tuple(b.normal_sum)),
        radius_m=radius,
        inspection_type="ndt_thickness" if needs_ndt else "visual",
        classes=tuple(sorted({f.finding_class for f in b.members if f.finding_class})),
        confidence=max(confidences) if confidences else None,
    )


def _parse_row(row: dict[str, str], line: int) -> Finding:
    position = (_float(row, "x"), _float(row, "y"), _float(row, "z"))
    return Finding(
        id=_row_id(row),
        position=position,
        normal=_normal(row),
        radius_m=_radius(row),
        inspection_type=_inspection_type(row),
        finding_class=row.get("class") or None,
        confidence=_confidence(row),
        description=row.get("description") or None,
        line=line,
    )


def _row_id(row: dict[str, str]) -> str:
    finding_id = row.get("id", "")
    if not finding_id:
        canonical = "\x1f".join(f"{k}={v}" for k, v in sorted(row.items()) if v and k != "id")
        return "row-" + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    if "+" in finding_id:
        raise _InvalidRowError(f"id {finding_id!r} must not contain '+'")
    if len(finding_id) > MAX_ID_LENGTH:
        raise _InvalidRowError(f"id is longer than {MAX_ID_LENGTH} characters")
    return finding_id


def _float(row: dict[str, str], column: str) -> float:
    raw = row.get(column, "")
    if not raw:
        raise _InvalidRowError(f"{column} is missing")
    try:
        value = float(raw)
    except ValueError:
        raise _InvalidRowError(f"{column} {raw!r} is not a number") from None
    if not math.isfinite(value):
        raise _InvalidRowError(f"{column} {raw!r} is not a finite number")
    return value


def _normal(row: dict[str, str]) -> Vec3 | None:
    given = [bool(row.get(c)) for c in ("nx", "ny", "nz")]
    if not any(given):
        return None
    if not all(given):
        raise _InvalidRowError("nx, ny and nz must all be set or all be empty")
    normal = _unit((_float(row, "nx"), _float(row, "ny"), _float(row, "nz")))
    if normal is None:
        raise _InvalidRowError("normal (nx, ny, nz) is zero-length")
    return normal


def _radius(row: dict[str, str]) -> float | None:
    if not row.get("radius"):
        return None
    radius = _float(row, "radius")
    if radius <= 0:
        raise _InvalidRowError(f"radius must be a positive number of metres, got {radius}")
    return radius


def _inspection_type(row: dict[str, str]) -> InspectionType | None:
    raw = row.get("inspection_type", "").lower()
    if not raw:
        return None
    if raw not in _INSPECTION_TYPES:
        raise _InvalidRowError(f"inspection_type must be visual or ndt_thickness, got {raw!r}")
    return _INSPECTION_TYPES[raw]


def _confidence(row: dict[str, str]) -> float | None:
    if not row.get("confidence"):
        return None
    confidence = _float(row, "confidence")
    if not 0 <= confidence <= 1:
        raise _InvalidRowError(f"confidence must be between 0 and 1, got {confidence}")
    return confidence


def _bbox_centre(points: Sequence[Vec3]) -> Vec3:
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    return ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)


def _unit(v: tuple[float, ...]) -> Vec3 | None:
    length = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if length < 1e-9:
        return None
    return (v[0] / length, v[1] / length, v[2] / length)


def _dot(u: tuple[float, ...], v: Vec3) -> float:
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
