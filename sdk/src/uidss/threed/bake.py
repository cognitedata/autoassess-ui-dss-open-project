"""Bake per-vertex camera colours into a texture atlas.

CDF's 3D pipeline (and therefore Reveal) has no per-vertex colours, but it supports a
diffuse texture. The mesh is welded (camera colours averaged where corners coincide),
unwrapped into contiguous charts with xatlas, and every triangle is rasterised into the
atlas with barycentric colour interpolation. Contiguous charts keep mipmaps meaningful
(neighbouring texels are neighbouring surface), and a few dilation passes fill the chart
padding so filtering never pulls in background.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import xatlas

from uidss.threed.ply import PlyMesh

_PADDING = 2
_TARGET_UTILISATION = 0.8
_MAX_ATTEMPTS = 6
_CANDIDATES_PER_CHUNK = 4_000_000
_TIERS = (2, 4, 8, 16, 32, 64, 128, 256)


@dataclass(frozen=True)
class TextureBake:
    image: npt.NDArray[np.uint8]  # (H, W, 3)
    uvs: npt.NDArray[np.float32]  # (F, 3, 2) per-corner UVs, OBJ convention (v up)


def bake_vertex_colours(mesh: PlyMesh, max_size: int = 4096) -> TextureBake:
    if mesh.vertex_rgb is None:
        raise ValueError("mesh has no vertex colours to bake")
    welded, welded_rgb = _weld_with_colours(mesh)
    vmapping, indices, uvs, width, height = _unwrap(welded, max_size)
    if len(indices) != len(mesh.faces):
        raise RuntimeError("xatlas changed the face count; cannot map UVs back to faces")

    corner_uv = uvs[indices]  # (F, 3, 2), image convention (v down), normalised
    corner_rgb = welded_rgb[vmapping[indices]]  # (F, 3, 3)
    image, covered = _rasterise(corner_uv * np.array([width, height]), corner_rgb, width, height)
    _dilate(image, covered, passes=_PADDING + 2)

    obj_uvs = corner_uv.copy()
    obj_uvs[..., 1] = 1.0 - obj_uvs[..., 1]
    return TextureBake(image=image, uvs=obj_uvs.astype(np.float32))


def _weld_with_colours(mesh: PlyMesh) -> tuple[PlyMesh, npt.NDArray[np.float32]]:
    assert mesh.vertex_rgb is not None  # checked by the caller
    positions, inverse = np.unique(mesh.positions, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    sums = np.zeros((len(positions), 3), dtype=np.float64)
    np.add.at(sums, inverse, mesh.vertex_rgb.astype(np.float64))
    counts = np.bincount(inverse, minlength=len(positions))[:, None]
    welded = PlyMesh(positions=positions.astype(np.float32), faces=inverse[mesh.faces])
    return welded, (sums / counts).astype(np.float32)


def _unwrap(
    mesh: PlyMesh, max_size: int
) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.int64], npt.NDArray[np.float64], int, int]:
    tri = mesh.positions[mesh.faces].astype(np.float64)
    area = (
        0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1).sum()
    )
    texels_per_unit = float(np.sqrt(_TARGET_UTILISATION * max_size**2 / max(area, 1e-12)))
    for _ in range(_MAX_ATTEMPTS):
        atlas = xatlas.Atlas()
        atlas.add_mesh(mesh.positions, mesh.faces.astype(np.uint32))
        pack = xatlas.PackOptions()
        pack.padding = _PADDING
        pack.bilinear = True
        pack.resolution = 0
        pack.texels_per_unit = texels_per_unit
        atlas.generate(xatlas.ChartOptions(), pack)
        width, height = int(atlas.width), int(atlas.height)
        if atlas.atlas_count == 1 and max(width, height) <= max_size:
            vmapping, indices, uvs = atlas.get_mesh(0)
            return (
                vmapping.astype(np.int64),
                indices.astype(np.int64),
                uvs.astype(np.float64),
                width,
                height,
            )
        texels_per_unit *= 0.97 * max_size / max(width, height)
    raise RuntimeError(f"could not fit the mesh into one {max_size}px atlas")


def _rasterise(
    tri_px: npt.NDArray[np.float64],
    tri_rgb: npt.NDArray[np.float32],
    width: int,
    height: int,
) -> tuple[npt.NDArray[np.uint8], npt.NDArray[np.bool_]]:
    image = np.zeros((height, width, 3), dtype=np.uint8)
    covered = np.zeros((height, width), dtype=bool)
    lo = np.floor(tri_px.min(axis=1)).astype(np.int64)  # (F, 2)
    hi = np.ceil(tri_px.max(axis=1)).astype(np.int64)
    extent = (hi - lo).max(axis=1) + 1
    remaining = np.ones(len(tri_px), dtype=bool)
    for size in (*_TIERS, int(extent.max()) if len(extent) else 1):
        chosen = np.flatnonzero(remaining & (extent <= size))
        remaining[chosen] = False
        chunk = max(1, _CANDIDATES_PER_CHUNK // (size * size))
        for start in range(0, len(chosen), chunk):
            idx = chosen[start : start + chunk]
            _fill(image, covered, tri_px[idx], tri_rgb[idx], lo[idx], size)
    return image, covered


def _fill(
    image: npt.NDArray[np.uint8],
    covered: npt.NDArray[np.bool_],
    tri: npt.NDArray[np.float64],
    rgb: npt.NDArray[np.float32],
    origin: npt.NDArray[np.int64],
    size: int,
) -> None:
    offsets = np.stack(np.meshgrid(np.arange(size), np.arange(size), indexing="xy"), axis=-1)
    pixels = origin[:, None, None, :] + offsets[None]  # (n, s, s, 2) integer x, y
    centre = pixels + 0.5
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    v0, v1 = b - a, c - a
    v2 = centre - a[:, None, None, :]
    d00 = (v0 * v0).sum(-1)[:, None, None]
    d01 = (v0 * v1).sum(-1)[:, None, None]
    d11 = (v1 * v1).sum(-1)[:, None, None]
    d20 = (v2 * v0[:, None, None, :]).sum(-1)
    d21 = (v2 * v1[:, None, None, :]).sum(-1)
    denom = d00 * d11 - d01 * d01
    valid = np.abs(denom) > 1e-12
    safe = np.where(valid, denom, 1.0)
    w1 = (d11 * d20 - d01 * d21) / safe
    w2 = (d00 * d21 - d01 * d20) / safe
    w0 = 1.0 - w1 - w2
    eps = -1e-6
    inside = valid & (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
    height, width = covered.shape
    inside &= (pixels[..., 0] >= 0) & (pixels[..., 0] < width)
    inside &= (pixels[..., 1] >= 0) & (pixels[..., 1] < height)
    n, yy, xx = np.nonzero(inside)
    weights = np.stack([w0[n, yy, xx], w1[n, yy, xx], w2[n, yy, xx]], axis=-1)
    colour = np.einsum("pk,pkc->pc", weights, rgb[n])
    px, py = pixels[n, yy, xx, 0], pixels[n, yy, xx, 1]
    image[py, px] = np.clip(np.rint(colour), 0, 255).astype(np.uint8)
    covered[py, px] = True


def _dilate(image: npt.NDArray[np.uint8], covered: npt.NDArray[np.bool_], passes: int) -> None:
    """Grow chart borders outward so bilinear/mip filtering sees surface colour, not black."""
    for _ in range(passes):
        grown = covered.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src = np.zeros_like(covered)
            ys = slice(max(dy, 0), covered.shape[0] + min(dy, 0))
            yd = slice(max(-dy, 0), covered.shape[0] + min(-dy, 0))
            xs = slice(max(dx, 0), covered.shape[1] + min(dx, 0))
            xd = slice(max(-dx, 0), covered.shape[1] + min(-dx, 0))
            src[yd, xd] = covered[ys, xs]
            take = src & ~grown
            shifted = np.zeros_like(image)
            shifted[yd, xd] = image[ys, xs]
            image[take] = shifted[take]
            grown |= take
        covered[:] = grown
