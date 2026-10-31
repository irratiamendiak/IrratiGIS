import tempfile
import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box

from wildfire.ingestion.prepare_gipuzkoa_boundary import write_boundary_layers


class GipuzkoaBoundaryOutputTests(unittest.TestCase):
    def test_keeps_source_municipal_and_special_layers(self):
        source = gpd.GeoDataFrame(
            {"CODMUNI": ["001", "001", "996"], "NAME_ES": ["A", "A", "Isla"]},
            geometry=[box(0, 0, 1, 1), box(1, 0, 2, 1), box(3, 0, 4, 1)],
            crs="EPSG:25830",
        )
        municipalities = source.iloc[:2].dissolve(by="CODMUNI", as_index=False, aggfunc="first")
        special = source.iloc[2:].dissolve(by="CODMUNI", as_index=False, aggfunc="first")
        boundary = gpd.GeoDataFrame(
            {"pilot": ["Gipuzkoa"]},
            geometry=[source.geometry.union_all()],
            crs="EPSG:25830",
        )
        with tempfile.TemporaryDirectory() as tmp:
            gpkg = Path(tmp) / "boundary.gpkg"
            write_boundary_layers(gpkg, source, municipalities, special, boundary)
            layers = set(gpd.list_layers(gpkg)["name"])
            self.assertEqual(
                layers,
                {"source_features", "municipalities", "special_territorial_units", "pilot_boundary"},
            )
            self.assertEqual(len(gpd.read_file(gpkg, layer="source_features")), 3)
            self.assertEqual(len(gpd.read_file(gpkg, layer="municipalities")), 1)
            self.assertEqual(len(gpd.read_file(gpkg, layer="special_territorial_units")), 1)


if __name__ == "__main__":
    unittest.main()
