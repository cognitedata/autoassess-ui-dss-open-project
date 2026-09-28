"""UidssClient — programmatic facade over all SDK services."""

from __future__ import annotations

from dataclasses import dataclass

from cognite.client import CogniteClient

from uidss.auth import make_cognite_client
from uidss.config import UidssSettings
from uidss.services.area_service import CdfAreaService
from uidss.services.artifact_service import CdfArtifactService
from uidss.services.campaign_metric_service import CdfCampaignMetricService
from uidss.services.campaign_service import CdfCampaignService
from uidss.services.drone_image_service import CdfDroneImageService
from uidss.services.ndt_measurement_service import CdfNdtMeasurementService
from uidss.services.plan_service import CdfPlanService
from uidss.services.structural_element_service import CdfStructuralElementService
from uidss.services.threed_service import CdfThreeDService
from uidss.services.vessel_service import CdfVesselService


@dataclass
class UidssClient:
    vessels: CdfVesselService
    areas: CdfAreaService
    plans: CdfPlanService
    campaigns: CdfCampaignService
    artifacts: CdfArtifactService
    structural_elements: CdfStructuralElementService
    measurements: CdfNdtMeasurementService
    campaign_metrics: CdfCampaignMetricService
    drone_images: CdfDroneImageService
    threed: CdfThreeDService

    @classmethod
    def from_env(cls) -> UidssClient:
        """Build a client from environment variables / .env file."""
        settings = UidssSettings()  # type: ignore
        return cls.from_settings(settings)

    @classmethod
    def from_settings(cls, settings: UidssSettings) -> UidssClient:
        client = make_cognite_client(settings)
        return cls.from_cognite_client(client)

    @classmethod
    def from_cognite_client(cls, client: CogniteClient) -> UidssClient:
        return cls(
            vessels=CdfVesselService(client),
            areas=CdfAreaService(client),
            plans=CdfPlanService(client),
            campaigns=CdfCampaignService(client),
            artifacts=CdfArtifactService(client),
            structural_elements=CdfStructuralElementService(client),
            measurements=CdfNdtMeasurementService(client),
            campaign_metrics=CdfCampaignMetricService(client),
            drone_images=CdfDroneImageService(client),
            threed=CdfThreeDService(client),
        )
