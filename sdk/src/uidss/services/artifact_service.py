"""Artifact service — upload PLY and PCD files to CDF as CogniteFiles."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import structlog
from cognite.client import CogniteClient

from uidss.services.cognite_file import make_file_external_id, upload_cognite_file

log = structlog.get_logger()

_MIME_TYPE = "application/octet-stream"


class ArtifactServiceProtocol(Protocol):
    def upload_ply(self, path: Path, area_external_id: str) -> int: ...
    def upload_pcd(self, path: Path, area_external_id: str, label: str) -> int: ...


@dataclass
class CdfArtifactService:
    _client: CogniteClient

    def upload_ply(self, path: Path, area_external_id: str) -> int:
        file_id = upload_cognite_file(
            self._client,
            path,
            make_file_external_id(area_external_id, path),
            _MIME_TYPE,
            ["autoassess", "ply_mesh", f"area:{area_external_id}"],
        )
        log.info("uploaded PLY", path=str(path), file_id=file_id)
        return file_id

    def upload_pcd(self, path: Path, area_external_id: str, label: str) -> int:
        file_id = upload_cognite_file(
            self._client,
            path,
            make_file_external_id(area_external_id, path),
            _MIME_TYPE,
            ["autoassess", "pcd_pointcloud", f"area:{area_external_id}", f"label:{label}"],
        )
        log.info("uploaded PCD", path=str(path), label=label, file_id=file_id)
        return file_id
