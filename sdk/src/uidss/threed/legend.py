"""Colour → class-name legend for mission-mesh segments.

Mission PLYs encode semantic classes in their per-face RGB. A legend maps those colours to
human-readable class names so the CAD segments (and the web viewer's Defects legend) can say
"manhole" instead of ``seg_ff0000``.

Two sources, in order of precedence:

1. An optional ``mesh_legend.json`` next to the source PLY:
   ``{"#ff0000": "manhole", "00ff00": "structure"}`` — keys are 6-digit hex colours
   (case-insensitive, ``#`` optional), values are class names. When the file exists it
   replaces the default mapping entirely and matches colours exactly.
2. :data:`DEFAULT_LEGEND` — the built-in NTNU convention (see its docstring) — used when no
   legend file exists, with a conservative tolerance for near-pure colours.

A colour neither source names keeps its anonymous ``seg_<rgb>`` segment name.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path

ColourClassifier = Callable[[tuple[int, int, int]], "str | None"]
"""Maps a segment colour to its class name, or ``None`` to keep the anonymous name."""

MESH_LEGEND_FILENAME = "mesh_legend.json"

DEFAULT_LEGEND: dict[str, str] = {
    "ff0000": "manhole",
    "00ff00": "structure",
}
"""Built-in colour → class table mirroring the NTNU stack's mesh-annotation convention
(pure red = manhole, pure green = structural marking). It is overridden entirely by a
``mesh_legend.json`` next to the mesh. Entries must use pure 0/255 channels; matching
tolerates near-pure colours (see :func:`default_class_for_colour`)."""

# Channel-dominance thresholds for matching DEFAULT_LEGEND: a 255 target channel must be at
# least _NEAR_FULL and a 0 target channel at most _NEAR_ZERO. Conservative on purpose — an
# ambiguous colour stays unnamed rather than being mislabelled.
_NEAR_FULL = 200
_NEAR_ZERO = 60

_HEX_KEY = re.compile(r"^#?([0-9a-f]{6})$")


def normalise_hex_key(key: str) -> str | None:
    """``"#FF0000"`` → ``"ff0000"``; ``None`` when *key* is not a 6-digit hex colour."""
    match = _HEX_KEY.match(key.strip().lower())
    return match.group(1) if match else None


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return f"{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"


def load_legend(path: Path) -> dict[str, str]:
    """Parse a ``mesh_legend.json`` into normalised hex → class name.

    Raises ``ValueError`` on invalid JSON, non-hex keys or non-string/blank class names.
    """
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        raise ValueError(f"{path.name} is not valid JSON: {error}") from error
    if not isinstance(raw, dict):
        raise ValueError(f"{path.name} must be a JSON object of hex colour → class name")
    legend: dict[str, str] = {}
    for key, value in raw.items():
        hex_key = normalise_hex_key(str(key))
        if hex_key is None:
            raise ValueError(f"{path.name}: key {key!r} is not a 6-digit hex colour")
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{path.name}: class name for {key!r} must be a non-empty string")
        legend[hex_key] = value.strip()
    return legend


def exact_colour_classifier(legend: dict[str, str]) -> ColourClassifier:
    """Classifier that matches segment colours exactly against a loaded legend."""

    def classify(rgb: tuple[int, int, int]) -> str | None:
        return legend.get(rgb_to_hex(rgb))

    return classify


def default_class_for_colour(rgb: tuple[int, int, int]) -> str | None:
    """Class name from :data:`DEFAULT_LEGEND`, tolerating near-pure colours.

    A colour matches an entry when every 255 channel of the entry is ≥ 200 and every
    0 channel is ≤ 60; it must match exactly one entry to be named.
    """
    matches = [
        name for target_hex, name in DEFAULT_LEGEND.items() if _near(rgb, _hex_to_rgb(target_hex))
    ]
    return matches[0] if len(matches) == 1 else None


def classifier_for_mesh(mesh_path: Path) -> ColourClassifier:
    """The classifier for a mesh: its ``mesh_legend.json`` if present, else the default.

    Raises ``ValueError`` when a legend file exists but is invalid, so a build fails loudly
    instead of silently dropping the operator's names.
    """
    legend_path = mesh_path.parent / MESH_LEGEND_FILENAME
    if legend_path.exists():
        return exact_colour_classifier(load_legend(legend_path))
    return default_class_for_colour


def sanitise_class_name(name: str) -> str:
    """Class name → safe lowercase OBJ group stem (``""`` when nothing usable remains)."""
    return re.sub(r"[^0-9a-z_-]+", "_", name.strip().lower()).strip("_")


def _hex_to_rgb(hex_colour: str) -> tuple[int, int, int]:
    return (int(hex_colour[0:2], 16), int(hex_colour[2:4], 16), int(hex_colour[4:6], 16))


def _near(rgb: tuple[int, int, int], target: tuple[int, int, int]) -> bool:
    return all(
        value >= _NEAR_FULL if wanted == 255 else value <= _NEAR_ZERO
        for value, wanted in zip(rgb, target, strict=True)
    )
