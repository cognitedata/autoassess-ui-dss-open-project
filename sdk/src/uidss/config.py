"""Settings loaded from environment variables (or a .env file)."""

import re

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


class UidssSettings(BaseSettings):
    project: str
    cluster: str
    tenant_id: str
    client_id: str
    client_secret: SecretStr

    model_config = SettingsConfigDict(env_prefix="COGNITE_", env_file=".env")

    def is_azure_ad(self) -> bool:
        """Return True when tenant_id is a UUID (Azure AD), False for Cognite-native IDP."""
        return bool(_UUID_RE.match(self.tenant_id))

    def token_url(self) -> str:
        if self.is_azure_ad():
            return f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        return "https://auth.cognite.com/oauth2/token"

    def cdf_base_url(self) -> str:
        return f"https://{self.cluster}.cognitedata.com"
