"""Dependency-free RGB PNG writer (8-bit, no filtering)."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import BinaryIO

import numpy as np
import numpy.typing as npt


def write_png(path: Path, pixels: npt.NDArray[np.uint8], level: int = 6) -> None:
    """Write an (H, W, 3) uint8 array as a PNG."""
    height, width, channels = pixels.shape
    if channels != 3:
        raise ValueError("write_png expects an (H, W, 3) RGB array")
    rows = np.concatenate(
        [np.zeros((height, 1), dtype=np.uint8), pixels.reshape(height, width * 3)], axis=1
    )
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with path.open("wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        _chunk(fh, b"IHDR", ihdr)
        _chunk(fh, b"IDAT", zlib.compress(rows.tobytes(), level))
        _chunk(fh, b"IEND", b"")


def _chunk(fh: BinaryIO, kind: bytes, data: bytes) -> None:
    fh.write(struct.pack(">I", len(data)) + kind + data)
    fh.write(struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
