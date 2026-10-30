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
            with rasterio.open(
                tif, "w", driver="GTiff", width=4, height=3, count=1,
                dtype="float32", crs="EPSG:25830",
                transform=from_origin(500000, 4800000, 1, 1), nodata=-9999
            ) as ds:
                ds.write(np.ones((3, 4), dtype="float32"), 1)
            archive = root / "sample.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.write(tif, arcname="sample.tif")
            result = inspect_archive(archive)
            self.assertEqual(len(result["rasters"]), 1)
            raster = result["rasters"][0]
            self.assertEqual(raster["crs"], "EPSG:25830")
            self.assertEqual(raster["crs_epsg"], 25830)
            self.assertEqual(raster["resolution"], [1.0, 1.0])
            self.assertEqual(raster["width"], 4)
            self.assertEqual(len(result["archive_sha256"]), 64)

    def test_reads_esri_ascii_grid_and_etrs89_prj_from_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            asc = root / "mdt_110_6_5.asc"
            asc.write_text(
                "ncols 2\nnrows 2\nxllcorner 474430\nyllcorner 4749230\n"
                "cellsize 1\nNODATA_value -9999\n10 11\n12 -9999\n",
                encoding="ascii",
            )
            prj = root / "mdt_110_6_5.prj"
            prj.write_text(
                "Projection UTM\nZone 30\nDatum AI_ETRS89\n"
                "Spheroid GRS80\nUnits METERS\n",
                encoding="ascii",
            )
            archive = root / "sample-asc.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.write(asc, arcname=asc.name)
                zf.write(prj, arcname=prj.name)

            result = inspect_archive(archive)
            self.assertEqual(len(result["rasters"]), 1)
            raster = result["rasters"][0]
            self.assertEqual(raster["driver"], "AAIGrid")
            self.assertEqual(raster["width"], 2)
            self.assertEqual(raster["height"], 2)
            self.assertEqual(raster["resolution"], [1.0, 1.0])
            self.assertEqual(raster["bounds"], [474430.0, 4749230.0, 474432.0, 4749232.0])
            self.assertEqual(raster["crs_inferred_from_prj"], "EPSG:25830")
            self.assertEqual(raster["projection_file"], prj.name)


if __name__ == "__main__":
    unittest.main()
