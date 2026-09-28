"""Tests for building a campaign's CAD model from its PLY file(s)."""

from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np

from uidss.services.threed_service import CampaignCadModel
from uidss.threed.pipeline import build_campaign_cad_model, merge_meshes
from uidss.threed.ply import PlyMesh, read_ply


class StubThreeDService:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def create_cad_model(
        self,
        campaign_external_id: str,
        zip_path: Path,
        proxy_path: Path,
        palette: dict[str, tuple[int, int, int]],
        has_texture: bool,
    ) -> CampaignCadModel:
        self.calls.append(
            {
                "campaign": campaign_external_id,
                "zip_members": sorted(zipfile.ZipFile(zip_path).namelist()),
                "proxy": read_ply(proxy_path),
                "palette": palette,
                "has_texture": has_texture,
            }
        )
        return CampaignCadModel(campaign_external_id, 1, 2, "Queued", 3)

    def wait_until_processed(
        self, model: CampaignCadModel, timeout_s: float = 1800, poll_s: float = 15
    ) -> str:
        return "Done"


class TestBuildCampaignCadModel:
    def test_converts_and_creates_model_for_campaign(self, tmp_path: Path) -> None:
        ply = _write_ascii_ply(tmp_path / "mesh.ply", offset=0.0)
        stub = StubThreeDService()

        result = build_campaign_cad_model([ply], "result-1", stub, tmp_path)

        assert result.model_id == 1
        call = stub.calls[0]
        assert call["campaign"] == "result-1"
        assert call["zip_members"] == ["model.mtl", "model.obj"]
        assert call["palette"] == {"seg_ff0000": (255, 0, 0)}
        assert call["has_texture"] is False

    def test_writes_collision_proxy_readable_as_ply(self, tmp_path: Path) -> None:
        ply = _write_ascii_ply(tmp_path / "mesh.ply", offset=0.0)
        stub = StubThreeDService()

        build_campaign_cad_model([ply], "result-1", stub, tmp_path)

        proxy = stub.calls[0]["proxy"]
        assert isinstance(proxy, PlyMesh)
        assert len(proxy.faces) == 2

    def test_merges_several_ply_files_into_one_model(self, tmp_path: Path) -> None:
        a = _write_ascii_ply(tmp_path / "a.ply", offset=0.0)
        b = _write_ascii_ply(tmp_path / "b.ply", offset=10.0)
        stub = StubThreeDService()

        build_campaign_cad_model([a, b], "result-1", stub, tmp_path)

        proxy = stub.calls[0]["proxy"]
        assert isinstance(proxy, PlyMesh)
        assert len(proxy.faces) == 4


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
