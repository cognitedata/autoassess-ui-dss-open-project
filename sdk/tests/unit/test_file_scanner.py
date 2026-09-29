"""Tests for cli/file_scanner.py."""

from __future__ import annotations

from pathlib import Path

from uidss.cli.file_scanner import ScannedFiles, missing_type_notes, scan_folder


def _populate(folder: Path, files: list[str]) -> None:
    for name in files:
        p = folder / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"")


class TestScanFolder:
    def test_empty_folder(self, tmp_path: Path) -> None:
        result = scan_folder(tmp_path)
        assert result.ply_files == []
        assert result.pcd_files == []
        assert result.csv_files == []
        assert result.ssg_yaml is None
        assert result.metrics_yaml is None

    def test_finds_ply_files(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["map-3d/mesh.ply", "extra/other.ply"])
        result = scan_folder(tmp_path)
        assert len(result.ply_files) == 2
        assert all(p.suffix == ".ply" for p in result.ply_files)

    def test_finds_pcd_files(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["map-3d/cloud.pcd", "map-3d/semantics/labeled.pcd"])
        result = scan_folder(tmp_path)
        assert len(result.pcd_files) == 2

    def test_finds_ssg_yaml(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["map-3d/semantics/ssg.yaml"])
        result = scan_folder(tmp_path)
        assert result.ssg_yaml is not None
        assert result.ssg_yaml.name == "ssg.yaml"

    def test_multiple_ssg_yaml_picks_sorted_first_deterministically(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["b/ssg.yaml", "a/ssg.yaml"])
        result = scan_folder(tmp_path)
        assert result.ssg_yaml == tmp_path / "a" / "ssg.yaml"

    def test_multiple_metrics_yaml_picks_sorted_first_deterministically(
        self, tmp_path: Path
    ) -> None:
        _populate(tmp_path, ["b/metrics.yaml", "a/metrics.yaml"])
        result = scan_folder(tmp_path)
        assert result.metrics_yaml == tmp_path / "a" / "metrics.yaml"

    def test_ignores_metadata_yaml(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["map-3d/semantics/metadata.yaml"])
        result = scan_folder(tmp_path)
        assert result.ssg_yaml is None

    def test_ignores_calibration_yaml(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["calibration/okvis2.yaml"])
        result = scan_folder(tmp_path)
        assert result.ssg_yaml is None

    def test_finds_csv_files(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["measurements/ut_global_registered.csv"])
        result = scan_folder(tmp_path)
        assert len(result.csv_files) == 1
        assert result.csv_files[0].suffix == ".csv"

    def test_full_mission_folder(self, tmp_path: Path) -> None:
        _populate(
            tmp_path,
            [
                "map-3d/mesh_984.ply",
                "map-3d/mesh_984.pcd",
                "map-3d/semantics/labeled_cloud.pcd",
                "map-3d/semantics/ssg.yaml",
                "map-3d/semantics/metadata.yaml",
                "calibration/okvis2.yaml",
                "measurements/ut_global_registered.csv",
            ],
        )
        result = scan_folder(tmp_path)
        assert len(result.ply_files) == 1
        assert len(result.pcd_files) == 2
        assert len(result.csv_files) == 1
        assert result.ssg_yaml is not None

    def test_finds_metrics_yaml(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["metrics.yaml"])
        result = scan_folder(tmp_path)
        assert result.metrics_yaml is not None
        assert result.metrics_yaml.name == "metrics.yaml"

    def test_has_properties(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["mesh.ply", "cloud.pcd", "data.csv", "ssg.yaml", "metrics.yaml"])
        result = scan_folder(tmp_path)
        assert result.has_ply
        assert result.has_pcd
        assert result.has_csv
        assert result.has_ssg
        assert result.has_metrics

    def test_finds_tum_dataset(self, tmp_path: Path) -> None:
        _populate(
            tmp_path,
            [
                "tum_dataset/rgb.txt",
                "tum_dataset/groundtruth.txt",
                "tum_dataset/rgb/frame_0001.png",
            ],
        )
        result = scan_folder(tmp_path)
        assert result.has_tum_dataset
        assert result.tum_dataset == tmp_path / "tum_dataset"

    def test_stray_rgb_txt_alone_is_not_a_tum_dataset(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["notes/rgb.txt"])
        result = scan_folder(tmp_path)
        assert not result.has_tum_dataset
        assert result.tum_dataset is None

    def test_rgb_txt_and_groundtruth_without_rgb_dir_is_not_a_tum_dataset(
        self, tmp_path: Path
    ) -> None:
        _populate(tmp_path, ["partial/rgb.txt", "partial/groundtruth.txt"])
        result = scan_folder(tmp_path)
        assert not result.has_tum_dataset

    def test_mission_folder_with_nested_tum_dataset_finds_both(self, tmp_path: Path) -> None:
        _populate(
            tmp_path,
            [
                "map-3d/mesh.ply",
                "measurements/ut_global_registered.csv",
                "tum_dataset/rgb.txt",
                "tum_dataset/groundtruth.txt",
                "tum_dataset/rgb/frame_0001.png",
            ],
        )
        result = scan_folder(tmp_path)
        assert len(result.ply_files) == 1
        assert len(result.csv_files) == 1
        assert result.has_tum_dataset

    def test_multiple_tum_datasets_picks_sorted_first_deterministically(
        self, tmp_path: Path
    ) -> None:
        _populate(
            tmp_path,
            [
                "b/rgb.txt",
                "b/groundtruth.txt",
                "b/rgb/frame_0001.png",
                "a/rgb.txt",
                "a/groundtruth.txt",
                "a/rgb/frame_0001.png",
            ],
        )
        result = scan_folder(tmp_path)
        assert result.tum_dataset == tmp_path / "a"


