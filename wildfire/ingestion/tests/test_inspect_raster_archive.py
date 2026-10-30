import tempfile
import unittest
import zipfile
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from wildfire.ingestion.inspect_raster_archive import inspect_archive

class RasterArchiveInspectionTests(unittest.TestCase):
    def test_reads_geotiff_metadata_from_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tif = root / "sample.tif"
            with rasterio.open(tif, "w", driver="GTiff", width=4, height=3, count=1,
                               dtype="float32", crs="EPSG:25830",
                               transform=from_origin(500000, 4800000, 1, 1), nodata=-9999) as ds:
                ds.write(np.ones((3, 4), dtype="float32"), 1)
            archive = root / "sample.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.write(tif, arcname="sample.tif")
            result = inspect_archive(archive)
            self.assertEqual(len(result["rasters"]), 1)
            raster = result["rasters"][0]
            self.assertEqual(raster["crs"], "EPSG:25830")
            self.assertEqual(raster["resolution"], [1.0, 1.0])
            self.assertEqual(raster["width"], 4)

if __name__ == "__main__":
    unittest.main()
