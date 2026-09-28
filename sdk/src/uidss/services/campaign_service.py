"""Campaign service — create, list, and update InspectionResult nodes; download their files."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

import structlog
from cognite.client import CogniteClient
from cognite.client.data_classes.data_modeling import ViewId
from cognite.client.data_classes.data_modeling.instances import NodeApply, NodeOrEdgeData

from uidss.cdf.data_model import (
    INSPECTION_RESULT_CONTAINER,
    INSPECTION_RESULT_VIEW,
    SPACE,
    container_property,
    view_id,
)
from uidss.models import InspectionResult, ResultStatus
from uidss.services.cognite_file import file_external_ids
from uidss.services.threed_service import CadModel, CdfThreeDService

log = structlog.get_logger()

_List = list  # avoid shadowing by method named `list`
_VALID_STATUSES: frozenset[str] = frozenset({"InProgress", "Complete"})


class CampaignServiceProtocol(Protocol):
    def list(self, area_space: str, area_external_id: str) -> _List[InspectionResult]: ...
    def get(self, space: str, external_id: str) -> InspectionResult | None: ...
    def create(self, area_external_id: str, campaign_date: str) -> str: ...
    def update_file_ids(
        self,
        space: str,
        external_id: str,
        cdf_file_ids: _List[int],
        pcd_file_ids: _List[int],
        pcd_file_labels: _List[str],
    ) -> None: ...
    def complete(self, space: str, external_id: str) -> None: ...
    def download_map(self, space: str, external_id: str, output_dir: Path) -> _List[Path]: ...
    def download_collision_proxies(
        self, campaign_external_id: str, output_dir: Path
    ) -> _List[Path]: ...


class CadModelFinder(Protocol):
    """The part of the 3D service that finds existing models (read-only)."""

    def find_models_for_files(self, file_external_ids: Sequence[str]) -> dict[str, CadModel]: ...
    def find_campaign_models(self, campaign_external_ids: Sequence[str]) -> dict[str, CadModel]: ...


@dataclass
class CdfCampaignService:
    _client: CogniteClient
    _models: CadModelFinder | None = None

    @property
    def models(self) -> CadModelFinder:
        if self._models is None:
            self._models = CdfThreeDService(self._client)
        return self._models

    def list(self, area_space: str, area_external_id: str) -> _List[InspectionResult]:
        response = self._client.data_modeling.instances.list(
            instance_type="node",
            sources=[view_id(INSPECTION_RESULT_VIEW)],
            filter={
                "equals": {
                    "property": container_property(INSPECTION_RESULT_CONTAINER, "area"),
                    "value": {"space": area_space, "externalId": area_external_id},
                }
            },
            limit=1000,
        )
        results = [_map_node(item) for item in response if item.instance_type == "node"]
        results.sort(key=lambda r: r.campaign_date, reverse=True)
        log.debug("listed campaigns", area=area_external_id, count=len(results))
        return results

    def get(self, space: str, external_id: str) -> InspectionResult | None:
        response = self._client.data_modeling.instances.retrieve(
            nodes=[(space, external_id)],
            sources=[view_id(INSPECTION_RESULT_VIEW)],
        )
        if not response.nodes:
            return None
        return _map_node(response.nodes[0])

    def download_map(self, space: str, external_id: str, output_dir: Path) -> _List[Path]:
        """Download every PLY mesh / PCD point-cloud file for a campaign to *output_dir*."""
        campaign = self.get(space, external_id)
        if campaign is None:
            raise ValueError(f"Campaign '{external_id}' not found in CDF")

        output_dir.mkdir(parents=True, exist_ok=True)
        written: _List[Path] = []
        for file_id in (*campaign.cdf_file_ids, *campaign.pcd_file_ids):
            metadata = self._client.files.retrieve(id=file_id)
            if metadata is None or not metadata.name:
                continue
            path = output_dir / metadata.name
            self._client.files.download_to_path(path, id=file_id)
            written.append(path)

        log.info("downloaded campaign map", campaign=external_id, file_count=len(written))
        return written

    def download_collision_proxies(
        self, campaign_external_id: str, output_dir: Path
    ) -> _List[Path]:
        """Download the decimated collision proxies of the campaign's 3D models. Read-only.

        One per mesh file that has its own model, plus the legacy ``{campaign}-cad-model``'s
        proxy when some mesh has no model of its own. Empty when nothing is built yet.
        """
        campaign = self.get(SPACE, campaign_external_id)
        if campaign is None:
            raise ValueError(f"Campaign '{campaign_external_id}' not found in CDF")
        xids = file_external_ids(self._client, campaign.cdf_file_ids)
        models = self.models
        per_file = models.find_models_for_files(list(xids.values()))
        uncovered = any(xids.get(i) not in per_file for i in campaign.cdf_file_ids)
        legacy = (
            models.find_campaign_models([campaign_external_id]).get(campaign_external_id)
            if uncovered
            else None
        )
        chosen = [per_file[x] for x in xids.values() if x in per_file]
        if legacy is not None:
            chosen.append(legacy)

        output_dir.mkdir(parents=True, exist_ok=True)
        paths: _List[Path] = []
        for model in chosen:
            file_id = model.collision_proxy_file_id
            path = output_dir / f"{campaign_external_id}-collision-proxy-{file_id}.ply"
            self._client.files.download_to_path(path, id=file_id)
            paths.append(path)
        log.info("downloaded collision proxies", campaign=campaign_external_id, count=len(paths))
        return paths

    def create(self, area_external_id: str, campaign_date: str) -> str:
        external_id = f"result-{uuid.uuid4()}"
        self._client.data_modeling.instances.apply(
            nodes=[
                NodeApply(
                    space=SPACE,
                    external_id=external_id,
                    sources=[
                        NodeOrEdgeData(
                            source=ViewId(*INSPECTION_RESULT_VIEW),
                            properties={
                                "area": {"space": SPACE, "externalId": area_external_id},
                                "campaignDate": campaign_date,
                                "status": "InProgress",
                                "cdfFileIds": [],
                                "pcdFileIds": [],
                                "pcdFileLabels": [],
                            },
                        )
                    ],
                )
            ]
        )
        log.info(
            "created campaign", external_id=external_id, area=area_external_id, date=campaign_date
        )
        return external_id

    def update_file_ids(
        self,
        space: str,
        external_id: str,
        cdf_file_ids: _List[int],
        pcd_file_ids: _List[int],
        pcd_file_labels: _List[str],
    ) -> None:
        """Overwrite the campaign's file-id arrays with exactly the given values.

        This is a plain upsert on *external_id* — same semantics as `create`/
        `complete`. Callers are responsible for passing the campaign's complete
        desired state (see `cli/main.py`'s `campaign_upload`, which seeds its
        accumulators from the existing campaign before adding newly-uploaded
        ids), not just what was uploaded in the current run.
        """
        self._client.data_modeling.instances.apply(
            nodes=[
                NodeApply(
                    space=space,
                    external_id=external_id,
                    sources=[
                        NodeOrEdgeData(
                            source=ViewId(*INSPECTION_RESULT_VIEW),
                            properties={
                                "cdfFileIds": cdf_file_ids,
                                "pcdFileIds": pcd_file_ids,
                                "pcdFileLabels": pcd_file_labels,
                            },
                        )
                    ],
                )
            ]
        )
        log.info(
            "updated campaign file ids",
            external_id=external_id,
            ply_count=len(cdf_file_ids),
            pcd_count=len(pcd_file_ids),
        )

    def complete(self, space: str, external_id: str) -> None:
        self._client.data_modeling.instances.apply(
            nodes=[
                NodeApply(
                    space=space,
                    external_id=external_id,
                    sources=[
                        NodeOrEdgeData(
                            source=ViewId(*INSPECTION_RESULT_VIEW),
                            properties={"status": "Complete"},
                        )
                    ],
                )
            ]
        )
        log.info("completed campaign", external_id=external_id)


def _map_node(item: object) -> InspectionResult:
    props = getattr(item, "properties", {}) or {}
    view_props = props.get(view_id(INSPECTION_RESULT_VIEW)) or {}
    area_ref = view_props.get("area") or {}
    raw_status = str(view_props.get("status", "InProgress"))
    status = cast(ResultStatus, raw_status if raw_status in _VALID_STATUSES else "InProgress")

    raw_cdf_ids = view_props.get("cdfFileIds") or []
    raw_pcd_ids = view_props.get("pcdFileIds") or []
    raw_pcd_labels = view_props.get("pcdFileLabels") or []

    return InspectionResult(
        space=getattr(item, "space", SPACE),
        external_id=getattr(item, "external_id", ""),
        area_external_id=str(area_ref.get("externalId", "")) if isinstance(area_ref, dict) else "",
        campaign_date=str(view_props.get("campaignDate", "")),
        status=status,
        cdf_file_ids=tuple(int(i) for i in raw_cdf_ids if i is not None),
        pcd_file_ids=tuple(int(i) for i in raw_pcd_ids if i is not None),
        pcd_file_labels=tuple(str(s) for s in raw_pcd_labels if s is not None),
    )
