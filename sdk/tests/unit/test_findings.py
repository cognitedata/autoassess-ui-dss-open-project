"""Tests for uidss.findings — CSV of findings → region tasks."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from uidss.findings import (
    Finding,
    FindingCluster,
    covered_finding_ids,
    filter_findings,
    finding_suggestion_id,
    merge_findings,
    plan_tasks_from_findings,
    read_findings_csv,
    require_normals,
)
from uidss.threed.ply import PlyMesh

FIXTURE = Path(__file__).parent.parent / "fixtures" / "findings.csv"

# ---------------------------------------------------------------------------
# read_findings_csv()
# ---------------------------------------------------------------------------


class TestReadFindingsCsv:
    def test_reads_required_columns_with_defaults(self, tmp_path: Path) -> None:
        path = _csv(tmp_path, "id,x,y,z\nf1,1,2,3\n")
        findings, errors = read_findings_csv(path)
        assert errors == []
        assert findings == [Finding(id="f1", position=(1.0, 2.0, 3.0), line=2)]

    def test_reads_optional_columns(self, tmp_path: Path) -> None:
        path = _csv(
            tmp_path,
            "id,x,y,z,nx,ny,nz,radius,inspection_type,class,confidence,description\n"
            "f1,1,2,3,0,0,2,0.5,ndt_thickness,corrosion,0.9,rust on stiffener\n",
        )
        findings, errors = read_findings_csv(path)
        assert errors == []
        assert findings[0] == Finding(
            id="f1",
            position=(1.0, 2.0, 3.0),
            normal=(0.0, 0.0, 1.0),
            radius_m=0.5,
            inspection_type="ndt_thickness",
            finding_class="corrosion",
            confidence=0.9,
            description="rust on stiffener",
            line=2,
        )

    def test_header_names_are_case_insensitive_and_trimmed(self, tmp_path: Path) -> None:
        path = _csv(tmp_path, " ID , X ,Y, z ,Inspection_Type\nf1, 1 ,2,3, Visual \n")
        findings, errors = read_findings_csv(path)
        assert errors == []
        assert findings[0].position == (1.0, 2.0, 3.0)
        assert findings[0].inspection_type == "visual"

    def test_ignores_unknown_columns(self, tmp_path: Path) -> None:
        path = _csv(tmp_path, "id,x,y,z,pipeline_run\nf1,1,2,3,run-7\n")
        findings, errors = read_findings_csv(path)
        assert errors == []
        assert len(findings) == 1

    def test_reads_utf8_bom_written_by_excel(self, tmp_path: Path) -> None:
        path = tmp_path / "findings.csv"
        path.write_bytes("﻿x,y,z\n1,2,3\n".encode())
        findings, errors = read_findings_csv(path)
        assert errors == []
        assert len(findings) == 1

    def test_missing_required_column_raises(self, tmp_path: Path) -> None:
        path = _csv(tmp_path, "id,x,y\nf1,1,2\n")
        with pytest.raises(ValueError, match="z"):
            read_findings_csv(path)

    def test_empty_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="header"):
            read_findings_csv(_csv(tmp_path, ""))

    @pytest.mark.parametrize(
        ("row", "message"),
        [
            ("f1,abc,2,3", "x"),
            ("f1,,2,3", "x"),
            ("f1,1,2,nan", "z"),
            ("f1,1,2,3,1,0,,", "nx, ny and nz"),
            ("f1,1,2,3,0,0,0", "zero-length"),
            ("f1,1,2,3,,,,-1", "radius"),
            ("f1,1,2,3,,,,,laser", "inspection_type"),
            ("f1,1,2,3,,,,,,,1.5", "confidence"),
            ("a+b,1,2,3", "'+'"),
        ],
    )
    def test_invalid_row_is_reported_with_its_line_number(
        self, tmp_path: Path, row: str, message: str
    ) -> None:
        header = "id,x,y,z,nx,ny,nz,radius,inspection_type,class,confidence\n"
        path = _csv(tmp_path, header + "ok,0,0,0\n" + row + "\n")
        findings, errors = read_findings_csv(path)
        assert [f.id for f in findings] == ["ok"]
        assert len(errors) == 1
        assert errors[0].line == 3
        assert message in errors[0].message

    def test_duplicate_id_is_reported(self, tmp_path: Path) -> None:
        path = _csv(tmp_path, "id,x,y,z\nf1,1,2,3\nf1,4,5,6\n")
        findings, errors = read_findings_csv(path)
        assert len(findings) == 1
        assert errors[0].line == 3
        assert "duplicate" in errors[0].message

    def test_missing_id_gets_a_stable_hash_of_the_row(self, tmp_path: Path) -> None:
        first, _ = read_findings_csv(_csv(tmp_path, "x,y,z,class\n1,2,3,crack\n"))
        reordered, _ = read_findings_csv(_csv(tmp_path, "class,z,y,x\ncrack,3,2,1\n"))
        other, _ = read_findings_csv(_csv(tmp_path, "x,y,z,class\n1,2,3.5,crack\n"))
        assert first[0].id.startswith("row-")
        assert first[0].id == reordered[0].id
        assert first[0].id != other[0].id

    def test_sample_fixture_parses_cleanly(self) -> None:
        findings, errors = read_findings_csv(FIXTURE)
        assert errors == []
        assert len(findings) >= 5


# ---------------------------------------------------------------------------
# filter_findings() / require_normals()
# ---------------------------------------------------------------------------


class TestFilterFindings:
    def test_min_confidence_drops_low_confidence_and_keeps_unknown(self) -> None:
        findings = [
            _finding("hi", confidence=0.9),
            _finding("lo", confidence=0.2),
            _finding("unknown"),
        ]
        kept = filter_findings(findings, min_confidence=0.5)
        assert [f.id for f in kept] == ["hi", "unknown"]

    def test_classes_filter_is_case_insensitive(self) -> None:
        findings = [
            _finding("a", finding_class="Corrosion"),
            _finding("b", finding_class="crack"),
            _finding("c"),
        ]
        kept = filter_findings(findings, classes=["corrosion"])
        assert [f.id for f in kept] == ["a"]

    def test_no_filters_keeps_everything(self) -> None:
        findings = [_finding("a"), _finding("b", confidence=0.0)]
        assert filter_findings(findings) == findings


class TestRequireNormals:
    def test_rows_without_normals_become_errors(self) -> None:
        with_normal = _finding("a", normal=(1.0, 0.0, 0.0))
        without = _finding("b", line=7)
        kept, errors = require_normals([with_normal, without])
        assert kept == [with_normal]
        assert errors[0].line == 7
        assert "normal" in errors[0].message


# ---------------------------------------------------------------------------
# merge_findings()
# ---------------------------------------------------------------------------


class TestMergeFindings:
    def test_two_points_within_radius_become_one_cluster(self) -> None:
        a = _finding("a", position=(0.0, 0.0, 0.0), radius_m=0.2)
        b = _finding("b", position=(0.4, 0.0, 0.0), inspection_type="ndt_thickness")
        clusters = merge_findings([a, b], merge_radius_m=0.5, default_radius_m=0.3)
        assert len(clusters) == 1
        cluster = clusters[0]
        assert cluster.member_ids == ("a", "b")
        assert cluster.position == pytest.approx((0.2, 0.0, 0.0))
        # b is 0.2 m from the centre and has the default 0.3 m radius → 0.5 m covers it.
        assert cluster.radius_m == pytest.approx(0.5)
        assert cluster.inspection_type == "ndt_thickness"

    def test_far_points_stay_separate(self) -> None:
        a = _finding("a", position=(0.0, 0.0, 0.0))
        b = _finding("b", position=(2.0, 0.0, 0.0))
        clusters = merge_findings([a, b], merge_radius_m=0.5)
        assert [c.member_ids for c in clusters] == [("a",), ("b",)]
        assert all(c.radius_m == pytest.approx(0.3) for c in clusters)
        assert all(c.inspection_type == "visual" for c in clusters)

    def test_zero_merge_radius_disables_merging(self) -> None:
        a = _finding("a", position=(0.0, 0.0, 0.0))
        b = _finding("b", position=(0.0, 0.0, 0.0))
        assert len(merge_findings([a, b], merge_radius_m=0.0)) == 2

    def test_opposite_normals_are_not_merged(self) -> None:
        # Two sides of a thin web frame: close in space, facing away from each other.
        a = _finding("a", position=(0.0, 0.0, 0.0), normal=(1.0, 0.0, 0.0))
        b = _finding("b", position=(0.02, 0.0, 0.0), normal=(-1.0, 0.0, 0.0))
        assert len(merge_findings([a, b], merge_radius_m=0.5)) == 2

    def test_merged_normal_is_the_normalised_mean_of_known_normals(self) -> None:
        a = _finding("a", normal=(1.0, 0.0, 0.0))
        b = _finding("b", normal=(0.0, 1.0, 0.0))
        c = _finding("c")
        [cluster] = merge_findings([a, b, c], merge_radius_m=0.5)
        s = 1 / math.sqrt(2)
        assert cluster.normal == pytest.approx((s, s, 0.0))

    def test_cluster_without_known_normals_has_none(self) -> None:
        [cluster] = merge_findings([_finding("a"), _finding("b")], merge_radius_m=0.5)
        assert cluster.normal is None

    def test_keeps_classes_and_max_confidence(self) -> None:
        a = _finding("a", finding_class="crack", confidence=0.4)
        b = _finding("b", finding_class="corrosion", confidence=0.8)
        [cluster] = merge_findings([a, b], merge_radius_m=0.5)
        assert cluster.classes == ("corrosion", "crack")
        assert cluster.confidence == pytest.approx(0.8)

    def test_default_inspection_type_applies_to_members_without_one(self) -> None:
        [cluster] = merge_findings(
            [_finding("a")], merge_radius_m=0.5, default_inspection_type="ndt_thickness"
        )
        assert cluster.inspection_type == "ndt_thickness"

    @given(
        st.lists(
            st.tuples(
                st.floats(-5, 5, allow_nan=False),
                st.floats(-5, 5, allow_nan=False),
                st.floats(-5, 5, allow_nan=False),
            ),
            min_size=1,
            max_size=20,
        )
    )
    def test_every_finding_lands_in_exactly_one_cluster_and_is_covered(
        self, points: list[tuple[float, float, float]]
    ) -> None:
        findings = [_finding(f"f{i}", position=p) for i, p in enumerate(points)]
        clusters = merge_findings(findings, merge_radius_m=0.5)
        ids = [i for c in clusters for i in c.member_ids]
        assert sorted(ids) == sorted(f.id for f in findings)
        by_id = {f.id: f for f in findings}
        for c in clusters:
            for member in c.member_ids:
                distance = math.dist(by_id[member].position, c.position)
                assert distance + 0.3 <= c.radius_m + 1e-9


# ---------------------------------------------------------------------------
# finding_suggestion_id() / covered_finding_ids()
# ---------------------------------------------------------------------------


class TestFindingSuggestionId:
    def test_single_finding(self) -> None:
        assert finding_suggestion_id(_cluster(("f1",))) == "finding:f1"

    def test_cluster_joins_sorted_member_ids(self) -> None:
        assert finding_suggestion_id(_cluster(("f2", "f1"))) == "finding:f1+f2"

    def test_long_cluster_is_capped_at_255_chars_with_a_hash(self) -> None:
        ids = tuple(f"finding-number-{i:04d}" for i in range(40))
        suggestion_id = finding_suggestion_id(_cluster(ids))
        assert len(suggestion_id) <= 255
        assert suggestion_id.startswith("finding:finding-number-0000+")
        assert "+~" in suggestion_id
        other = finding_suggestion_id(_cluster((*ids[:-1], "different")))
        assert other != suggestion_id


class TestCoveredFindingIds:
    def test_parses_single_merged_and_capped_ids_and_ignores_other_prefixes(self) -> None:
        covered = covered_finding_ids(
            ["finding:a", "finding:b+c", "finding:d+~0123456789ab", "confirmed_defect:x", "e"]
        )
        assert covered == {"a", "b", "c", "d"}


# ---------------------------------------------------------------------------
# plan_tasks_from_findings()
# ---------------------------------------------------------------------------


class TestPlanTasksFromFindings:
    def test_csv_normals_are_used_as_is(self) -> None:
        f = _finding("a", position=(0.9, 0.5, 0.5), normal=(0.0, 0.0, 1.0))
        result = plan_tasks_from_findings([f], mesh=_unit_cube())
        [planned] = result.tasks
        assert planned.normal_source == "csv"
        assert planned.task.normal_vector == (0.0, 0.0, 1.0)
        assert planned.task.suggestion_id == "finding:a"
        assert planned.task.position3d == pytest.approx((0.9, 0.5, 0.5))
        assert planned.task.radius_m == pytest.approx(0.3)
        assert planned.task.inspection_type == "visual"

    def test_missing_normal_is_estimated_from_the_mesh(self) -> None:
        f = _finding("a", position=(0.95, 0.5, 0.5))
        [planned] = plan_tasks_from_findings([f], mesh=_unit_cube()).tasks
        assert planned.normal_source == "model"
        assert planned.task.normal_vector == pytest.approx((-1.0, 0.0, 0.0))

    def test_point_far_from_the_mesh_falls_back_to_the_centre(self) -> None:
        f = _finding("a", position=(10.0, 0.5, 0.5))
        [planned] = plan_tasks_from_findings([f], mesh=_unit_cube()).tasks
        assert planned.normal_source == "centre"
        assert planned.task.normal_vector == pytest.approx((-1.0, 0.0, 0.0))

    def test_without_a_mesh_normals_point_at_the_given_interior_point(self) -> None:
        f = _finding("a", position=(0.0, 0.0, 5.0))
        [planned] = plan_tasks_from_findings([f], mesh=None, interior_point=(0.0, 0.0, 0.0)).tasks
        assert planned.normal_source == "centre"
        assert planned.task.normal_vector == pytest.approx((0.0, 0.0, -1.0))

    def test_centre_mode_ignores_the_mesh_surface(self) -> None:
        f = _finding("a", position=(0.95, 0.9, 0.5))
        [planned] = plan_tasks_from_findings([f], mesh=_unit_cube(), normals="centre").tasks
        assert planned.normal_source == "centre"
        expected = np.array([0.5 - 0.95, 0.5 - 0.9, 0.0])
        expected /= np.linalg.norm(expected)
        assert planned.task.normal_vector == pytest.approx(tuple(expected))

    def test_require_mode_rejects_findings_without_normals(self) -> None:
        with pytest.raises(ValueError, match="normal"):
            plan_tasks_from_findings([_finding("a")], normals="require")

    def test_findings_already_in_the_plan_are_skipped(self) -> None:
        findings = [
            _finding("a", position=(0.0, 0.0, 0.0)),
            _finding("b", position=(5.0, 0.0, 0.0)),
        ]
        result = plan_tasks_from_findings(
            findings,
            mesh=None,
            interior_point=(1.0, 0.0, 0.0),
            existing_suggestion_ids=["finding:a"],
        )
        assert [p.task.suggestion_id for p in result.tasks] == ["finding:b"]
        assert result.already_in_plan == 1

    def test_counts_normal_sources(self) -> None:
        findings = [
            _finding("csv", position=(0.9, 0.5, 0.5), normal=(-1.0, 0.0, 0.0)),
            _finding("model", position=(0.5, 0.05, 0.5)),
            _finding("far", position=(20.0, 20.0, 20.0)),
        ]
        result = plan_tasks_from_findings(findings, mesh=_unit_cube(), merge_radius_m=0.0)
        assert result.count("csv") == 1
        assert result.count("model") == 1
        assert result.count("centre") == 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _csv(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "findings.csv"
    path.write_text(text)
    return path


def _finding(
    finding_id: str,
    position: tuple[float, float, float] = (0.0, 0.0, 0.0),
    normal: tuple[float, float, float] | None = None,
    radius_m: float | None = None,
    inspection_type: str | None = None,
    finding_class: str | None = None,
    confidence: float | None = None,
    line: int = 2,
) -> Finding:
    return Finding(
        id=finding_id,
        position=position,
        normal=normal,
        radius_m=radius_m,
        inspection_type="ndt_thickness" if inspection_type == "ndt_thickness" else None,
        finding_class=finding_class,
        confidence=confidence,
        line=line,
    )


def _cluster(member_ids: tuple[str, ...]) -> FindingCluster:
    return FindingCluster(
        member_ids=member_ids,
        position=(0.0, 0.0, 0.0),
        normal=None,
        radius_m=0.3,
        inspection_type="visual",
    )


def _unit_cube() -> PlyMesh:
    """Axis-aligned [0, 1]³ cube, 12 triangles wound outwards."""
    corners = np.array(
        [[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], dtype=np.float32
    )
    quads = [
        (0, 1, 3, 2),  # -x
        (4, 6, 7, 5),  # +x
        (0, 4, 5, 1),  # -y
        (2, 3, 7, 6),  # +y
        (0, 2, 6, 4),  # -z
        (1, 5, 7, 3),  # +z
    ]
    faces = [tri for a, b, c, d in quads for tri in ((a, b, c), (a, c, d))]
    return PlyMesh(positions=corners, faces=np.array(faces, dtype=np.int64))
