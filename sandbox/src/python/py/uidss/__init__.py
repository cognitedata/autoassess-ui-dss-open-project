"""uidss — AutoAssess ground station SDK (sandbox build).

Same names and shapes as the real `uidss` package in sdk/, backed by an in-browser snapshot
of CDF (live mode) or bundled demo data (demo mode). Read-only: services that upload to CDF
are absent (AttributeError), and plan status changes are simulated. Code written against this API runs unchanged on a real ground
station with `uv run python your_script.py`.
"""

from uidss.client import SandboxReadOnlyError, UidssClient

__all__ = ["SandboxReadOnlyError", "UidssClient"]
