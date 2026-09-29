"""Tests for building a mesh file's CAD model, and for merging meshes."""

from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np
import pytest

from uidss.models import MeshFile
from uidss.services.threed_service import CadModel
from uidss.threed.pipeline import build_file_cad_model
from uidss.threed.ply import PlyMesh, merge_meshes, read_ply


class StubThreeDService:
    """Records create calls; the lookup methods are never used by the pipeline."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def create_cad_model_for_file(
        self,
        source: MeshFile,
        zip_path: Path,
        proxy_path: Path,
        palette: dict[str, tuple[int, int, int]],
        has_texture: bool,
        legend: dict[str, str] | None = None,
    ) -> CadModel:
        self.calls.append(
            {
                "source": source,
                "zip_members": sorted(zipfile.ZipFile(zip_path).namelist()),
                "proxy": read_ply(proxy_path),
                "palette": palette,
                "has_texture": has_texture,
                "legend": legend,
            }
        )
        return CadModel(f"{source.external_id}-cad-model", "rev", 1, 2, "Queued", 3, source.file_id)


_SOURCE = MeshFile(file_id=11, external_id="area-1-file-abc-mesh.ply", name="mesh.ply")


class TestBuildFileCadModel:
    def test_converts_and_creates_the_model_for_the_file(self, tmp_path: Path) -> None:
        ply = _write_ascii_ply(tmp_path / "mesh.ply", offset=0.0)
        stub = StubThreeDService()

        result = build_file_cad_model(ply, _SOURCE, stub, tmp_path / "work")

        assert result.model_id == 1
        call = stub.calls[0]
        assert call["source"] == _SOURCE
        assert call["zip_members"] == ["model.mtl", "model.obj"]
        # Pure red faces are named by the default NTNU legend.
        assert call["palette"] == {"manhole": (255, 0, 0)}
        assert call["legend"] == {"ff0000": "manhole"}
        assert call["has_texture"] is False

    def test_mesh_legend_json_next_to_the_ply_overrides_the_default_names(
        self, tmp_path: Path
    ) -> None:
        ply = _write_ascii_ply(tmp_path / "mesh.ply", offset=0.0)
        (tmp_path / "mesh_legend.json").write_text('{"#FF0000": "anode"}')
        stub = StubThreeDService()

        build_file_cad_model(ply, _SOURCE, stub, tmp_path / "work")

        call = stub.calls[0]
        assert call["palette"] == {"anode": (255, 0, 0)}
        assert call["legend"] == {"ff0000": "anode"}

    def test_an_invalid_mesh_legend_json_fails_the_build(self, tmp_path: Path) -> None:
        ply = _write_ascii_ply(tmp_path / "mesh.ply", offset=0.0)
        (tmp_path / "mesh_legend.json").write_text("{not json")
        stub = StubThreeDService()

        with pytest.raises(ValueError, match=r"mesh_legend\.json"):
            build_file_cad_model(ply, _SOURCE, stub, tmp_path / "work")

        assert stub.calls == []

    def test_writes_collision_proxy_readable_as_ply(self, tmp_path: Path) -> None:
        ply = _write_ascii_ply(tmp_path / "mesh.ply", offset=0.0)
        stub = StubThreeDService()

        build_file_cad_model(ply, _SOURCE, stub, tmp_path / "work")

        proxy = stub.calls[0]["proxy"]
        assert isinstance(proxy, PlyMesh)
        assert len(proxy.faces) == 2


class TestMergeMeshes:
    def test_offsets_face_indices(self) -> None:
        merged = merge_meshes([_mesh(0.0), _mesh(5.0)])

        assert len(merged.positions) == 6
        np.testing.assert_array_equal(merged.faces, [[0, 1, 2], [3, 4, 5]])

    def test_keeps_vertex_colours_only_when_all_meshes_have_them(self) -> None:
        coloured = PlyMesh(
            positions=_mesh(0.0).positions,
            faces=_mesh(0.0).faces,
            vertex_rgb=np.zeros((3, 3), dtype=np.uint8),
        )

        assert merge_meshes([coloured, coloured]).vertex_rgb is not None
        assert merge_meshes([coloured, _mesh(1.0)]).vertex_rgb is None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mesh(offset: float) -> PlyMesh:
    positions = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32) + offset
    return PlyMesh(positions=positions, faces=np.array([[0, 1, 2]], dtype=np.int64))


def _write_ascii_ply(path: Path, offset: float) -> Path:
    o = offset
    path.write_text(
        "ply\nformat ascii 1.0\nelement vertex 6\n"
        "property float x\nproperty float y\nproperty float z\n"
        "element face 2\nproperty list uchar int vertex_index\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
        f"{o} 0 0\n{o + 1} 0 0\n{o} 1 0\n{o + 1} 1 0\n{o + 2} 0 0\n{o + 2} 1 0\n"
        "3 0 1 2 255 0 0\n3 3 4 5 255 0 0\n"
    )
    return path
