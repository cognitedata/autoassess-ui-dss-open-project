"""Tests for the colour → class-name legend used when converting mission meshes."""

from __future__ import annotations

from pathlib import Path

import pytest

from uidss.threed.legend import (
    classifier_for_mesh,
    default_class_for_colour,
    exact_colour_classifier,
    load_legend,
    normalise_hex_key,
    rgb_to_hex,
    sanitise_class_name,
)


class TestNormaliseHexKey:
    @pytest.mark.parametrize(
        ("key", "expected"),
        [
            ("#ff0000", "ff0000"),
            ("FF0000", "ff0000"),
            ("#00Ff00", "00ff00"),
            ("0080ff", "0080ff"),
        ],
    )
    def test_accepts_hex_with_or_without_hash_case_insensitively(
        self, key: str, expected: str
    ) -> None:
        assert normalise_hex_key(key) == expected

    @pytest.mark.parametrize("key", ["", "#", "ff00", "#ff000000", "red", "gg0000", "#ff 000"])
    def test_rejects_anything_that_is_not_six_hex_digits(self, key: str) -> None:
        assert normalise_hex_key(key) is None


class TestRgbToHex:
    def test_formats_lowercase_six_digit_hex(self) -> None:
        assert rgb_to_hex((255, 0, 0)) == "ff0000"
        assert rgb_to_hex((0, 128, 255)) == "0080ff"


class TestDefaultClassForColour:
    @pytest.mark.parametrize(
        ("rgb", "expected"),
        [
            ((255, 0, 0), "manhole"),  # pure red
            ((230, 40, 30), "manhole"),  # near-pure red
            ((0, 255, 0), "structure"),  # pure green
            ((30, 210, 55), "structure"),  # near-pure green
        ],
    )
    def test_maps_pure_and_near_pure_ntnu_colours(
        self, rgb: tuple[int, int, int], expected: str
    ) -> None:
        assert default_class_for_colour(rgb) == expected

    @pytest.mark.parametrize(
        "rgb",
        [
            (0, 0, 255),  # blue: not in the convention
            (150, 120, 0),  # muddy yellow: no dominant channel
            (255, 255, 0),  # yellow: red and green both high
            (180, 40, 40),  # dark red: below the dominance threshold
            (255, 90, 30),  # orange: green channel too high
            (136, 170, 255),  # the neutral no-colour fallback
        ],
    )
    def test_leaves_ambiguous_or_unknown_colours_unnamed(self, rgb: tuple[int, int, int]) -> None:
        assert default_class_for_colour(rgb) is None


class TestLoadLegend:
    def test_parses_hex_keys_case_insensitively_with_or_without_hash(self, tmp_path: Path) -> None:
        path = tmp_path / "mesh_legend.json"
        path.write_text('{"#FF0000": "manhole", "00ff00": "structure"}')

        assert load_legend(path) == {"ff0000": "manhole", "00ff00": "structure"}

    def test_rejects_invalid_hex_keys(self, tmp_path: Path) -> None:
        path = tmp_path / "mesh_legend.json"
        path.write_text('{"red": "manhole"}')

        with pytest.raises(ValueError, match="red"):
            load_legend(path)

    def test_rejects_non_string_class_names(self, tmp_path: Path) -> None:
        path = tmp_path / "mesh_legend.json"
        path.write_text('{"#ff0000": [255, 0, 0]}')

        with pytest.raises(ValueError, match="class name"):
            load_legend(path)

    def test_rejects_non_object_json(self, tmp_path: Path) -> None:
        path = tmp_path / "mesh_legend.json"
        path.write_text('["#ff0000"]')

        with pytest.raises(ValueError, match="JSON object"):
            load_legend(path)

    def test_rejects_invalid_json(self, tmp_path: Path) -> None:
        path = tmp_path / "mesh_legend.json"
        path.write_text("{not json")

        with pytest.raises(ValueError, match="not valid JSON"):
            load_legend(path)

    def test_rejects_blank_class_names(self, tmp_path: Path) -> None:
        path = tmp_path / "mesh_legend.json"
        path.write_text('{"#ff0000": "  "}')

        with pytest.raises(ValueError, match="class name"):
            load_legend(path)


class TestExactColourClassifier:
    def test_matches_only_the_exact_colours_of_the_legend(self) -> None:
        classify = exact_colour_classifier({"ff0000": "manhole"})

        assert classify((255, 0, 0)) == "manhole"
        assert classify((254, 0, 0)) is None
        assert classify((0, 255, 0)) is None


class TestClassifierForMesh:
    def test_uses_the_legend_file_next_to_the_mesh_when_present(self, tmp_path: Path) -> None:
        (tmp_path / "mesh_legend.json").write_text('{"#0000ff": "railing"}')

        classify = classifier_for_mesh(tmp_path / "mesh.ply")

        assert classify((0, 0, 255)) == "railing"
        # An explicit legend replaces the default NTNU mapping entirely.
        assert classify((255, 0, 0)) is None

    def test_falls_back_to_the_default_ntnu_mapping_without_a_legend_file(
        self, tmp_path: Path
    ) -> None:
        classify = classifier_for_mesh(tmp_path / "mesh.ply")

        assert classify((255, 0, 0)) == "manhole"
        assert classify((0, 255, 0)) == "structure"

    def test_raises_on_an_invalid_legend_file(self, tmp_path: Path) -> None:
        (tmp_path / "mesh_legend.json").write_text("{not json")

        with pytest.raises(ValueError, match=r"mesh_legend\.json"):
            classifier_for_mesh(tmp_path / "mesh.ply")


class TestSanitiseClassName:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("manhole", "manhole"),
            ("Structural Marking", "structural_marking"),
            ("  weld/seam #2  ", "weld_seam_2"),
            ("ütf", "tf"),
        ],
    )
    def test_makes_a_safe_lowercase_obj_group_name(self, name: str, expected: str) -> None:
        assert sanitise_class_name(name) == expected

    @pytest.mark.parametrize("name", ["", "   ", "###"])
    def test_returns_empty_when_nothing_usable_remains(self, name: str) -> None:
        assert sanitise_class_name(name) == ""
