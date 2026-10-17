"""Convert a mission PLY mesh into an OBJ+MTL zip that CDF's 3D pipeline can process.

- Faces are grouped by their segment colour: one OBJ group + material per colour, so every
  segment becomes its own CAD node that the viewer can style ("defects" colour mode).
- If the mesh has per-vertex camera colours ("colorization" mode) they are baked into
  textures. The mesh is first split into spatially compact chunks, each with its own
  texture: CDF splits a model into spatial sectors and copies every texture a sector
  references into that sector, so one global atlas would be duplicated into every sector.
  Groups are then per (segment, chunk), named ``seg_<rgb>_c<chunk>``. Textured materials use
  Kd 1 1 1 (MTL multiplies Kd with map_Kd); segment colours are returned in ``palette``.
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

import numpy as np
import numpy.typing as npt

from uidss.threed.bake import TextureBake, bake_vertex_colours
from uidss.threed.decimate import weld
from uidss.threed.legend import ColourClassifier, rgb_to_hex, sanitise_class_name
from uidss.threed.ply import PlyMesh
from uidss.threed.png import write_png

NEUTRAL_RGB = (0x88, 0xAA, 0xFF)  # flat colour the viewer uses when a mesh has no colours
_ROWS_PER_WRITE = 200_000


@dataclass(frozen=True)
class CadConversion:
    zip_path: Path
    has_texture: bool
    palette: dict[str, tuple[int, int, int]]  # group/material name -> segment RGB
    vertex_count: int
    face_count: int
    legend: dict[str, str]  # segment colour hex -> class name, for the named segments only


def convert_mesh_to_cad_zip(
    mesh: PlyMesh,
    zip_path: Path,
    max_texture_size: int = 2048,
    max_faces_per_chunk: int = 100_000,
    workers: int = 1,
    classify: ColourClassifier | None = None,
) -> CadConversion:
    welded = weld(mesh)
    segment_of_face, segment_palette, legend = _segment_groups(mesh, classify)

    uvs: npt.NDArray[np.float32] | None = None
    textures: list[npt.NDArray[np.uint8]] = []
    if mesh.vertex_rgb is None:
        group_of_face, palette, texture_of_group = segment_of_face, segment_palette, None
    else:
        chunks = spatial_chunks(mesh, max_faces_per_chunk)
        bakes = _bake_chunks(mesh, chunks, max_texture_size, workers)
        uvs = np.empty((len(mesh.faces), 3, 2), dtype=np.float32)
        chunk_of_face = np.empty(len(mesh.faces), dtype=np.int64)
        for index, (faces, bake) in enumerate(zip(chunks, bakes, strict=True)):
            uvs[faces] = bake.uvs
            chunk_of_face[faces] = index
            textures.append(bake.image)
        group_of_face, palette, texture_of_group = _chunked_groups(
            segment_of_face, segment_palette, chunk_of_face
        )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        with (tmp_dir / "model.obj").open("w") as fh:
            _write_obj(fh, welded, group_of_face, list(palette), uvs)
        (tmp_dir / "model.mtl").write_text(_mtl(palette, texture_of_group))
        members = ["model.obj", "model.mtl"]
        for index, image in enumerate(textures):
            name = f"texture_{index}.png"
            write_png(tmp_dir / name, image)
            members.append(name)
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name in members:
                zf.write(tmp_dir / name, arcname=name)

    return CadConversion(
        zip_path=zip_path,
        has_texture=bool(textures),
        palette=palette,
        vertex_count=len(welded.positions),
        face_count=len(welded.faces),
        legend=legend,
    )


def spatial_chunks(mesh: PlyMesh, max_faces: int) -> list[npt.NDArray[np.int64]]:
    """Split face indices by recursive median cuts along the longest axis of their centroids."""
    centroids = mesh.positions[mesh.faces].mean(axis=1)
    pending = [np.arange(len(mesh.faces))]
    done: list[npt.NDArray[np.int64]] = []
    while pending:
        faces = pending.pop()
        if len(faces) <= max_faces:
            done.append(faces)
            continue
        points = centroids[faces]
        axis = int(np.argmax(points.max(axis=0) - points.min(axis=0)))
        order = np.argsort(points[:, axis], kind="stable")
        half = len(faces) // 2
        pending += [faces[order[half:]], faces[order[:half]]]
    return done


def _bake_chunks(
    mesh: PlyMesh, chunks: list[npt.NDArray[np.int64]], max_size: int, workers: int
) -> list[TextureBake]:
    submeshes = [_submesh(mesh, faces) for faces in chunks]
    if workers <= 1 or len(submeshes) == 1:
        return [bake_vertex_colours(sub, max_size) for sub in submeshes]
    with ProcessPoolExecutor(max_workers=min(workers, len(submeshes), os.cpu_count() or 1)) as pool:
        return list(pool.map(bake_vertex_colours, submeshes, [max_size] * len(submeshes)))


def _submesh(mesh: PlyMesh, faces: npt.NDArray[np.int64]) -> PlyMesh:
    used, local = np.unique(mesh.faces[faces], return_inverse=True)
    assert mesh.vertex_rgb is not None  # only called for vertex-coloured meshes
    return PlyMesh(
        positions=mesh.positions[used],
        faces=local.reshape(-1, 3).astype(np.int64),
        vertex_rgb=mesh.vertex_rgb[used],
    )


def _segment_groups(
    mesh: PlyMesh,
    classify: ColourClassifier | None,
) -> tuple[npt.NDArray[np.int64], dict[str, tuple[int, int, int]], dict[str, str]]:
    """Face → segment index, segment palette, and the colour → class legend actually used.

    A segment whose colour *classify* names is grouped as the sanitised class name (a second
    colour with the same class gets ``<class>_<rgb>``); any other keeps ``seg_<rgb>``.
    """
    if mesh.face_rgb is None:
        return np.zeros(len(mesh.faces), dtype=np.int64), {"seg_none": NEUTRAL_RGB}, {}
    colours, first, inverse = np.unique(
        mesh.face_rgb, axis=0, return_index=True, return_inverse=True
    )
    order = np.argsort(first)  # palette in order of first appearance
    rank = np.empty_like(order)
    rank[order] = np.arange(len(order))
    palette: dict[str, tuple[int, int, int]] = {}
    legend: dict[str, str] = {}
    for r, g, b in colours[order]:
        rgb = (int(r), int(g), int(b))
        hex_colour = rgb_to_hex(rgb)
        name = f"seg_{hex_colour}"
        class_name = classify(rgb) if classify else None
        if class_name:
            stem = sanitise_class_name(class_name)
            if stem:
                name = stem if stem not in palette else f"{stem}_{hex_colour}"
                legend[hex_colour] = class_name
        palette[name] = rgb
    return rank[inverse.reshape(-1)], palette, legend


def _chunked_groups(
    segment_of_face: npt.NDArray[np.int64],
    segment_palette: dict[str, tuple[int, int, int]],
    chunk_of_face: npt.NDArray[np.int64],
) -> tuple[npt.NDArray[np.int64], dict[str, tuple[int, int, int]], dict[str, str]]:
    segments = list(segment_palette.items())
    keys = chunk_of_face * len(segments) + segment_of_face
    used, group_of_face = np.unique(keys, return_inverse=True)
    palette: dict[str, tuple[int, int, int]] = {}
    texture_of_group: dict[str, str] = {}
    for key in used:
        chunk, segment = divmod(int(key), len(segments))
        name, rgb = segments[segment]
        group = f"{name}_c{chunk}"
        palette[group] = rgb
        texture_of_group[group] = f"texture_{chunk}.png"
    return group_of_face.reshape(-1).astype(np.int64), palette, texture_of_group


def _write_obj(
    fh: TextIO,
    mesh: PlyMesh,
    group_of_face: npt.NDArray[np.int64],
    group_names: list[str],
    uvs: npt.NDArray[np.float32] | None,
) -> None:
    fh.write("# autoassess mission mesh\nmtllib model.mtl\n")
    _write_rows(fh, "v %.6f %.6f %.6f\n", mesh.positions)
    if uvs is not None:
        _write_rows(fh, "vt %.7f %.7f\n", uvs.reshape(-1, 2))
    order = np.argsort(group_of_face, kind="stable")
    bounds = np.searchsorted(group_of_face[order], np.arange(len(group_names) + 1))
    for group, name in enumerate(group_names):
        face_index = order[bounds[group] : bounds[group + 1]]
        if face_index.size == 0:
            continue
        fh.write(f"g {name}\nusemtl {name}\n")
        v = mesh.faces[face_index] + 1
        if uvs is None:
            _write_rows(fh, "f %d %d %d\n", v)
        else:
            t = face_index[:, None] * 3 + np.arange(3)[None, :] + 1
            _write_rows(fh, "f %d/%d %d/%d %d/%d\n", np.stack([v, t], axis=2).reshape(-1, 6))


def _write_rows(fh: TextIO, fmt: str, rows: npt.NDArray[np.generic]) -> None:
    for start in range(0, len(rows), _ROWS_PER_WRITE):
        chunk = rows[start : start + _ROWS_PER_WRITE]
        fh.write((fmt * len(chunk)) % tuple(chunk.ravel().tolist()))


def _mtl(palette: dict[str, tuple[int, int, int]], texture_of_group: dict[str, str] | None) -> str:
    lines: list[str] = []
    for name, (r, g, b) in palette.items():
        lines.append(f"newmtl {name}")
        if texture_of_group is not None:
            lines += ["Kd 1.000000 1.000000 1.000000", f"map_Kd {texture_of_group[name]}"]
        else:
            lines.append(f"Kd {r / 255:.6f} {g / 255:.6f} {b / 255:.6f}")
        lines += ["Ka 0.000000 0.000000 0.000000", "Ks 0.000000 0.000000 0.000000", ""]
    return "\n".join(lines)
