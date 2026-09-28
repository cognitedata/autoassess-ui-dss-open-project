"""Tests for CdfStructuralElementService and parse_ssg_yaml."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from uidss.cdf.data_model import SPACE
from uidss.services.structural_element_service import (
    _CLASS_TO_ELEMENT_TYPE,
    CdfStructuralElementService,
    _load_class_map,
    parse_ssg_yaml,
)

FIXTURES = Path(__file__).parent.parent / "fixtures"


# ---------------------------------------------------------------------------
# parse_ssg_yaml
# ---------------------------------------------------------------------------


class TestParseSsgYaml:
    def test_parses_fixture_file(self) -> None:
        elements = parse_ssg_yaml(FIXTURES / "ssg.yaml", "area-001")
        assert len(elements) > 0

    def test_external_id_scheme(self) -> None:
        elements = parse_ssg_yaml(FIXTURES / "ssg.yaml", "area-007")
        for elem in elements:
            assert elem.external_id.startswith("area-007-elem-")
            assert elem.area_external_id == "area-007"

    def test_label_equals_1000_times_class_plus_id(self, tmp_path: Path) -> None:
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text("instances:\n  - id: 5\n    class: 2\n    center: [1.0, 2.0, 3.0]\n")
        elements = parse_ssg_yaml(ssg, "area-001")
        assert len(elements) == 1
        assert elements[0].label == 2005
        assert elements[0].external_id == "area-001-elem-2005"

    def test_class_mapping(self, tmp_path: Path) -> None:
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text(
            "instances:\n"
            "  - id: 1\n    class: 1\n    center: [0,0,0]\n"
            "  - id: 1\n    class: 2\n    center: [0,0,0]\n"
            "  - id: 1\n    class: 3\n    center: [0,0,0]\n"
            "  - id: 1\n    class: 4\n    center: [0,0,0]\n"
        )
        elements = parse_ssg_yaml(ssg, "area-001")
        types = {e.element_type for e in elements}
        assert types == {"manhole", "longitudinal", "wall", "compartment"}

    def test_center_coordinates_parsed(self, tmp_path: Path) -> None:
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text("instances:\n  - id: 0\n    class: 2\n    center: [1.5, 2.5, 3.5]\n")
        elem = parse_ssg_yaml(ssg, "area-001")[0]
        assert elem.center_x == pytest.approx(1.5)
        assert elem.center_y == pytest.approx(2.5)
        assert elem.center_z == pytest.approx(3.5)

    def test_empty_instances_returns_empty_list(self, tmp_path: Path) -> None:
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text("instances: []\n")
        assert parse_ssg_yaml(ssg, "area-001") == []

    def test_unknown_class_falls_back_to_longitudinal(self, tmp_path: Path) -> None:
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text("instances:\n  - id: 1\n    class: 99\n    center: [0,0,0]\n")
        elem = parse_ssg_yaml(ssg, "area-001")[0]
        assert elem.element_type == "longitudinal"

    @given(
        class_id=st.integers(min_value=1, max_value=4),
        instance_id=st.integers(min_value=0, max_value=999),
    )
    @settings(max_examples=50)
    def test_label_formula_property(self, class_id: int, instance_id: int) -> None:
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write(
                f"instances:\n  - id: {instance_id}\n    class: {class_id}\n    center: [0,0,0]\n"
            )
            ssg = Path(f.name)
        try:
            elem = parse_ssg_yaml(ssg, "area-001")[0]
            assert elem.label == 1000 * class_id + instance_id
        finally:
            ssg.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# _load_class_map
# ---------------------------------------------------------------------------


class TestLoadClassMap:
    def test_returns_defaults_when_no_file(self, tmp_path: Path) -> None:
        result = _load_class_map(tmp_path / "missing.yaml")
        assert result == _CLASS_TO_ELEMENT_TYPE

    def test_parses_fixture_metadata(self) -> None:
        mock_meta = Path(
            "/home/johan/git/autoassess-uidss/autoassess-uidss/mock-data"
            "/E300L122060007_01581_388_1flight/map-3d/semantics/metadata.yaml"
        )
        if mock_meta.exists():
            result = _load_class_map(mock_meta)
            assert result[1] == "manhole"
            assert result[2] == "longitudinal"
            assert result[3] == "wall"
            assert result[4] == "compartment"

    def test_custom_metadata_overrides_defaults(self, tmp_path: Path) -> None:
        meta = tmp_path / "metadata.yaml"
        meta.write_text("class_ids:\n  - manhole: 1\n  - longitudinal: 2\n")
        result = _load_class_map(meta)
        assert result[1] == "manhole"
        assert result[2] == "longitudinal"


# ---------------------------------------------------------------------------
# CdfStructuralElementService
# ---------------------------------------------------------------------------


class TestCdfStructuralElementService:
    def test_upsert_from_ssg_returns_count(self, tmp_path: Path) -> None:
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text(
            "instances:\n"
            "  - id: 1\n    class: 1\n    center: [0,0,0]\n"
            "  - id: 2\n    class: 2\n    center: [1,1,1]\n"
        )
        client = MagicMock()
        service = CdfStructuralElementService(client)
        count = service.upsert_from_ssg("area-001", ssg)
        assert count == 2
        client.data_modeling.instances.apply.assert_called_once()

    def test_chunks_large_payloads(self, tmp_path: Path) -> None:
        instances = "\n".join(
            f"  - id: {i}\n    class: 2\n    center: [0,0,0]" for i in range(1100)
        )
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text(f"instances:\n{instances}\n")
        client = MagicMock()
        CdfStructuralElementService(client).upsert_from_ssg("area-001", ssg)
        assert client.data_modeling.instances.apply.call_count == 2

    def test_upsert_payload_structure(self, tmp_path: Path) -> None:
        ssg = tmp_path / "ssg.yaml"
        ssg.write_text("instances:\n  - id: 5\n    class: 1\n    center: [1.0, 2.0, 3.0]\n")
        client = MagicMock()
        CdfStructuralElementService(client).upsert_from_ssg("area-007", ssg)
        nodes = client.data_modeling.instances.apply.call_args.kwargs["nodes"]
        assert len(nodes) == 1
        node = nodes[0]
        assert node.external_id == "area-007-elem-1005"
        props = node.sources[0].properties
        assert props["area"] == {"space": SPACE, "externalId": "area-007"}
        assert props["elementType"] == "manhole"
        assert props["label"] == 1005
        assert props["centerX"] == pytest.approx(1.0)
        assert props["centerY"] == pytest.approx(2.0)
        assert props["centerZ"] == pytest.approx(3.0)

    def test_upsert_uses_fixture_ssg_without_error(self) -> None:
        client = MagicMock()
        service = CdfStructuralElementService(client)
        count = service.upsert_from_ssg("area-001", FIXTURES / "ssg.yaml")
        assert count > 0
        assert client.data_modeling.instances.apply.called
