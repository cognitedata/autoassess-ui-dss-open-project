"""Minimal, fast PLY reader for triangle meshes (ASCII and binary little-endian).

Reads what the autoassess missions produce: vertex positions, optional per-vertex RGB
(camera colours) and optional per-face RGB (segment colours). Other properties are skipped.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import numpy.typing as npt

_PLY_TYPES: dict[str, str] = {
    "char": "i1",
    "int8": "i1",
    "uchar": "u1",
    "uint8": "u1",
    "short": "i2",
    "int16": "i2",
    "ushort": "u2",
    "uint16": "u2",
    "int": "i4",
    "int32": "i4",
    "uint": "u4",
    "uint32": "u4",
    "float": "f4",
    "float32": "f4",
    "double": "f8",
    "float64": "f8",
}
_RGB = ("red", "green", "blue")


@dataclass(frozen=True)
class PlyMesh:
    positions: npt.NDArray[np.float32]  # (V, 3)
    faces: npt.NDArray[np.int64]  # (F, 3) vertex indices
    vertex_rgb: npt.NDArray[np.uint8] | None = None  # (V, 3) camera colours
    face_rgb: npt.NDArray[np.uint8] | None = None  # (F, 3) segment colours


@dataclass
class _Element:
    name: str
    count: int
    scalars: list[tuple[str, str]] = field(default_factory=list)  # (name, numpy code)
    list_prop: tuple[str, str, str] | None = None  # (name, count code, index code)


def read_ply(path: Path) -> PlyMesh:
    data = path.read_bytes()
    marker = data.find(b"end_header")
    if not data.startswith(b"ply") or marker < 0:
        raise ValueError(f"{path} is not a PLY file")
    body_start = data.index(b"\n", marker) + 1
    fmt, elements = _parse_header(data[:marker].decode("ascii", errors="replace"))
    if fmt not in ("ascii", "binary_little_endian"):
        raise ValueError(f"unsupported PLY format {fmt!r} (big_endian is not supported)")

    vertex = _find(elements, "vertex")
    face = _find(elements, "face")
    if fmt == "ascii":
        vertex_rows, face_rows = _read_ascii(data, body_start, vertex, face)
        vertex_cols = [name for name, _ in vertex.scalars]
        face_cols = ["_n", "_a", "_b", "_c"] + [name for name, _ in face.scalars]
        v = {name: vertex_rows[:, i] for i, name in enumerate(vertex_cols)}
        f = {name: face_rows[:, i] for i, name in enumerate(face_cols)}
        indices = np.stack([f["_a"], f["_b"], f["_c"]], axis=1).astype(np.int64)
        counts = f["_n"]
    else:
        v, f, indices, counts = _read_binary(data, body_start, vertex, face)

    if counts.size and not np.all(counts == 3):
        raise ValueError(f"{path}: only triangle faces are supported")

    positions = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float32)
    return PlyMesh(
        positions=positions,
        faces=indices,
        vertex_rgb=_rgb(v),
        face_rgb=_rgb(f),
    )


def _parse_header(header: str) -> tuple[str, list[_Element]]:
    fmt = ""
    elements: list[_Element] = []
    for raw in header.splitlines():
        parts = raw.split()
        if not parts:
            continue
        if parts[0] == "format":
            fmt = parts[1]
        elif parts[0] == "element":
            elements.append(_Element(parts[1], int(parts[2])))
        elif parts[0] == "property" and elements:
            if parts[1] == "list":
                elements[-1].list_prop = (parts[4], _PLY_TYPES[parts[2]], _PLY_TYPES[parts[3]])
            else:
                elements[-1].scalars.append((parts[2], _PLY_TYPES[parts[1]]))
    return fmt, elements


def _find(elements: list[_Element], name: str) -> _Element:
    for element in elements:
        if element.name == name:
            return element
    raise ValueError(f"PLY has no {name!r} element")


def _read_ascii(
    data: bytes, start: int, vertex: _Element, face: _Element
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    # Locate the end of the vertex block by counting newlines, then let numpy's C parser
    # read each block in one pass (newlines count as whitespace separators).
    body = np.frombuffer(data, dtype=np.uint8, offset=start)
    newlines = np.flatnonzero(body == ord("\n"))
    split = int(newlines[vertex.count - 1]) + 1 if vertex.count else 0
    vertex_block = data[start : start + split].decode("ascii")
    face_block = data[start + split :].decode("ascii")
    v = np.fromstring(vertex_block, sep=" ") if vertex.count else np.zeros(0)
    f = np.fromstring(face_block, sep=" ") if face.count else np.zeros(0)
    face_width = 4 + len(face.scalars)
    if face.count and f.size != face.count * face_width:
        raise ValueError("only triangle faces are supported (face rows have unexpected width)")
    return v.reshape(vertex.count, len(vertex.scalars)), f.reshape(face.count, face_width)


def _read_binary(
    data: bytes, start: int, vertex: _Element, face: _Element
) -> tuple[
    dict[str, npt.NDArray[np.generic]],
    dict[str, npt.NDArray[np.generic]],
    npt.NDArray[np.int64],
    npt.NDArray[np.generic],
]:
    vertex_dtype = np.dtype([(name, "<" + code) for name, code in vertex.scalars])
    vertices = np.frombuffer(data, dtype=vertex_dtype, count=vertex.count, offset=start)
    if face.list_prop is None:
        raise ValueError("PLY face element has no vertex index list")
    _, count_code, index_code = face.list_prop
    face_dtype = np.dtype(
        [("_n", "<" + count_code), ("_idx", "<" + index_code, (3,))]
        + [(name, "<" + code) for name, code in face.scalars]
    )
    face_offset = start + vertex.count * vertex_dtype.itemsize
    faces = np.frombuffer(data, dtype=face_dtype, count=face.count, offset=face_offset)
    v = {name: vertices[name] for name, _ in vertex.scalars}
    f = {name: faces[name] for name, _ in face.scalars}
    return v, f, faces["_idx"].astype(np.int64), faces["_n"]


def _rgb(columns: Mapping[str, npt.NDArray[np.generic]]) -> npt.NDArray[np.uint8] | None:
    if not all(c in columns for c in _RGB):
        return None
    return np.stack([columns[c] for c in _RGB], axis=1).astype(np.uint8)
