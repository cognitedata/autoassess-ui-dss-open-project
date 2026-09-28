"""Build a campaign's CDF CAD model from its mission PLY file(s)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np

from uidss.services.threed_service import CampaignCadModel, ThreeDServiceProtocol
from uidss.threed.convert import convert_mesh_to_cad_zip
from uidss.threed.decimate import decimate, write_binary_ply
from uidss.threed.ply import PlyMesh, read_ply

PROXY_MAX_FACES = 200_000


def build_campaign_cad_model(
    ply_paths: Sequence[Path],
    campaign_external_id: str,
    threed: ThreeDServiceProtocol,
    work_dir: Path,
    workers: int = 1,
) -> CampaignCadModel:
    """Convert the PLY(s) to an OBJ zip + collision proxy and create the CAD model."""
    mesh = merge_meshes([read_ply(path) for path in ply_paths])
    work_dir.mkdir(parents=True, exist_ok=True)
    conversion = convert_mesh_to_cad_zip(mesh, work_dir / "model.zip", workers=workers)
    proxy_path = work_dir / "collision_proxy.ply"
    write_binary_ply(proxy_path, decimate(mesh, PROXY_MAX_FACES))
    return threed.create_cad_model(
        campaign_external_id=campaign_external_id,
        zip_path=conversion.zip_path,
        proxy_path=proxy_path,
        palette=conversion.palette,
        has_texture=conversion.has_texture,
    )


def merge_meshes(meshes: Sequence[PlyMesh]) -> PlyMesh:
    """Concatenate meshes; colour attributes survive only if every mesh has them."""
    if len(meshes) == 1:
        return meshes[0]
    offsets = np.cumsum([0] + [len(m.positions) for m in meshes[:-1]])
    vertex_rgb = [m.vertex_rgb for m in meshes if m.vertex_rgb is not None]
    face_rgb = [m.face_rgb for m in meshes if m.face_rgb is not None]
    return PlyMesh(
        positions=np.concatenate([m.positions for m in meshes]),
        faces=np.concatenate([m.faces + o for m, o in zip(meshes, offsets, strict=True)]),
        vertex_rgb=np.concatenate(vertex_rgb) if len(vertex_rgb) == len(meshes) else None,
        face_rgb=np.concatenate(face_rgb) if len(face_rgb) == len(meshes) else None,
    )
