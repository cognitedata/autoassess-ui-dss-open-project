"""Tests for PLY → CDF-3D conversion: texture bake, OBJ zip packaging, collision proxy."""

from __future__ import annotations

import struct
import zipfile
import zlib
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest

from uidss.threed.bake import TextureBake, bake_vertex_colours
from uidss.threed.convert import convert_mesh_to_cad_zip
from uidss.threed.decimate import decimate, write_binary_ply
from uidss.threed.ply import PlyMesh, read_ply
from uidss.threed.png import write_png


class TestWritePng:
    def test_round_trips_pixels(self, tmp_path: Path) -> None:
        pixels = np.arange(2 * 3 * 3, dtype=np.uint8).reshape(2, 3, 3)
        path = tmp_path / "t.png"

        write_png(path, pixels)

        np.testing.assert_array_equal(_read_png(path), pixels)


class TestBakeVertexColours:
    def test_centroid_texel_is_mean_of_corner_colours(self) -> None:
        mesh = _mesh(vertex_rgb=True)
        vertex_rgb = mesh.vertex_rgb
        assert vertex_rgb is not None

        bake = bake_vertex_colours(mesh, max_size=128)

        for f, face in enumerate(mesh.faces):
            centroid_uv = bake.uvs[f].mean(axis=0)
            expected = vertex_rgb[face].astype(float).mean(axis=0)
            np.testing.assert_allclose(_sample(bake, centroid_uv), expected, atol=4)

    def test_texel_near_corner_is_close_to_corner_colour(self) -> None:
        mesh = _mesh(vertex_rgb=True)
        vertex_rgb = mesh.vertex_rgb
        assert vertex_rgb is not None

        bake = bake_vertex_colours(mesh, max_size=128)

        for f, face in enumerate(mesh.faces):
            weights = np.array([0.8, 0.1, 0.1])
            uv = weights @ bake.uvs[f]
            expected = weights @ vertex_rgb[face].astype(float)
            np.testing.assert_allclose(_sample(bake, uv), expected, atol=8)

    def test_shared_vertex_colours_are_averaged_when_welding(self) -> None:
        positions = np.array(
            [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], dtype=np.float32
        )
        rgb = np.array(
            [[0, 0, 0], [200, 0, 0], [0, 0, 0], [100, 0, 0], [0, 0, 0], [0, 0, 0]], dtype=np.uint8
        )
        mesh = PlyMesh(positions=positions, faces=np.arange(6).reshape(2, 3), vertex_rgb=rgb)

        bake = bake_vertex_colours(mesh, max_size=128)

        # corner (1,0,0) of both faces now carries the average red = 150
        uv = np.array([0.1, 0.8, 0.1]) @ bake.uvs[0]
        assert abs(float(_sample(bake, uv)[0]) - 0.8 * 150) < 10

    def test_atlas_fits_max_size(self) -> None:
        bake = bake_vertex_colours(_grid_mesh_with_colours(40), max_size=256)

        assert bake.image.shape[0] <= 256 and bake.image.shape[1] <= 256

    def test_uvs_are_inside_unit_square(self) -> None:
        bake = bake_vertex_colours(_grid_mesh_with_colours(10), max_size=128)

        assert bake.uvs.min() >= 0.0 and bake.uvs.max() <= 1.0

    def test_returns_one_uv_triangle_per_input_face(self) -> None:
        mesh = _grid_mesh_with_colours(10)

        bake = bake_vertex_colours(mesh, max_size=128)

        assert bake.uvs.shape == (len(mesh.faces), 3, 2)

    def test_rejects_mesh_without_vertex_colours(self) -> None:
        with pytest.raises(ValueError, match="vertex colours"):
            bake_vertex_colours(_mesh(vertex_rgb=False), max_size=64)


