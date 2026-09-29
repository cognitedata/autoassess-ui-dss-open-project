"""Area geometry from the loaded snapshot (bounds = box around the area's structural elements)."""

from __future__ import annotations

from dataclasses import dataclass

from uidss import _snapshot

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class Bounds:
    min: Vec3
    max: Vec3

    def contains(self, point: tuple[float, float, float] | list[float]) -> bool:
        return all(lo <= float(v) <= hi for lo, v, hi in zip(self.min, point, self.max, strict=True))

    @property
    def size(self) -> Vec3:
        return (
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        )


@dataclass(frozen=True)
class ElementInfo:
    external_id: str
    element_type: str
    label: int
    center: Vec3


def area_bounds(area_external_id: str) -> Bounds | None:
    """Geofence the simulator uses for an area, or None if the area has no structural elements."""
    for area in _snapshot.load()["areas"]:
        if area["externalId"] == area_external_id:
            b = area.get("bounds")
            if b is None:
                return None
            lo, hi = _snapshot.vec3(b["min"]), _snapshot.vec3(b["max"])
            assert lo is not None and hi is not None
            return Bounds(min=lo, max=hi)
    raise ValueError(f"Area '{area_external_id}' not found")


def structural_elements(area_external_id: str) -> list[ElementInfo]:
    """Structural elements (manholes, longitudinals, walls, compartments) of an area."""
    out: list[ElementInfo] = []
    for e in _snapshot.load()["elements"]:
        if e["areaExternalId"] == area_external_id:
            center = _snapshot.vec3(e["center"])
            assert center is not None
            out.append(ElementInfo(e["externalId"], e["elementType"], int(e["label"]), center))
    return out
