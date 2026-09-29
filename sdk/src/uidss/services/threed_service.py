"""3D service — turn an uploaded mesh file into a CDF CAD model Reveal can stream.

Every mesh CogniteFile (tag ``ply_mesh``) gets its own model. The OBJ zip and the collision
proxy are uploaded as CogniteFiles, the zip's numeric file id becomes the source of a
classic 3D model revision (CDF processes it into sectors), and Core DM ``CogniteCADModel`` /
``CogniteCADRevision`` nodes with ids derived from the mesh file's external id
(``{file}-cad-model`` / ``{file}-cad-revision``) make the model discoverable from the file.
A campaign shows the models of whatever files its ``cdfFileIds`` lists, so moving a file
between campaigns moves its model with it; nothing is rebuilt.

``CogniteCADModel`` has no property for the classic model id, so it is kept in the tags
(``threeDModelId:<id>``) together with ``collisionProxyFileId:<id>``, ``sourceFileId:<id>``
and ``area:<id>``.

Models built before per-file models existed are keyed by campaign
(``{campaign}-cad-model``); they are still found by ``find_campaign_models`` and shown for
the campaign's files that have no model of their own.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes import ThreeDModelRevisionWrite, ThreeDModelWrite
from cognite.client.data_classes.data_modeling import (
    ContainerId,
    NodeApply,
    NodeId,
    NodeOrEdgeData,
    ViewId,
)
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteCADModelApply

from uidss.cdf.data_model import SPACE
from uidss.models import MeshFile
from uidss.services.cognite_file import upload_cognite_file

log = structlog.get_logger()

RevisionStatus = Literal["Done", "Failed", "Processing", "Queued"]
FINAL_STATUSES = frozenset({"Done", "Failed"})
MAX_EXTERNAL_ID = 255
_CHUNK = 1000
_CAD_MODEL_VIEW = ViewId("cdf_cdm", "CogniteCADModel", "v1")
_CAD_REVISION_VIEW = ViewId("cdf_cdm", "CogniteCADRevision", "v1")
_3D_MODEL_CONTAINER = ContainerId("cdf_cdm_3d", "Cognite3DModel")
_STATUSES: dict[str, RevisionStatus] = {
    "Done": "Done",
    "Failed": "Failed",
    "Processing": "Processing",
    "Queued": "Queued",
}


@dataclass(frozen=True)
class CadModel:
    model_node_id: str
    revision_node_id: str
    model_id: int
    revision_id: int
    status: str
    collision_proxy_file_id: int
    source_file_id: int | None = None  # None for legacy campaign-keyed models
    created_time: int = 0  # of the model node, Unix epoch milliseconds


def covered_by_legacy(mesh: MeshFile, legacy: CadModel | None) -> bool:
    """Whether a campaign's legacy (campaign-keyed) model already shows *mesh*.

    Legacy models merged every mesh the campaign had when they were built, so a mesh
    uploaded before the model counts as covered; one added later needs its own model.
    """
    return legacy is not None and 0 < mesh.created_time <= legacy.created_time


class ThreeDServiceProtocol(Protocol):
    def create_cad_model_for_file(
        self,
        source: MeshFile,
        zip_path: Path,
        proxy_path: Path,
        palette: dict[str, tuple[int, int, int]],
        has_texture: bool,
    ) -> CadModel: ...
    def find_model_for_file(self, file_external_id: str) -> CadModel | None: ...
    def find_models_for_files(self, file_external_ids: Sequence[str]) -> dict[str, CadModel]: ...
    def find_campaign_models(self, campaign_external_ids: Sequence[str]) -> dict[str, CadModel]: ...
    def refresh_status(self, model: CadModel) -> str: ...
    def wait_until_processed(
        self, model: CadModel, timeout_s: float = 1800, poll_s: float = 15
    ) -> str: ...


def derived_id(base: str, suffix: str) -> str:
    """``base + suffix``, with *base* cut so the result fits CDF's 255-character limit.

    The web viewer derives the same ids (``CampaignCadModelService.ts``); keep them in sync.
    """
    return base[: MAX_EXTERNAL_ID - len(suffix)] + suffix


def file_model_node_id(file_external_id: str) -> str:
    return derived_id(file_external_id, "-cad-model")


def file_revision_node_id(file_external_id: str) -> str:
    return derived_id(file_external_id, "-cad-revision")


def campaign_model_node_id(campaign_external_id: str) -> str:
    """Legacy (campaign-keyed) model node id."""
    return f"{campaign_external_id}-cad-model"


def campaign_revision_node_id(campaign_external_id: str) -> str:
    """Legacy (campaign-keyed) revision node id."""
    return f"{campaign_external_id}-cad-revision"


class CdfThreeDService:
    def __init__(
        self,
        client: CogniteClient,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._sleep = sleep
        self._clock = clock

    def create_cad_model_for_file(
        self,
        source: MeshFile,
        zip_path: Path,
        proxy_path: Path,
        palette: dict[str, tuple[int, int, int]],
        has_texture: bool,
    ) -> CadModel:
        """Upload the converted mesh and create the file's model + Core DM nodes."""
        xid = source.external_id
        tags = ["autoassess", f"sourceFileId:{source.file_id}"]
        if source.area_external_id:
            tags.append(f"area:{source.area_external_id}")
        zip_id = upload_cognite_file(
            self._client,
            zip_path,
            derived_id(xid, "-cad-source"),
            "application/zip",
            [*tags, "cad_source"],
        )
        proxy_id = upload_cognite_file(
            self._client,
            proxy_path,
            derived_id(xid, "-collision-proxy"),
            "application/octet-stream",
            [*tags, "collision_proxy"],
        )
        name = f"{source.name} mesh"
        metadata = {"sourceFileId": str(source.file_id), "sourceFileExternalId": xid}
        if source.area_external_id:
            metadata["area"] = source.area_external_id
        model = self._client.three_d.models.create(ThreeDModelWrite(name=name, metadata=metadata))
        revision = self._client.three_d.revisions.create(
            model.id, ThreeDModelRevisionWrite(file_id=zip_id, published=True)
        )
        result = CadModel(
            model_node_id=file_model_node_id(xid),
            revision_node_id=file_revision_node_id(xid),
            model_id=int(model.id),
            revision_id=int(revision.id),
            status=str(revision.status),
            collision_proxy_file_id=proxy_id,
            source_file_id=source.file_id,
        )
        description = {
            "palette": {k: list(v) for k, v in palette.items()},
            "hasTexture": has_texture,
        }
        self._client.data_modeling.instances.apply(
            nodes=[
                CogniteCADModelApply(
                    space=SPACE,
                    external_id=result.model_node_id,
                    name=name,
                    description=json.dumps(description),
                    model_type="CAD",
                    tags=[
                        *tags,
                        f"threeDModelId:{result.model_id}",
                        f"collisionProxyFileId:{proxy_id}",
                    ],
                ),
                self._revision_node(result),
            ]
        )
        log.info("created CAD model", file=xid, model=result.model_id)
        return result

    def find_model_for_file(self, file_external_id: str) -> CadModel | None:
        return self.find_models_for_files([file_external_id]).get(file_external_id)

    def find_models_for_files(self, file_external_ids: Sequence[str]) -> dict[str, CadModel]:
        """Per-file models, keyed by the mesh file's external id (files without one omitted)."""
        return self._find(
            {x: (file_model_node_id(x), file_revision_node_id(x)) for x in file_external_ids}
        )

    def find_campaign_models(self, campaign_external_ids: Sequence[str]) -> dict[str, CadModel]:
        """Legacy campaign-keyed models, keyed by campaign external id."""
        return self._find(
            {
                c: (campaign_model_node_id(c), campaign_revision_node_id(c))
                for c in campaign_external_ids
            }
        )

    def refresh_status(self, model: CadModel) -> str:
        """Check CDF processing once; record a final status (Done/Failed) on the revision node."""
        revision = self._client.three_d.revisions.retrieve(model.model_id, model.revision_id)
        status = str(getattr(revision, "status", ""))
        if status in FINAL_STATUSES and status != model.status:
            self._client.data_modeling.instances.apply(
                nodes=[self._revision_node(model, status=status)]
            )
        return status

    def wait_until_processed(
        self, model: CadModel, timeout_s: float = 1800, poll_s: float = 15
    ) -> str:
        deadline = self._clock() + timeout_s
        while True:
            status = self.refresh_status(model)
            if status == "Failed":
                raise RuntimeError(f"3D processing Failed for revision {model.revision_id}")
            if status == "Done":
                return status
            if self._clock() >= deadline:
                raise TimeoutError(
                    f"3D revision {model.revision_id} still {status} after {timeout_s}s"
                )
            self._sleep(poll_s)

    def _find(self, ids: dict[str, tuple[str, str]]) -> dict[str, CadModel]:
        if not ids:
            return {}
        models = self._retrieve([m for m, _ in ids.values()], _CAD_MODEL_VIEW)
        revisions = self._retrieve([r for _, r in ids.values()], _CAD_REVISION_VIEW)
        found: dict[str, CadModel] = {}
        for key, (model_xid, revision_xid) in ids.items():
            model = models.get(model_xid)
            revision = revisions.get(revision_xid)
            if model is None or revision is None:
                continue
            parsed = _parse(model_xid, revision_xid, model[0], revision[0], model[1])
            if parsed is not None:
                found[key] = parsed
        return found

    def _retrieve(
        self, external_ids: list[str], view: ViewId
    ) -> dict[str, tuple[dict[str, object], int]]:
        """external id -> (the view's properties, node created time) for the nodes found."""
        found: dict[str, tuple[dict[str, object], int]] = {}
        for i in range(0, len(external_ids), _CHUNK):
            response = self._client.data_modeling.instances.retrieve(
                nodes=[NodeId(SPACE, x) for x in external_ids[i : i + _CHUNK]],
                sources=[view],
            )
            for node in response.nodes:
                node_props = getattr(node, "properties", {}) or {}
                created = getattr(node, "created_time", 0)
                found[node.external_id] = (
                    dict(node_props.get(view) or {}),
                    created if isinstance(created, int) else 0,
                )
        return found

    @staticmethod
    def _revision_node(model: CadModel, status: str | None = None) -> NodeApply:
        # Written as raw sources rather than CogniteCADRevisionApply: the CogniteCADRevision
        # view only matches nodes whose cdf_cdm_3d:Cognite3DModel.type is "CAD", and the typed
        # apply does not write that container — the node would be invisible through the view.
        return NodeApply(
            space=SPACE,
            external_id=model.revision_node_id,
            sources=[
                NodeOrEdgeData(
                    source=_CAD_REVISION_VIEW,
                    properties={
                        "status": _STATUSES.get(status or model.status, "Queued"),
                        "published": True,
                        "type": "CAD",
                        "model3D": {"space": SPACE, "externalId": model.model_node_id},
                        "revisionId": model.revision_id,
                    },
                ),
                NodeOrEdgeData(source=_3D_MODEL_CONTAINER, properties={"type": "CAD"}),
            ],
        )


def tag_id(tags: Sequence[object], name: str) -> int | None:
    """Positive integer from a ``<name>:<id>`` tag, or ``None``."""
    prefix = f"{name}:"
    for tag in tags:
        text = str(tag)
        if text.startswith(prefix):
            value = text.removeprefix(prefix)
            return int(value) if value.isdigit() and int(value) > 0 else None
    return None


def _parse(
    model_xid: str,
    revision_xid: str,
    model: dict[str, object],
    revision: dict[str, object],
    created_time: int,
) -> CadModel | None:
    raw_tags = model.get("tags")
    tags = raw_tags if isinstance(raw_tags, list) else []
    model_id = tag_id(tags, "threeDModelId")
    proxy_id = tag_id(tags, "collisionProxyFileId")
    revision_id = revision.get("revisionId")
    if model_id is None or proxy_id is None or not isinstance(revision_id, int):
        return None
    return CadModel(
        model_node_id=model_xid,
        revision_node_id=revision_xid,
        model_id=model_id,
        revision_id=revision_id,
        status=str(revision.get("status") or ""),
        collision_proxy_file_id=proxy_id,
        source_file_id=tag_id(tags, "sourceFileId"),
        created_time=created_time,
    )
