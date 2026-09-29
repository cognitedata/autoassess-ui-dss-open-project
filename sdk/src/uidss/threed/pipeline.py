"""Build one mesh file's CDF CAD model from its PLY."""

from __future__ import annotations

from pathlib import Path

from uidss.models import MeshFile
from uidss.services.threed_service import CadModel, ThreeDServiceProtocol
from uidss.threed.convert import convert_mesh_to_cad_zip
from uidss.threed.decimate import decimate, write_binary_ply
from uidss.threed.legend import classifier_for_mesh
from uidss.threed.ply import read_ply

PROXY_MAX_FACES = 200_000


def build_file_cad_model(
    ply_path: Path,
    source: MeshFile,
    threed: ThreeDServiceProtocol,
    work_dir: Path,
    workers: int = 1,
) -> CadModel:
    """Convert the PLY to an OBJ zip + collision proxy and create the file's CAD model.

    Segment class names come from a ``mesh_legend.json`` next to the source PLY when one
    exists, else from the default NTNU colour convention (``uidss.threed.legend``).
    """
    mesh = read_ply(ply_path)
    classify = classifier_for_mesh(ply_path)
    work_dir.mkdir(parents=True, exist_ok=True)
    conversion = convert_mesh_to_cad_zip(
        mesh, work_dir / "model.zip", workers=workers, classify=classify
    )
    proxy_path = work_dir / "collision_proxy.ply"
    write_binary_ply(proxy_path, decimate(mesh, PROXY_MAX_FACES))
    return threed.create_cad_model_for_file(
        source=source,
        zip_path=conversion.zip_path,
        proxy_path=proxy_path,
        palette=conversion.palette,
        has_texture=conversion.has_texture,
        legend=conversion.legend,
    )
