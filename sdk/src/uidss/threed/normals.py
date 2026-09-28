"""Surface normals for points of interest, estimated from a campaign's collision-proxy mesh.

The proxy (built by ``dss campaign build-3d-model``) is a decimated triangle mesh in the
campaign's map frame. For a point, the nearest triangle's face normal is used, flipped to
face an *interior point* (normally the area's centre) so that it points into the tank —
the side the drone inspects from. Mesh winding is not trusted.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from uidss.models import Vec3
from uidss.threed.ply import PlyMesh

_Array = npt.NDArray[np.float64]
_EPS = 1e-12
# Used when a direction is undefined; the web app uses the same default for region tasks.
DEFAULT_NORMAL: Vec3 = (0.0, 1.0, 0.0)


class NormalEstimator:
    """Nearest-triangle normals over a mesh, oriented towards *interior_point*."""

    def __init__(self, mesh: PlyMesh, interior_point: Vec3, max_distance_m: float = 1.0) -> None:
        positions = np.asarray(mesh.positions, dtype=np.float64).reshape(-1, 3)
        faces = np.asarray(mesh.faces, dtype=np.int64).reshape(-1, 3)
        triangles = positions[faces]  # (F, 3, 3)
        normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        lengths = np.linalg.norm(normals, axis=1)
        valid = lengths > _EPS  # zero-area triangles have no normal
        self._triangles: _Array = triangles[valid]
        self._normals: _Array = normals[valid] / lengths[valid, None]
        self._lo: _Array = self._triangles.min(axis=1)
        self._hi: _Array = self._triangles.max(axis=1)
        self._interior: _Array = np.asarray(interior_point, dtype=np.float64)
        self._max_distance = float(max_distance_m)

    def estimate(self, point: Vec3) -> Vec3 | None:
        """Unit normal of the nearest triangle within ``max_distance_m``, else ``None``."""
        p = np.asarray(point, dtype=np.float64)
        d = self._max_distance
        # Cheap pre-filter: triangles whose bounding box overlaps the cube p ± d.
        near = np.all(self._lo <= p + d, axis=1) & np.all(self._hi >= p - d, axis=1)
        candidates = np.flatnonzero(near)
        if candidates.size == 0:
            return None
        closest = closest_points_on_triangles(p, self._triangles[candidates])
        distances = np.linalg.norm(closest - p, axis=1)
        best = int(np.argmin(distances))
        if distances[best] > d:
            return None
        normal = self._normals[candidates[best]]
        if float(np.dot(normal, self._interior - closest[best])) < 0:
            normal = -normal
        return _vec3(normal)


def fallback_normal(point: Vec3, interior_point: Vec3) -> Vec3:
    """Unit vector from *point* towards *interior_point* (``DEFAULT_NORMAL`` if they coincide)."""
    direction = np.asarray(interior_point, dtype=np.float64) - np.asarray(point, dtype=np.float64)
    length = float(np.linalg.norm(direction))
    if length < 1e-9:
        return DEFAULT_NORMAL
    return _vec3(direction / length)


def mesh_centre(mesh: PlyMesh) -> Vec3:
    """Centre of the mesh's axis-aligned bounding box — a stand-in for the area centre."""
    positions = np.asarray(mesh.positions, dtype=np.float64).reshape(-1, 3)
    if positions.size == 0:
        raise ValueError("mesh has no vertices")
    return _vec3((positions.min(axis=0) + positions.max(axis=0)) / 2)


def closest_points_on_triangles(point: _Array, triangles: _Array) -> _Array:
    """Closest point to *point* on each of *triangles* (N, 3, 3), vectorised.

    Voronoi-region method from Ericson, *Real-Time Collision Detection*, §5.1.5. The regions
    are checked in the book's order, so later (higher-priority) assignments win.
    """
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    ab, ac = b - a, c - a
    ap, bp, cp = point - a, point - b, point - c
    d1, d2 = _dot(ab, ap), _dot(ac, ap)
    d3, d4 = _dot(ab, bp), _dot(ac, bp)
    d5, d6 = _dot(ab, cp), _dot(ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2

    with np.errstate(divide="ignore", invalid="ignore"):
        denom = va + vb + vc
        result = a + ab * (vb / denom)[:, None] + ac * (vc / denom)[:, None]  # inside face

        region_bc = (va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0)
        w_bc = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        result = np.where(region_bc[:, None], b + (c - b) * w_bc[:, None], result)

        region_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
        w_ac = d2 / (d2 - d6)
        result = np.where(region_ac[:, None], a + ac * w_ac[:, None], result)

        result = np.where(((d6 >= 0) & (d5 <= d6))[:, None], c, result)

        region_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
        v_ab = d1 / (d1 - d3)
        result = np.where(region_ab[:, None], a + ab * v_ab[:, None], result)

        result = np.where(((d3 >= 0) & (d4 <= d3))[:, None], b, result)
        result = np.where(((d1 <= 0) & (d2 <= 0))[:, None], a, result)
    return result


def _dot(u: _Array, v: _Array) -> _Array:
    return np.einsum("ij,ij->i", u, v)


def _vec3(v: npt.ArrayLike) -> Vec3:
    x, y, z = (float(c) for c in np.asarray(v, dtype=np.float64).reshape(3))
    return (x, y, z)