class TestConvertMeshToCadZip:
    def test_face_coloured_mesh_has_one_group_per_colour_and_no_texture(
        self, tmp_path: Path
    ) -> None:
        result = convert_mesh_to_cad_zip(_mesh(vertex_rgb=False), tmp_path / "out.zip")

        names = zipfile.ZipFile(result.zip_path).namelist()
        assert sorted(names) == ["model.mtl", "model.obj"]
        assert result.has_texture is False
        assert result.palette == {"seg_ff0000": (255, 0, 0), "seg_0080ff": (0, 128, 255)}

    def test_obj_preserves_vertices_and_faces(self, tmp_path: Path) -> None:
        mesh = _mesh(vertex_rgb=False)

        result = convert_mesh_to_cad_zip(mesh, tmp_path / "out.zip")

        obj = _zip_text(result.zip_path, "model.obj")
        assert sum(line.startswith("v ") for line in obj) == len(mesh.positions)
        assert sum(line.startswith("f ") for line in obj) == len(mesh.faces)
        assert "usemtl seg_ff0000" in obj and "g seg_0080ff" in obj

    def test_mtl_uses_segment_colour_as_diffuse(self, tmp_path: Path) -> None:
        result = convert_mesh_to_cad_zip(_mesh(vertex_rgb=False), tmp_path / "out.zip")

        mtl = _zip_text(result.zip_path, "model.mtl")
        i = mtl.index("newmtl seg_0080ff")
        assert mtl[i + 1] == "Kd 0.000000 0.501961 1.000000"

    def test_vertex_coloured_mesh_gets_texture_and_uvs(self, tmp_path: Path) -> None:
        result = convert_mesh_to_cad_zip(
            _mesh(vertex_rgb=True), tmp_path / "out.zip", max_texture_size=64
        )

        names = zipfile.ZipFile(result.zip_path).namelist()
        assert sorted(names) == ["model.mtl", "model.obj", "texture_0.png"]
        obj = _zip_text(result.zip_path, "model.obj")
        assert sum(line.startswith("vt ") for line in obj) == 3 * 2
        assert any(line.startswith("f ") and "/" in line for line in obj)
        assert "map_Kd texture_0.png" in _zip_text(result.zip_path, "model.mtl")
        assert result.has_texture is True

    def test_large_textured_mesh_gets_one_texture_per_spatial_chunk(self, tmp_path: Path) -> None:
        mesh = _grid_mesh_with_colours(10)  # 200 faces

        result = convert_mesh_to_cad_zip(
            mesh, tmp_path / "out.zip", max_texture_size=64, max_faces_per_chunk=60
        )

        names = zipfile.ZipFile(result.zip_path).namelist()
        textures = sorted(n for n in names if n.startswith("texture_"))
        assert len(textures) >= 4
        obj = _zip_text(result.zip_path, "model.obj")
        assert sum(line.startswith("f ") for line in obj) == len(mesh.faces)
        mtl = _zip_text(result.zip_path, "model.mtl")
        assert sorted({line.split()[1] for line in mtl if line.startswith("map_Kd")}) == textures

    def test_textured_group_names_keep_segment_colour_and_chunk(self, tmp_path: Path) -> None:
        mesh = _grid_mesh_with_colours(10)
        mesh = PlyMesh(
            positions=mesh.positions,
            faces=mesh.faces,
            vertex_rgb=mesh.vertex_rgb,
            face_rgb=np.tile(np.array([[255, 0, 0]], dtype=np.uint8), (len(mesh.faces), 1)),
        )

        result = convert_mesh_to_cad_zip(
            mesh, tmp_path / "out.zip", max_texture_size=64, max_faces_per_chunk=60
        )

        assert all(name.startswith("seg_ff0000_c") for name in result.palette)
        assert set(result.palette.values()) == {(255, 0, 0)}

    def test_mesh_without_any_colour_gets_single_neutral_group(self, tmp_path: Path) -> None:
        mesh = PlyMesh(positions=_POSITIONS, faces=_FACES)

        result = convert_mesh_to_cad_zip(mesh, tmp_path / "out.zip")

        assert list(result.palette) == ["seg_none"]