class TestMissingTypeNotes:
    def test_no_notes_when_all_present(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["mesh.ply", "cloud.pcd", "data.csv", "ssg.yaml", "metrics.yaml"])
        result = scan_folder(tmp_path)
        assert missing_type_notes(result) == []

    def test_note_when_no_ply(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["cloud.pcd", "ssg.yaml"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("ply" in n.lower() for n in notes)

    def test_note_when_no_pcd(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["mesh.ply", "ssg.yaml"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("pcd" in n.lower() for n in notes)

    def test_note_when_no_ssg(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["mesh.ply", "cloud.pcd"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("ssg" in n.lower() for n in notes)

    def test_note_when_no_csv(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["mesh.ply", "cloud.pcd", "ssg.yaml"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("csv" in n.lower() for n in notes)

    def test_note_when_no_metrics(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["mesh.ply", "cloud.pcd", "data.csv", "ssg.yaml"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("metrics" in n.lower() for n in notes)

    def test_all_five_missing(self) -> None:
        empty = ScannedFiles(
            ply_files=[],
            pcd_files=[],
            csv_files=[],
            ssg_yaml=None,
            metrics_yaml=None,
            tum_dataset=None,
        )
        notes = missing_type_notes(empty)
        assert len(notes) == 5

    def test_note_when_tum_dataset_found(self, tmp_path: Path) -> None:
        _populate(
            tmp_path,
            ["tum_dataset/rgb.txt", "tum_dataset/groundtruth.txt", "tum_dataset/rgb/frame.png"],
        )
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("tum" in n.lower() and "upload-drone-images" in n for n in notes)

    def test_no_tum_note_when_absent(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["mesh.ply", "cloud.pcd", "data.csv", "ssg.yaml", "metrics.yaml"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert not any("tum" in n.lower() for n in notes)

    def test_note_when_multiple_ssg_yaml_found(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["b/ssg.yaml", "a/ssg.yaml"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("multiple" in n.lower() and "ssg.yaml" in n for n in notes)

    def test_note_when_multiple_metrics_yaml_found(self, tmp_path: Path) -> None:
        _populate(tmp_path, ["b/metrics.yaml", "a/metrics.yaml"])
        notes = missing_type_notes(scan_folder(tmp_path))
        assert any("multiple" in n.lower() and "metrics.yaml" in n for n in notes)


MESH_PLY = (
    b"ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\n"
    b"property float z\nelement face 1\nproperty list uchar int vertex_index\nend_header\n"
    b"0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n"
)
POINT_CLOUD_PLY = (
    b"ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\n"
    b"property float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n"
    b"end_header\n0 0 0 255 0 0\n1 1 1 0 255 0\n"
)


class TestPlyClassification:
    def test_mesh_ply_is_listed_as_mesh(self, tmp_path: Path) -> None:
        (tmp_path / "mesh.ply").write_bytes(MESH_PLY)

        result = scan_folder(tmp_path)

        assert result.ply_files == [tmp_path / "mesh.ply"]
        assert result.point_cloud_ply_files == []

    def test_vertex_only_ply_is_listed_as_point_cloud(self, tmp_path: Path) -> None:
        (tmp_path / "ut_measurements_colored.ply").write_bytes(POINT_CLOUD_PLY)

        result = scan_folder(tmp_path)

        assert result.ply_files == []
        assert result.point_cloud_ply_files == [tmp_path / "ut_measurements_colored.ply"]
        assert result.has_point_cloud_ply

    def test_mixed_folder_splits_mesh_and_point_cloud_plys(self, tmp_path: Path) -> None:
        (tmp_path / "mesh.ply").write_bytes(MESH_PLY)
        (tmp_path / "cloud.ply").write_bytes(POINT_CLOUD_PLY)

        result = scan_folder(tmp_path)

        assert result.ply_files == [tmp_path / "mesh.ply"]
        assert result.point_cloud_ply_files == [tmp_path / "cloud.ply"]

    def test_unreadable_ply_is_kept_as_mesh(self, tmp_path: Path) -> None:
        # Legacy behaviour: an invalid/empty .ply stays in the mesh list so the
        # failure surfaces at upload/conversion time instead of being dropped.
        _populate(tmp_path, ["broken.ply"])

        result = scan_folder(tmp_path)

        assert result.ply_files == [tmp_path / "broken.ply"]
        assert result.point_cloud_ply_files == []


class TestPointCloudPlyNotes:
    def test_no_mesh_note_still_fires_with_only_a_point_cloud_ply(self, tmp_path: Path) -> None:
        (tmp_path / "cloud.ply").write_bytes(POINT_CLOUD_PLY)

        notes = missing_type_notes(scan_folder(tmp_path))

        assert any("mesh" in n.lower() and ".ply" in n for n in notes)

    def test_no_pcd_note_does_not_fire_when_a_point_cloud_ply_exists(self, tmp_path: Path) -> None:
        (tmp_path / "cloud.ply").write_bytes(POINT_CLOUD_PLY)

        notes = missing_type_notes(scan_folder(tmp_path))

        assert not any("point clouds will not be uploaded" in n for n in notes)

    def test_no_pcd_note_fires_when_only_a_mesh_ply_exists(self, tmp_path: Path) -> None:
        (tmp_path / "mesh.ply").write_bytes(MESH_PLY)

        notes = missing_type_notes(scan_folder(tmp_path))

        assert any("point clouds will not be uploaded" in n for n in notes)
