"""Tests for uidss.threed.normals — surface normals from the collision-proxy mesh."""

from __future__ import annotations

import numpy as np
import pytest

from uidss.threed.normals import (
    NormalEstimator,
    closest_points_on_triangles,
    fallback_normal,
    mesh_centre,
)
from uidss.threed.ply import PlyMesh

CENTRE = (0.5, 0.5, 0.5)


class TestNormalEstimator:
    def test_point_near_the_plus_x_face_gets_minus_x_towards_the_interior(self) -> None:
        estimator = NormalEstimator(_unit_cube(), CENTRE)
        assert estimator.estimate((0.95, 0.5, 0.5)) == pytest.approx((-1.0, 0.0, 0.0))

    def test_point_just_outside_the_wall_still_points_into_the_tank(self) -> None:
        estimator = NormalEstimator(_unit_cube(), CENTRE)
        assert estimator.estimate((1.05, 0.4, 0.6)) == pytest.approx((-1.0, 0.0, 0.0))

    @pytest.mark.parametrize(
        ("point", "expected"),
        [
            ((0.5, 0.5, 0.02), (0.0, 0.0, 1.0)),  # floor → up
            ((0.5, 0.5, 0.98), (0.0, 0.0, -1.0)),  # ceiling → down
            ((0.5, 0.03, 0.5), (0.0, 1.0, 0.0)),
            ((0.04, 0.5, 0.5), (1.0, 0.0, 0.0)),
        ],
    )
    def test_uses_the_nearest_face(
        self, point: tuple[float, float, float], expected: tuple[float, float, float]
    ) -> None:
        estimator = NormalEstimator(_unit_cube(), CENTRE)
        assert estimator.estimate(point) == pytest.approx(expected)

    def test_normals_are_flipped_regardless_of_winding(self) -> None:
        cube = _unit_cube()
        inward = PlyMesh(positions=cube.positions, faces=cube.faces[:, ::-1].copy())
        estimator = NormalEstimator(inward, CENTRE)
        assert estimator.estimate((0.95, 0.5, 0.5)) == pytest.approx((-1.0, 0.0, 0.0))

    def test_flips_towards_the_given_interior_point(self) -> None:
        # Interior on the far side of the +x wall → normal points +x.
        estimator = NormalEstimator(_unit_cube(), (5.0, 0.5, 0.5))
        assert estimator.estimate((0.95, 0.5, 0.5)) == pytest.approx((1.0, 0.0, 0.0))

    def test_returns_none_when_no_surface_within_max_distance(self) -> None:
        estimator = NormalEstimator(_unit_cube(), CENTRE, max_distance_m=1.0)
        assert estimator.estimate((5.0, 5.0, 5.0)) is None

    def test_returns_unit_length_normals(self) -> None:
        mesh = PlyMesh(
            positions=np.array([[0, 0, 0], [3, 0, 0], [0, 4, 1]], dtype=np.float32),
            faces=np.array([[0, 1, 2]], dtype=np.int64),
        )
        normal = NormalEstimator(mesh, (0.0, 0.0, 10.0)).estimate((0.5, 0.5, 0.2))
        assert normal is not None
        assert np.linalg.norm(normal) == pytest.approx(1.0)

    def test_skips_degenerate_triangles(self) -> None:
        mesh = PlyMesh(
            positions=np.array([[0, 0, 0], [1, 0, 0], [2, 0, 0]], dtype=np.float32),
            faces=np.array([[0, 1, 2]], dtype=np.int64),
        )
        assert NormalEstimator(mesh, CENTRE).estimate((1.0, 0.0, 0.0)) is None

    def test_empty_mesh_estimates_nothing(self) -> None:
        mesh = PlyMesh(
            positions=np.zeros((0, 3), dtype=np.float32), faces=np.zeros((0, 3), dtype=np.int64)
        )
        assert NormalEstimator(mesh, CENTRE).estimate((0.0, 0.0, 0.0)) is None


class TestFallbackNormal:
    def test_points_from_the_finding_towards_the_interior(self) -> None:
        assert fallback_normal((0.0, 0.0, 3.0), (0.0, 0.0, 0.0)) == pytest.approx((0.0, 0.0, -1.0))

    def test_degenerate_when_the_point_is_the_interior(self) -> None:
        assert fallback_normal((1.0, 1.0, 1.0), (1.0, 1.0, 1.0)) == (0.0, 1.0, 0.0)


class TestClosestPointsOnTriangles:
    @pytest.mark.parametrize(
        ("point", "expected"),
        [
            ((0.2, 0.2, 1.0), (0.2, 0.2, 0.0)),  # above the face
            ((-1.0, -1.0, 0.0), (0.0, 0.0, 0.0)),  # vertex a
            ((2.0, -0.5, 0.0), (1.0, 0.0, 0.0)),  # vertex b
            ((-0.5, 2.0, 0.0), (0.0, 1.0, 0.0)),  # vertex c
            ((0.5, -1.0, 0.0), (0.5, 0.0, 0.0)),  # edge ab
            ((-1.0, 0.5, 0.0), (0.0, 0.5, 0.0)),  # edge ac
            ((1.0, 1.0, 0.0), (0.5, 0.5, 0.0)),  # edge bc
        ],
    )
    def test_every_voronoi_region(
        self, point: tuple[float, float, float], expected: tuple[float, float, float]
    ) -> None:
        triangle = np.array([[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]])
        [closest] = closest_points_on_triangles(np.array(point), triangle)
        assert tuple(closest) == pytest.approx(expected)


class TestMeshCentre:
    def test_is_the_bounding_box_centre(self) -> None:
        assert mesh_centre(_unit_cube()) == pytest.approx(CENTRE)

    def test_empty_mesh_raises(self) -> None:
        mesh = PlyMesh(
            positions=np.zeros((0, 3), dtype=np.float32), faces=np.zeros((0, 3), dtype=np.int64)
        )
        with pytest.raises(ValueError, match="no vertices"):
            mesh_centre(mesh)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _unit_cube() -> PlyMesh:
    """Axis-aligned [0, 1]³ cube, 12 triangles wound outwards."""
    corners = np.array(
        [[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], dtype=np.float32
    )
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    faces = [tri for a, b, c, d in quads for tri in ((a, b, c), (a, c, d))]
    return PlyMesh(positions=corners, faces=np.array(faces, dtype=np.int64))
