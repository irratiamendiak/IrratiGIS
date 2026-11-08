import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

SCRIPT = Path(__file__).parents[1] / "derive_terrain_variables.py"
spec = importlib.util.spec_from_file_location("derive_terrain_variables", SCRIPT)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def run_derivatives(tmp_path, data, nodata=-9999):
    dem = tmp_path / "dem.tif"
    with rasterio.open(
        dem, "w", driver="GTiff", width=data.shape[1], height=data.shape[0],
        count=1, dtype="float32", crs="EPSG:25830",
        transform=from_origin(500000, 4800000, 1, 1), nodata=nodata,
    ) as dst:
        dst.write(data.astype("float32"), 1)
    out = tmp_path / "out"
    old = sys.argv
    try:
        sys.argv = ["derive_terrain_variables.py", "--dem", str(dem), "--output-dir", str(out), "--block-size", "64"]
        module.main()
    finally:
        sys.argv = old
    return out


def test_planar_dem_has_expected_slope_and_aspect(tmp_path):
    rows, cols = np.indices((5, 5))
    dem = 2 * cols - 3 * rows
    out = run_derivatives(tmp_path, dem)
    with rasterio.open(out / "slope_degrees.tif") as src:
        slope = src.read(1)
        expected = math.degrees(math.atan(math.sqrt(13)))
        assert np.allclose(slope[1:4, 1:4], expected, atol=1e-4)
        assert np.all(slope[[0, -1], :] == -9999)
    with rasterio.open(out / "aspect_degrees.tif") as src:
        aspect = src.read(1)
        expected_aspect = (math.degrees(math.atan2(-2, -3)) + 360) % 360
        assert np.allclose(aspect[1:4, 1:4], expected_aspect, atol=1e-4)


def test_nodata_neighbourhood_is_marked_not_interpolated(tmp_path):
    dem = np.ones((5, 5), dtype="float32") * 100
    dem[2, 2] = -9999
    out = run_derivatives(tmp_path, dem)
    with rasterio.open(out / "terrain_quality_mask.tif") as src:
        quality = src.read(1)
        assert quality[2, 2] == 0
        assert quality[1, 1] == 2
        assert quality[0, 0] == 2
        assert quality[3, 3] == 2
        assert quality[2, 0] == 2
