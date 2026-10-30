import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import box, mapping

from wildfire.ingestion.fetch_arcgis_sheet_index import fetch_sheet_index


class ArcGisSheetIndexTests(unittest.TestCase):
    def test_fetches_candidates_and_filters_exact_intersection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            boundary_path = root / "boundary.gpkg"
            boundary = gpd.GeoDataFrame(
                {"name": ["pilot"]},
                geometry=[box(100, 100, 200, 200)],
                crs="EPSG:25830",
            )
            boundary.to_file(boundary_path, layer="pilot_boundary", driver="GPKG")

            calls = []

            def fake_arcgis_get(url, params, timeout=60):
                calls.append(params)
                if params.get("returnIdsOnly") == "true":
                    return {"objectIds": [11, 12]}
                all_features = [
                    {
                        "type": "Feature",
                        "id": 11,
                        "properties": {
                            "OBJECTID": 11, "CCFF": "A", "CFXMTN50": "A",
                            "SC50CLAS": "A", "HOJA": "inside"
                        },
                        "geometry": mapping(box(150, 150, 250, 250)),
                    },
                    {
                        "type": "Feature",
                        "id": 12,
                        "properties": {
                            "OBJECTID": 12, "CCFF": "B", "CFXMTN50": "B",
                            "SC50CLAS": "B", "HOJA": "outside"
                        },
                        "geometry": mapping(box(300, 300, 400, 400)),
                    },
                ]
                requested_ids = {int(value) for value in params["objectIds"].split(",")}
                return {
                    "type": "FeatureCollection",
                    "features": [
                        feature for feature in all_features
                        if feature["id"] in requested_ids
                    ],
                }

            output = root / "selected.gpkg"
            with patch(
                "wildfire.ingestion.fetch_arcgis_sheet_index.arcgis_get",
                side_effect=fake_arcgis_get,
            ):
                report = fetch_sheet_index(
                    boundary_path, output, layer_url="https://example.invalid/67",
                    batch_size=1,
                )

            self.assertEqual(report["candidate_object_id_count"], 2)
            self.assertEqual(report["downloaded_feature_count"], 2)
            self.assertEqual(report["selected_intersecting_sheet_count"], 1)
            self.assertEqual(report["selected_records"][0]["HOJA"], "inside")
            self.assertEqual(len(calls), 3)
            self.assertTrue(output.exists())
            self.assertTrue(output.with_suffix(".json").exists())

    def test_rejects_invalid_batch_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            boundary_path = root / "boundary.gpkg"
            gpd.GeoDataFrame(
                {"name": ["pilot"]}, geometry=[box(0, 0, 1, 1)],
                crs="EPSG:25830",
            ).to_file(boundary_path, layer="pilot_boundary", driver="GPKG")
            with self.assertRaises(ValueError):
                fetch_sheet_index(boundary_path, root / "out.gpkg", batch_size=0)


if __name__ == "__main__":
    unittest.main()
