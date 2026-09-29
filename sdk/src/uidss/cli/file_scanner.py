"""Scan a mission output folder for uploadable artifact files."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from uidss.threed.ply import is_point_cloud_ply


@dataclass(frozen=True)
class ScannedFiles:
    ply_files: list[Path]  # triangle-mesh PLYs
    pcd_files: list[Path]
    csv_files: list[Path]
    ssg_yaml: Path | None
    metrics_yaml: Path | None
    tum_dataset: Path | None
    point_cloud_ply_files: list[Path] = field(default_factory=list)  # vertex-only PLYs
    ssg_yaml_candidates: tuple[Path, ...] = ()
    metrics_yaml_candidates: tuple[Path, ...] = ()
    tum_dataset_candidates: tuple[Path, ...] = ()

    @property
    def has_ply(self) -> bool:
        return bool(self.ply_files)

    @property
    def has_pcd(self) -> bool:
        return bool(self.pcd_files)

    @property
    def has_point_cloud_ply(self) -> bool:
        return bool(self.point_cloud_ply_files)

    @property
    def has_csv(self) -> bool:
        return bool(self.csv_files)

    @property
    def has_ssg(self) -> bool:
        return self.ssg_yaml is not None

    @property
    def has_metrics(self) -> bool:
        return self.metrics_yaml is not None

    @property
    def has_tum_dataset(self) -> bool:
        return self.tum_dataset is not None


def _find_tum_dataset_candidates(folder: Path) -> list[Path]:
    """Return sorted directories under *folder* that look like a TUM drone-image dataset.

    A real TUM dataset has rgb.txt, groundtruth.txt, and an rgb/ subdirectory together in
    the same directory — a lone rgb.txt (e.g. from an unrelated tool) does not count.
    """
    candidates = []
    for rgb_txt in folder.rglob("rgb.txt"):
        directory = rgb_txt.parent
        if (directory / "groundtruth.txt").is_file() and (directory / "rgb").is_dir():
            candidates.append(directory)
    return sorted(candidates)


def scan_folder(folder: Path) -> ScannedFiles:
    """Recursively find .ply, .pcd, .csv, ssg.yaml, metrics.yaml and TUM datasets under *folder*.

    ssg.yaml is identified by name; metadata.yaml and calibration yamls are excluded.
    Each .ply is classified by peeking its header: a ``face`` element with count > 0 makes
    it a mesh (``ply_files``), otherwise it is a vertex-only point cloud
    (``point_cloud_ply_files``, uploaded via the PCD path). An unreadable .ply stays in
    ``ply_files`` so the failure surfaces at upload time instead of being dropped.
    When more than one ssg.yaml/metrics.yaml/TUM dataset candidate is found, the sorted-first
    one is used and the rest are surfaced via missing_type_notes() rather than silently dropped.
    """
    ply_files: list[Path] = []
    point_cloud_ply_files: list[Path] = []
    for ply in sorted(folder.rglob("*.ply")):
        try:
            point_cloud = is_point_cloud_ply(ply)
        except (ValueError, OSError):
            point_cloud = False
        (point_cloud_ply_files if point_cloud else ply_files).append(ply)
    pcd_files: list[Path] = sorted(folder.rglob("*.pcd"))
    csv_files: list[Path] = sorted(folder.rglob("*.csv"))
    ssg_candidates = sorted(folder.rglob("ssg.yaml"))
    ssg_yaml = ssg_candidates[0] if ssg_candidates else None
    metrics_candidates = sorted(folder.rglob("metrics.yaml"))
    metrics_yaml = metrics_candidates[0] if metrics_candidates else None
    tum_candidates = _find_tum_dataset_candidates(folder)
    tum_dataset = tum_candidates[0] if tum_candidates else None
    return ScannedFiles(
        ply_files=ply_files,
        pcd_files=pcd_files,
        csv_files=csv_files,
        ssg_yaml=ssg_yaml,
        metrics_yaml=metrics_yaml,
        tum_dataset=tum_dataset,
        point_cloud_ply_files=point_cloud_ply_files,
        ssg_yaml_candidates=tuple(ssg_candidates),
        metrics_yaml_candidates=tuple(metrics_candidates),
        tum_dataset_candidates=tuple(tum_candidates),
    )


def missing_type_notes(scanned: ScannedFiles) -> list[str]:
    """Return human-readable notes for artifact types that were not found, plus warnings
    about ambiguous matches and pointers to artifact types this command doesn't handle."""
    notes: list[str] = []
    if not scanned.has_ply:
        notes.append("No mesh .ply file found — PLY mesh will not be uploaded.")
    if not scanned.has_pcd and not scanned.has_point_cloud_ply:
        notes.append("No .pcd or point-cloud .ply file found — point clouds will not be uploaded.")
    if not scanned.has_csv:
        notes.append("No .csv file found — UTM measurements will not be uploaded.")
    if not scanned.has_ssg:
        notes.append("No ssg.yaml found — structural elements will not be updated.")
    if not scanned.has_metrics:
        notes.append("No metrics.yaml found — campaign metrics will not be uploaded.")
    if len(scanned.ssg_yaml_candidates) > 1:
        others = ", ".join(str(p) for p in scanned.ssg_yaml_candidates[1:])
        notes.append(
            f"Multiple ssg.yaml files found — using {scanned.ssg_yaml}; ignoring {others}."
        )
    if len(scanned.metrics_yaml_candidates) > 1:
        others = ", ".join(str(p) for p in scanned.metrics_yaml_candidates[1:])
        notes.append(
            f"Multiple metrics.yaml files found — using {scanned.metrics_yaml}; ignoring {others}."
        )
    if scanned.has_tum_dataset:
        notes.append(
            f"TUM drone-image dataset found at {scanned.tum_dataset} — run "
            f"'dss campaign upload-drone-images {scanned.tum_dataset}' to upload it "
            "(not handled by this command)."
        )
    return notes
