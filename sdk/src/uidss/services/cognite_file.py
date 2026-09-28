"""CogniteFile helpers — every file the SDK uploads is a data-modeling file.

A CogniteFile node (``cdf_cdm:CogniteFile/v1``) is created in the ``autoassess`` space
first, then its content is uploaded by instance id. CDF still assigns the file a numeric
id (always <= 2**53 - 1), which is what the autoassess views store in their int64 lists.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import NodeId
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteFileApply

from uidss.cdf.data_model import SPACE

log = structlog.get_logger()

_CHUNK = 1000  # max nodes per apply call
_MAX_EXTERNAL_ID = 255
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


@dataclass(frozen=True)
class CogniteFileSpec:
    path: Path
    external_id: str
    mime_type: str
    tags: list[str] = field(default_factory=list)


def make_file_external_id(prefix: str, path: Path) -> str:
    """Return a unique external id: ``{prefix}-file-{12 hex}-{sanitised filename}``."""
    head = f"{prefix}-file-{uuid.uuid4().hex[:12]}-"
    name = _UNSAFE.sub("_", path.name)
    room = _MAX_EXTERNAL_ID - len(head)
    if room < 1:
        return head[:_MAX_EXTERNAL_ID]
    return head + name[-room:]


def upload_cognite_file(
    client: CogniteClient,
    path: Path,
    external_id: str,
    mime_type: str,
    tags: list[str],
) -> int:
    """Create one CogniteFile node, upload *path* as its content, return the numeric file id."""
    return upload_cognite_files(client, [CogniteFileSpec(path, external_id, mime_type, tags)])[0]


def upload_cognite_files(client: CogniteClient, specs: Sequence[CogniteFileSpec]) -> list[int]:
    """Create CogniteFile nodes (batched) and upload each file's content.

    Returns the numeric file ids in the same order as *specs*.
    """
    for i in range(0, len(specs), _CHUNK):
        client.data_modeling.instances.apply(
            nodes=[
                CogniteFileApply(
                    space=SPACE,
                    external_id=spec.external_id,
                    name=spec.path.name,
                    mime_type=spec.mime_type,
                    tags=spec.tags,
                )
                for spec in specs[i : i + _CHUNK]
            ]
        )

    file_ids: list[int] = []
    for spec in specs:
        metadata = client.files.upload_content(
            str(spec.path), instance_id=NodeId(SPACE, spec.external_id)
        )
        file_id = getattr(metadata, "id", None)
        if file_id is None:
            raise RuntimeError(f"CogniteFile upload of {spec.path} returned no file id")
        file_ids.append(int(file_id))
        log.debug("uploaded cognite file", external_id=spec.external_id, file_id=file_id)
    return file_ids
