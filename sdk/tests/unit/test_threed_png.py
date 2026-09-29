"""Tests for the PNG reader/writer helpers in uidss.threed.png."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from uidss.threed.png import read_png_size, write_png


class TestReadPngSize:
    def test_roundtrip_with_write_png(self, tmp_path: Path) -> None:
        path = tmp_path / "img.png"
        write_png(path, np.zeros((3, 4, 3), dtype=np.uint8))
        assert read_png_size(path) == (4, 3)

    def test_reads_fixture_image(self) -> None:
        fixture = (
            Path(__file__).parent.parent / "fixtures" / "drone_images" / "rgb" / "frame_0001.png"
        )
        assert read_png_size(fixture) == (1, 1)

    def test_rejects_non_png(self, tmp_path: Path) -> None:
        path = tmp_path / "not.png"
        path.write_bytes(b"definitely not a png, but long enough to read")
        with pytest.raises(ValueError, match="Not a PNG"):
            read_png_size(path)

    def test_rejects_truncated_file(self, tmp_path: Path) -> None:
        path = tmp_path / "trunc.png"
        path.write_bytes(b"\x89PNG\r\n\x1a\n\x00")
        with pytest.raises(ValueError, match="Not a PNG"):
            read_png_size(path)
