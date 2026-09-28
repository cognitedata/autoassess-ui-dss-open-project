"""Vertex welding, vertex-clustering decimation and a binary PLY writer.

Used to build the small "collision proxy" the web viewer ray-casts against for surface
normals, image-pixel rays and the hover ring (Reveal's picking returns no normals).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import numpy.typing as npt

from uidss.threed.ply import PlyMesh


def weld(mesh: PlyMesh) -> PlyMesh:
    """Merge vertices with identical positions (supereight meshes are triangle soups)."""
    positions, inverse = np.unique(mesh.positions, axis=0, return_inverse=True)
    faces = inverse.reshape(-1)[mesh.faces]
    return PlyMesh(positions=positions.astype(np.float32), faces=faces.astype(np.int64))


def decimate(mesh: PlyMesh, max_faces: int) -> PlyMesh:
    """Return a welded mesh with at most *max_faces* triangles (colours are dropped)."""
    welded = weld(mesh)
    if len(welded.faces) <= max_faces:
        return welded
    extent = welded.positions.max(0) - welded.positions.min(0)
    cell = float(np.linalg.norm(extent)) / np.sqrt(max_faces)
    while True:
        proxy = _cluster(welded, cell)
        if len(proxy.faces) <= max_faces:
            return proxy
        cell *= 1.25


def write_binary_ply(path: Path, mesh: PlyMesh) -> None:
    header = (
        "ply\nformat binary_little_endian 1.0\ncomment autoassess collision proxy\n"
        f"element vertex {len(mesh.positions)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        f"element face {len(mesh.faces)}\n"
        "property list uchar int vertex_index\nend_header\n"
    ).encode()
    faces = np.empty(len(mesh.faces), dtype=[("n", "u1"), ("i", "<i4", (3,))])
    faces["n"] = 3
    faces["i"] = mesh.faces
    with path.open("wb") as fh:
        fh.write(header)
        fh.write(mesh.positions.astype("<f4").tobytes())
        fh.write(faces.tobytes())


def _cluster(mesh: PlyMesh, cell: float) -> PlyMesh:
    origin = mesh.positions.min(0)
    keys = np.floor((mesh.positions - origin) / cell).astype(np.int64)
    _, cluster, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    cluster = cluster.reshape(-1)
    sums = np.zeros((len(counts), 3), dtype=np.float64)
    np.add.at(sums, cluster, mesh.positions)
    positions = (sums / counts[:, None]).astype(np.float32)
    faces = cluster[mesh.faces]
    keep = (
        (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    )
    faces = _unique_faces(faces[keep])
    return PlyMesh(positions=positions, faces=faces)


def _unique_faces(faces: npt.NDArray[np.int64]) -> npt.NDArray[np.int64]:
    if len(faces) == 0:
        return faces
    _, first = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
    return faces[np.sort(first)]
