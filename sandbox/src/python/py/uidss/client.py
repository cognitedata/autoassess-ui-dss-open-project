"""UidssClient — same facade as sdk/src/uidss/client.py, backed by the sandbox snapshot."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from uidss import _snapshot
from uidss.services import (
    SandboxAreaService,
    SandboxPlanService,
    SandboxReadOnlyError,
    SandboxVesselService,
)

__all__ = ["SandboxReadOnlyError", "UidssClient"]

# Services the real SDK has that only write to CDF (or need local files / 3D tooling).
_UNAVAILABLE = {
    "campaigns",
    "artifacts",
    "structural_elements",
    "measurements",
    "campaign_metrics",
    "drone_images",
    "threed",
}


@dataclass
class UidssClient:
    vessels: SandboxVesselService
    areas: SandboxAreaService
    plans: SandboxPlanService

    @classmethod
    def from_env(cls) -> UidssClient:
        """In the sandbox, credentials come from the browser session (or demo data)."""
        return cls.from_snapshot(_snapshot.load())

    @classmethod
    def from_snapshot(cls, data: dict[str, Any]) -> UidssClient:
        return cls(
            vessels=SandboxVesselService(data),
            areas=SandboxAreaService(data),
            plans=SandboxPlanService(data),
        )

    def __getattr__(self, name: str) -> Any:
        if name in _UNAVAILABLE:
            raise SandboxReadOnlyError(
                f"client.{name} is not available in the sandbox (it uploads to CDF or needs "
                "local mission files). Use it on a real ground station."
            )
        raise AttributeError(name)
