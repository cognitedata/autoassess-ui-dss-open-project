"""Access to the data snapshot the browser loaded before this run (demo fixtures or CDF)."""

from __future__ import annotations

import json
from typing import Any

import _sandbox_bridge  # JS module registered by the sandbox worker


def load() -> dict[str, Any]:
    return json.loads(_sandbox_bridge.snapshot_json())


def vec3(value: Any) -> tuple[float, float, float] | None:
    if value is None:
        return None
    return (float(value[0]), float(value[1]), float(value[2]))
