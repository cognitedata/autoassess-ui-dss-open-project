"""3D service — turn a campaign's converted mesh into a CDF CAD model Reveal can stream.

Flow: the OBJ zip and the collision proxy are uploaded as CogniteFiles, the zip's numeric
file id becomes the source of a classic 3D model revision (CDF processes it into sectors),
and Core DM ``CogniteCADModel`` / ``CogniteCADRevision`` nodes with deterministic ids
(``{campaign}-cad-model`` / ``{campaign}-cad-revision``) make the model discoverable from
the campaign. ``CogniteCADModel`` has no property for the classic model id, so it is kept
in the tags (``threeDModelId:<id>``) together with ``collisionProxyFileId:<id>``.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes import ThreeDModelRevisionWrite, ThreeDModelWrite
from cognite.client.data_classes.data_modeling import (
    ContainerId,
    NodeApply,
    NodeOrEdgeData,
    ViewId,
)
from cognite.client.data_classes.data_modeling.cdm.v1 import CogniteCADModelApply

from uidss.cdf.data_model import SPACE
from uidss.services.cognite_file import upload_cognite_file

log = structlog.get_logger()

RevisionStatus = Literal["Done", "Failed", "Processing", "Queued"]
_CAD_REVISION_VIEW = ViewId("cdf_cdm", "CogniteCADRevision", "v1")
_3D_MODEL_CONTAINER = ContainerId("cdf_cdm_3d", "Cognite3DModel")
_STATUSES: dict[str, RevisionStatus] = {
    "Done": "Done",
    "Failed": "Failed",
    "Processing": "Processing",
    "Queued": "Queued",
}


@dataclass(frozen=True)
class CampaignCadModel:
    campaign_external_id: str
    model_id: int
    revision_id: int
    status: str
    collision_proxy_file_id: int


class ThreeDServiceProtocol(Protocol):
    def create_cad_model(
        self,
        campaign_external_id: str,
        zip_path: Path,
        proxy_path: Path,
        palette: dict[str, tuple[int, int, int]],
        has_texture: bool,
    ) -> CampaignCadModel: ...
    def wait_until_processed(
        self, model: CampaignCadModel, timeout_s: float = 1800, poll_s: float = 15
    ) -> str: ...


def model_node_id(campaign_external_id: str) -> str:
    return f"{campaign_external_id}-cad-model"


def revision_node_id(campaign_external_id: str) -> str:
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

    def create_cad_model(
        self,
        campaign_external_id: str,
        zip_path: Path,
        proxy_path: Path,
        palette: dict[str, tuple[int, int, int]],
        has_texture: bool,
    ) -> CampaignCadModel:
        tags = ["autoassess", f"campaign:{campaign_external_id}"]
        zip_id = upload_cognite_file(
            self._client,
            zip_path,
            f"{campaign_external_id}-cad-source",
            "application/zip",
            [*tags, "cad_source"],
        )
        proxy_id = upload_cognite_file(
            self._client,
            proxy_path,
            f"{campaign_external_id}-collision-proxy",
            "application/octet-stream",
            [*tags, "collision_proxy"],
        )
        model = self._client.three_d.models.create(
            ThreeDModelWrite(
                name=f"{campaign_external_id} mesh", metadata={"campaign": campaign_external_id}
            )
        )
        revision = self._client.three_d.revisions.create(
            model.id, ThreeDModelRevisionWrite(file_id=zip_id, published=True)
        )
        result = CampaignCadModel(
            campaign_external_id=campaign_external_id,
            model_id=int(model.id),
            revision_id=int(revision.id),
            status=str(revision.status),
            collision_proxy_file_id=proxy_id,
        )
        description = {
            "palette": {k: list(v) for k, v in palette.items()},
            "hasTexture": has_texture,
        }
        self._client.data_modeling.instances.apply(
            nodes=[
                CogniteCADModelApply(
                    space=SPACE,
                    external_id=model_node_id(campaign_external_id),
                    name=f"{campaign_external_id} mesh",
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
        log.info("created CAD model", campaign=campaign_external_id, model=result.model_id)
        return result

    def wait_until_processed(
        self, model: CampaignCadModel, timeout_s: float = 1800, poll_s: float = 15
    ) -> str:
        deadline = self._clock() + timeout_s
        while True:
            revision = self._client.three_d.revisions.retrieve(model.model_id, model.revision_id)
            status = str(getattr(revision, "status", ""))
            if status in ("Done", "Failed"):
                self._client.data_modeling.instances.apply(
                    nodes=[self._revision_node(model, status=status)]
                )
                if status == "Failed":
                    raise RuntimeError(f"3D processing Failed for revision {model.revision_id}")
                return status
            if self._clock() >= deadline:
                raise TimeoutError(
                    f"3D revision {model.revision_id} still {status} after {timeout_s}s"
                )
            self._sleep(poll_s)

    @staticmethod
    def _revision_node(model: CampaignCadModel, status: str | None = None) -> NodeApply:
        # Written as raw sources rather than CogniteCADRevisionApply: the CogniteCADRevision
        # view only matches nodes whose cdf_cdm_3d:Cognite3DModel.type is "CAD", and the typed
        # apply does not write that container — the node would be invisible through the view.
        return NodeApply(
            space=SPACE,
            external_id=revision_node_id(model.campaign_external_id),
            sources=[
                NodeOrEdgeData(
                    source=_CAD_REVISION_VIEW,
                    properties={
                        "status": _STATUSES.get(status or model.status, "Queued"),
                        "published": True,
                        "type": "CAD",
                        "model3D": {
                            "space": SPACE,
                            "externalId": model_node_id(model.campaign_external_id),
                        },
                        "revisionId": model.revision_id,
                    },
                ),
                NodeOrEdgeData(source=_3D_MODEL_CONTAINER, properties={"type": "CAD"}),
            ],
        )
