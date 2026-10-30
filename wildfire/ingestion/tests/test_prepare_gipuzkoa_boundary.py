import tempfile
import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box

from wildfire.ingestion.prepare_gipuzkoa_boundary import write_boundary_layers


class GipuzkoaBoundaryOutputTests(unittest.TestCase):
    def test_keeps_municipalities_and_dissolved_boundary_layers(self):
        municipalities = gpd.GeoDataFrame(
            {"municipality": ["A", "B"]},
            geometry=[box(0, 0, 1, 1), box(1, 0, 2, 1)],
            crs="EPSG:25830",
        )
        boundary = gpd.GeoDataFrame(
            {"pilot": ["Gipuzkoa"]},
            geometry=[municipalities.geometry.union_all()],
            crs="EPSG:25830",
        )
        with tempfile.TemporaryDirectory() as tmp:
            gpkg = Path(tmp) / "boundary.gpkg"
            write_boundary_layers(gpkg, municipalities, boundary)
            layers = set(gpd.list_layers(gpkg)["name"])
            self.assertEqual(layers, {"municipalities", "pilot_boundary"})
            restored = gpd.read_file(gpkg, layer="municipalities")
            self.assertEqual(len(restored), 2)


if __name__ == "__main__":
    unittest.main()
