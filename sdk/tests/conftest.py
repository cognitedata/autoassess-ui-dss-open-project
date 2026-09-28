import os

import pytest


@pytest.fixture(autouse=True)
def minimal_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate every test from real credentials present in the shell environment."""
    for key in (
        "COGNITE_PROJECT",
        "COGNITE_CLUSTER",
        "COGNITE_TENANT_ID",
        "COGNITE_CLIENT_ID",
        "COGNITE_CLIENT_SECRET",
    ):
        monkeypatch.setenv(key, "test-value")


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if "integration" in str(item.fspath) and not os.environ.get("INTEGRATION_TESTS"):
            item.add_marker(
                pytest.mark.skip(reason="Set INTEGRATION_TESTS=1 to run integration tests")
            )
