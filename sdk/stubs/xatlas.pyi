# Minimal type stub for the compiled `xatlas` module (xatlas-python ships no stubs).
# Covers only the API used by uidss.threed.bake.
import numpy as np
import numpy.typing as npt

class ChartOptions:
    def __init__(self) -> None: ...

class PackOptions:
    padding: int
    bilinear: bool
    resolution: int
    texels_per_unit: float
    def __init__(self) -> None: ...

class Atlas:
    width: int
    height: int
    atlas_count: int
    chart_count: int
    utilization: float
    def __init__(self) -> None: ...
    def add_mesh(
        self, positions: npt.NDArray[np.float32], indices: npt.NDArray[np.uint32]
    ) -> None: ...
    def generate(self, chart_options: ChartOptions, pack_options: PackOptions) -> None: ...
    def get_mesh(
        self, index: int
    ) -> tuple[npt.NDArray[np.uint32], npt.NDArray[np.uint32], npt.NDArray[np.float32]]: ...
