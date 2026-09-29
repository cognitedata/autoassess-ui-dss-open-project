"""Artifact service — upload PLY and PCD files to CDF as CogniteFiles, and find meshes."""

from __future__ import annotations

import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes import filters
from cognite.client.data_classes.data_modeling import NodeId, ViewId

from uidss.cdf.data_model import SPACE
from uidss.models import MeshFile
from uidss.services.cognite_file import (
    file_external_ids,
    make_file_external_id,
    upload_cognite_file,
)
from uidss.threed.pcd import convert_ply_pointcloud_to_pcd

log = structlog.get_logger()

_MIME_TYPE = "application/octet-stream"
_FILE_VIEW = ViewId("cdf_cdm", "CogniteFile", "v1")
_CHUNK = 1000
MESH_TAG = "ply_mesh"
POINT_CLOUD_TAG = "pcd_pointcloud"
_List = list  # avoid shadowing by methods named `list_*`


class ArtifactServiceProtocol(Protocol):
    def upload_ply(self, path: Path, area_external_id: str) -> int: ...
    def upload_pcd(self, path: Path, area_external_id: str, label: str) -> int: ...
    def upload_ply_pointcloud(self, path: Path, area_external_id: str, label: str) -> int: ...


class MeshFileServiceProtocol(Protocol):
    def list_mesh_files(self, area_external_id: str | None = None) -> _List[MeshFile]: ...
    def get_mesh_files(self, file_ids: Sequence[int]) -> _List[MeshFile]: ...
    def download(self, mesh: MeshFile, output_dir: Path) -> Path: ...


@dataclass
class CdfArtifactService:
    _client: CogniteClient

    def upload_ply(self, path: Path, area_external_id: str) -> int:
        file_id = upload_cognite_file(
            self._client,
            path,
            make_file_external_id(area_external_id, path),
            _MIME_TYPE,
            ["autoassess", MESH_TAG, f"area:{area_external_id}"],
        )
        log.info("uploaded PLY", path=str(path), file_id=file_id)
        return file_id

    def upload_pcd(self, path: Path, area_external_id: str, label: str) -> int:
        file_id = upload_cognite_file(
            self._client,
            path,
            make_file_external_id(area_external_id, path),
            _MIME_TYPE,
            ["autoassess", POINT_CLOUD_TAG, f"area:{area_external_id}", f"label:{label}"],
        )
        log.info("uploaded PCD", path=str(path), label=label, file_id=file_id)
        return file_id

    def upload_ply_pointcloud(self, path: Path, area_external_id: str, label: str) -> int:
        """Convert a vertex-only PLY (e.g. D6.2's ut_measurements_colored.ply) to a binary
        PCD — colours preserved — and upload it through the point-cloud path, named after
        the source file. The viewer only parses point clouds in PCD form."""
        with tempfile.TemporaryDirectory() as tmp:
            pcd_path = convert_ply_pointcloud_to_pcd(path, Path(tmp) / f"{path.stem}.pcd")
            file_id = self.upload_pcd(pcd_path, area_external_id, label)
        log.info("uploaded PLY point cloud as PCD", path=str(path), file_id=file_id)
        return file_id

    def list_mesh_files(self, area_external_id: str | None = None) -> _List[MeshFile]:
        """Every uploaded mesh CogniteFile (tag ``ply_mesh``), optionally of one area."""
        wanted = [MESH_TAG] if area_external_id is None else [MESH_TAG, f"area:{area_external_id}"]
        nodes = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[_FILE_VIEW],
            space=SPACE,
            filter=filters.And(
                filters.ContainsAll(_FILE_VIEW.as_property_ref("tags"), wanted),
                filters.Equals(_FILE_VIEW.as_property_ref("isUploaded"), True),
            ),
            limit=-1,
        )
        node_list = [n for n in nodes if getattr(n, "instance_type", "node") == "node"]
        if not node_list:
            return []
        numeric = self._numeric_ids([n.external_id for n in node_list])
        return [
            _mesh_file(numeric[n.external_id], n) for n in node_list if n.external_id in numeric
        ]

    def get_mesh_files(self, file_ids: Sequence[int]) -> _List[MeshFile]:
        """The given numeric file ids that are CogniteFiles, as ``MeshFile`` s (in order)."""
        xids = file_external_ids(self._client, file_ids)
        if not xids:
            return []
        nodes: dict[str, object] = {}
        ids = list(xids.values())
        for i in range(0, len(ids), _CHUNK):
            response = self._client.data_modeling.instances.retrieve(
                nodes=[NodeId(SPACE, x) for x in ids[i : i + _CHUNK]], sources=[_FILE_VIEW]
            )
            nodes.update({n.external_id: n for n in response.nodes})
        return [_mesh_file(fid, nodes[x]) for fid, x in xids.items() if x in nodes]

    def download(self, mesh: MeshFile, output_dir: Path) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"{mesh.file_id}-{mesh.name}"
        self._client.files.download_to_path(path, id=mesh.file_id)
        return path

    def _numeric_ids(self, external_ids: Sequence[str]) -> dict[str, int]:
        found: dict[str, int] = {}
        for i in range(0, len(external_ids), _CHUNK):
            metadata = self._client.files.retrieve_multiple(
                instance_ids=[NodeId(SPACE, x) for x in external_ids[i : i + _CHUNK]],
                ignore_unknown_ids=True,
            )
            for item in metadata:
                instance_id = getattr(item, "instance_id", None)
                if item.id is not None and instance_id is not None:
                    found[instance_id.external_id] = int(item.id)
        return found


def _mesh_file(file_id: int, node: object) -> MeshFile:
    external_id = str(getattr(node, "external_id", ""))
    props = getattr(node, "properties", {}) or {}
    view_props = props.get(_FILE_VIEW) or {}
    raw_tags = view_props.get("tags")
    tags = [str(t) for t in raw_tags] if isinstance(raw_tags, list) else []
    area = next((t.removeprefix("area:") for t in tags if t.startswith("area:")), None)
    return MeshFile(
        file_id=file_id,
        external_id=external_id,
        name=str(view_props.get("name") or external_id),
        area_external_id=area or None,
        created_time=int(getattr(node, "created_time", 0) or 0),
    )
