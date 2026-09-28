"""Artifact service — upload PLY and PCD files to CDF Files API."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import structlog
from cognite.client import CogniteClient

log = structlog.get_logger()


class ArtifactServiceProtocol(Protocol):
    def upload_ply(self, path: Path, area_external_id: str) -> int: ...
    def upload_pcd(self, path: Path, area_external_id: str, label: str) -> int: ...


@dataclass
class CdfArtifactService:
    _client: CogniteClient

    def upload_ply(self, path: Path, area_external_id: str) -> int:
        result = self._client.files.upload(
            str(path),
            name=path.name,
            mime_type="application/octet-stream",
            metadata={"area": area_external_id, "fileType": "ply_mesh"},
            overwrite=True,
        )
        file_id = _extract_file_id(result)
        log.info("uploaded PLY", path=str(path), file_id=file_id)
        return file_id

    def upload_pcd(self, path: Path, area_external_id: str, label: str) -> int:
        result = self._client.files.upload(
            str(path),
            name=path.name,
            mime_type="application/octet-stream",
            metadata={"area": area_external_id, "fileType": "pcd_pointcloud", "label": label},
            overwrite=True,
        )
        file_id = _extract_file_id(result)
        log.info("uploaded PCD", path=str(path), label=label, file_id=file_id)
        return file_id


def _extract_file_id(result: object) -> int:
    file_id = getattr(result, "id", None)
    if file_id is None:
        raise RuntimeError(f"CDF Files upload returned no id: {result!r}")
    return int(file_id)
