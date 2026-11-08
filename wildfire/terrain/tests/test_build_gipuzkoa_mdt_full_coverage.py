import importlib.util
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window

SCRIPT = Path(__file__).parents[2] / "ingestion" / "build_gipuzkoa_mdt_full_coverage.py"
spec = importlib.util.spec_from_file_location("build_gipuzkoa_mdt_full_coverage", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def make_dataset(path, transform, values):
    profile = {
        "driver": "GTiff", "height": values.shape[0], "width": values.shape[1],
        "count": 1, "dtype": "float32", "crs": "EPSG:25830",
        "transform": transform, "nodata": -9999.0,
    }
    with rasterio.open(path, "w", **profile) as ds:
        ds.write(values.astype("float32"), 1)


def test_paste_tile_inserts_valid_cells_and_preserves_nodata(tmp_path):
    mosaic_path = tmp_path / "mosaic.tif"
    tile_path = tmp_path / "tile.tif"
    with rasterio.open(mosaic_path, "w", driver="GTiff", width=6, height=6,
                       count=1, dtype="float32", crs="EPSG:25830",
                       transform=from_origin(0, 6, 1, 1), nodata=-9999.0) as dst:
        dst.write(np.full((6, 6), -9999.0, dtype="float32"), 1)
        values = np.arange(16, dtype="float32").reshape(4, 4)
        values[0, 0] = -9999.0
        make_dataset(tile_path, from_origin(1, 5, 1, 1), values)
        with rasterio.open(tile_path) as src:
            result = module.paste_tile(src, dst, "test-tile", 2)
        assert result["new_unique_cells_inserted"] == 15
        out = dst.read(1)
        assert out[1, 1] == -9999.0
        assert out[1, 2] == 1.0
        assert out[4, 4] == 15.0


def test_paste_tile_reports_overlaps_and_keeps_first_valid_value(tmp_path):
    mosaic_path = tmp_path / "mosaic.tif"
    first_path = tmp_path / "first.tif"
    second_path = tmp_path / "second.tif"
    with rasterio.open(mosaic_path, "w", driver="GTiff", width=6, height=4,
                       count=1, dtype="float32", crs="EPSG:25830",
                       transform=from_origin(0, 4, 1, 1), nodata=-9999.0) as dst:
        dst.write(np.full((4, 6), -9999.0, dtype="float32"), 1)
        make_dataset(first_path, from_origin(0, 4, 1, 1), np.full((4, 4), 100.0))
        make_dataset(second_path, from_origin(2, 4, 1, 1), np.full((4, 4), 101.0))
        with rasterio.open(first_path) as src:
            module.paste_tile(src, dst, "first", 2)
        with rasterio.open(second_path) as src:
            result = module.paste_tile(src, dst, "second", 2)
        assert result["overlap_comparable_cells"] == 8
        assert result["overlap_different_cells"] == 8
        assert result["max_overlap_difference_m"] == 1.0
        out = dst.read(1)
        assert np.all(out[:, 2:4] == 100.0)
        assert np.all(out[:, 4:6] == 101.0)


def test_paste_tile_rejects_unaligned_source_grid(tmp_path):
    mosaic_path = tmp_path / "mosaic.tif"
    tile_path = tmp_path / "tile.tif"
    with rasterio.open(mosaic_path, "w", driver="GTiff", width=4, height=4,
                       count=1, dtype="float32", crs="EPSG:25830",
                       transform=from_origin(0, 4, 1, 1), nodata=-9999.0) as dst:
        dst.write(np.full((4, 4), -9999.0, dtype="float32"), 1)
        make_dataset(tile_path, from_origin(0.5, 4, 1, 1), np.ones((2, 2)))
        with rasterio.open(tile_path) as src:
            import pytest
            with pytest.raises(ValueError, match="not aligned"):
                module.paste_tile(src, dst, "unaligned", 2)
