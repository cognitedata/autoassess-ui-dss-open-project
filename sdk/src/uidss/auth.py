"""Build a CogniteClient from UidssSettings."""

from cognite.client import CogniteClient
from cognite.client.config import ClientConfig, global_config
from cognite.client.credentials import OAuthClientCredentials

global_config.disable_pypi_version_check = True

from uidss.config import UidssSettings


def make_cognite_client(settings: UidssSettings | None = None) -> CogniteClient:
    """Return an authenticated CogniteClient.

    Reads credentials from environment / .env when *settings* is not provided.
    Supports both Azure AD (UUID tenant_id) and Cognite-native IDP (org-name tenant_id).
    """
    if settings is None:
        settings = UidssSettings()  # type: ignore

    scopes = [f"{settings.cdf_base_url()}/.default"] if settings.is_azure_ad() else []

    credentials = OAuthClientCredentials(
        token_url=settings.token_url(),
        client_id=settings.client_id,
        client_secret=settings.client_secret.get_secret_value(),
        scopes=scopes,
    )

    config = ClientConfig(
        client_name="uidss-sdk",
        project=settings.project,
        base_url=settings.cdf_base_url(),
        credentials=credentials,
    )

    return CogniteClient(config)