class TestDecimate:
    def test_reduces_face_count_to_target(self) -> None:
        mesh = _grid_mesh(60)  # 7200 triangles

        proxy = decimate(mesh, max_faces=1000)

        assert 0 < len(proxy.faces) <= 1000

    def test_preserves_bounding_box_roughly(self) -> None:
        mesh = _grid_mesh(60)

        proxy = decimate(mesh, max_faces=1000)

        np.testing.assert_allclose(proxy.positions.min(0), mesh.positions.min(0), atol=0.1)
        np.testing.assert_allclose(proxy.positions.max(0), mesh.positions.max(0), atol=0.1)

    def test_has_no_degenerate_faces(self) -> None:
        proxy = decimate(_grid_mesh(60), max_faces=1000)

        f = proxy.faces
        assert np.all((f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2]))

    def test_small_mesh_is_welded_but_kept(self) -> None:
        mesh = _grid_mesh(4)  # 32 non-indexed triangles

        proxy = decimate(mesh, max_faces=1000)

        assert len(proxy.faces) == 32
        assert len(proxy.positions) == 25  # welded 5x5 grid


class TestWriteBinaryPly:
    def test_is_readable_by_read_ply(self, tmp_path: Path) -> None:
        mesh = _grid_mesh(4)
        path = tmp_path / "proxy.ply"

        write_binary_ply(path, mesh)

        back = read_ply(path)
        np.testing.assert_allclose(back.positions, mesh.positions)
        np.testing.assert_array_equal(back.faces, mesh.faces)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_POSITIONS = np.array(
    [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [2, 0, 0], [2, 1, 0]], dtype=np.float32
)
_FACES = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.int64)


def _mesh(*, vertex_rgb: bool) -> PlyMesh:
    return PlyMesh(
        positions=_POSITIONS,
        faces=_FACES,
        vertex_rgb=(
            np.array(
                [[250, 0, 0], [0, 250, 0], [0, 0, 250], [9, 9, 9], [99, 99, 99], [199, 199, 199]],
                dtype=np.uint8,
            )
            if vertex_rgb
            else None
        ),
        face_rgb=np.array([[255, 0, 0], [0, 128, 255]], dtype=np.uint8),
    )


def _grid_mesh(n: int) -> PlyMesh:
    """Non-indexed (triangle soup) n x n grid on the unit square, like supereight output."""
    tris: list[list[float]] = []
    step = 1.0 / n
    for i in range(n):
        for j in range(n):
            a = [i * step, j * step, 0.0]
            b = [(i + 1) * step, j * step, 0.0]
            c = [i * step, (j + 1) * step, 0.0]
            d = [(i + 1) * step, (j + 1) * step, 0.0]
            tris += [a, b, c, b, d, c]
    positions = np.array(tris, dtype=np.float32)
    faces = np.arange(len(positions), dtype=np.int64).reshape(-1, 3)
    return PlyMesh(positions=positions, faces=faces)


def _grid_mesh_with_colours(n: int) -> PlyMesh:
    grid = _grid_mesh(n)
    rgb = (np.abs(grid.positions) * 200).astype(np.uint8)
    return PlyMesh(positions=grid.positions, faces=grid.faces, vertex_rgb=rgb)


def _sample(bake: TextureBake, uv: npt.NDArray[np.floating]) -> npt.NDArray[np.uint8]:
    height, width = bake.image.shape[:2]
    x = min(int(uv[0] * width), width - 1)
    y = min(int((1.0 - uv[1]) * height), height - 1)
    return bake.image[y, x]


def _zip_text(zip_path: Path, name: str) -> list[str]:
    return zipfile.ZipFile(zip_path).read(name).decode().splitlines()


def _read_png(path: Path) -> npt.NDArray[np.uint8]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, width, height = 8, b"", 0, 0
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height = struct.unpack(">II", chunk[:8])
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    raw = np.frombuffer(zlib.decompress(idat), dtype=np.uint8).reshape(height, 1 + width * 3)
    assert np.all(raw[:, 0] == 0)  # filter type 0 on every row
    return raw[:, 1:].reshape(height, width, 3)
