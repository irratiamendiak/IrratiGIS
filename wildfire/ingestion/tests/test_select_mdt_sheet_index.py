import tempfile
import unittest
from pathlib import Path
import geopandas as gpd
from shapely.geometry import box
from wildfire.ingestion.select_mdt_sheet_index import select_sheets

class SheetIndexSelectionTests(unittest.TestCase):
    def test_selects_only_intersecting_sheet_features(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            boundary_path = root / "boundary.gpkg"
            index_path = root / "index.gpkg"
            output_path = root / "selected.gpkg"
            boundary = gpd.GeoDataFrame({"pilot": ["Gipuzkoa"]}, geometry=[box(0, 0, 10, 10)], crs="EPSG:25830")
            index = gpd.GeoDataFrame({"sheet": ["inside", "outside"]}, geometry=[box(5, 5, 15, 15), box(20, 20, 30, 30)], crs="EPSG:25830")
            boundary.to_file(boundary_path, layer="pilot_boundary", driver="GPKG")
            index.to_file(index_path, layer="sheets", driver="GPKG")
            result = select_sheets(boundary_path, index_path, output_path, "pilot_boundary", "sheets")
            self.assertEqual(result["selected_feature_count"], 1)
            selected = gpd.read_file(output_path, layer="intersecting_sheet_index")
            self.assertEqual(selected["sheet"].tolist(), ["inside"])

if __name__ == "__main__":
    unittest.main()
