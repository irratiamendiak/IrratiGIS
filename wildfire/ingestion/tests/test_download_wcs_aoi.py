import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import box

from wildfire.ingestion.download_wcs_aoi import run


class DownloadWcsAoiTests(unittest.TestCase):
    def test_clips_raster_and_counts_spatial_valid_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            boundary_path = root / "boundary.gpkg"
            boundary = gpd.GeoDataFrame(
                {"name": ["test"]}, geometry=[box(1, 1, 3, 3)], crs="EPSG:25830"
            )
            boundary.to_file(boundary_path, layer="pilot_boundary", driver="GPKG")

            mem = MemoryFile()
            with mem.open(
                driver="GTiff", height=4, width=4, count=1, dtype="uint16",
                crs="EPSG:25830", transform=from_origin(0, 4, 1, 1), nodata=0,
            ) as dst:
                dst.write(np.ones((1, 4, 4), dtype="uint16"))
            payload = mem.read()
            mem.close()

            output = root / "out"
            with patch("wildfire.ingestion.download_wcs_aoi.request_geotiff", return_value=payload):
                result = run(boundary_path, output, tile_size=10, max_tiles=1, timeout=1)

            self.assertEqual(result["requested_tiles"], 1)
            self.assertEqual(result["failed_tiles"], 0)
            manifest = json.loads((output / "wcs_aoi_manifest.json").read_text())
            self.assertEqual(manifest["tiles"][0]["valid_pixel_count"], 4)
            with rasterio.open(output / "mdt_0001.tif") as raster:
                self.assertEqual((raster.width, raster.height), (2, 2))
                self.assertEqual(int((raster.dataset_mask() > 0).sum()), 4)


if __name__ == "__main__":
    unittest.main()
