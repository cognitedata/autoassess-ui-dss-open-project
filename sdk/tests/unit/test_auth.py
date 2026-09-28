import pytest
from hypothesis import given
from hypothesis import strategies as st

from uidss.config import UidssSettings


def make_settings(**overrides: str) -> UidssSettings:
    base = {
        "project": "test-project",
        "cluster": "westeurope-1",
        "tenant_id": "test-org",
        "client_id": "test-client-id",
        "client_secret": "test-secret",
    }
    return UidssSettings.model_validate({**base, **overrides})


class TestIsAzureAd:
    @pytest.mark.parametrize(
        ("tenant_id", "expected"),
        [
            ("cog-autoassess", False),
            ("my-org", False),
            ("550e8400-e29b-41d4-a716-446655440000", True),
            ("550E8400-E29B-41D4-A716-446655440000", True),  # uppercase
        ],
    )
    def test_uuid_detection(self, tenant_id: str, expected: bool) -> None:
        settings = make_settings(tenant_id=tenant_id)
        assert settings.is_azure_ad() == expected

    @given(st.uuids().map(str))
    def test_any_uuid_is_azure_ad(self, uuid_str: str) -> None:
        settings = make_settings(tenant_id=uuid_str)
        assert settings.is_azure_ad() is True


class TestTokenUrl:
    def test_azure_ad_url_contains_tenant(self) -> None:
        tid = "550e8400-e29b-41d4-a716-446655440000"
        settings = make_settings(tenant_id=tid)
        assert tid in settings.token_url()
        assert "microsoftonline" in settings.token_url()

    def test_cognite_native_url(self) -> None:
        settings = make_settings(tenant_id="cog-autoassess")
        assert settings.token_url() == "https://auth.cognite.com/oauth2/token"


class TestCdfBaseUrl:
    def test_cluster_in_base_url(self) -> None:
        settings = make_settings(cluster="westeurope-1")
        assert "westeurope-1" in settings.cdf_base_url()
