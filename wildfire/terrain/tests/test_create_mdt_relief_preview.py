import importlib.util
from pathlib import Path

import pytest
from shapely.geometry import box

SCRIPT = Path(__file__).parents[2] / "ingestion" / "create_mdt_relief_preview.py"
spec = importlib.util.spec_from_file_location("create_mdt_relief_preview", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def tile(name, geom, area=1.0, available=True):
    return {
        "HOJA": name,
        "available": available,
        "geometry_wkt": geom.wkt,
        "pilot_intersection_area_km2": area,
    }


def test_selects_connected_group_with_largest_intersection_area():
    rows = [
        tile("001-1-1", box(0, 0, 1, 1), 1),
        tile("001-2-1", box(1, 0, 2, 1), 2),
        tile("001-3-1", box(2, 0, 3, 1), 3),
        tile("001-9-9", box(10, 10, 11, 11), 100),
    ]
    selected = module.select_adjacent_tiles(rows)
    assert [row["HOJA"] for row in selected] == ["001-1-1", "001-2-1", "001-3-1"]


def test_rejects_missing_footprint_instead_of_guessing_adjacency():
    rows = [
        tile("001-1-1", box(0, 0, 1, 1)),
        {"HOJA": "001-2-1", "available": True},
        tile("001-3-1", box(2, 0, 3, 1)),
    ]
    with pytest.raises(ValueError, match="missing official footprint"):
        module.select_adjacent_tiles(rows)


def test_rejects_disconnected_available_tiles():
    rows = [
        tile("001-1-1", box(0, 0, 1, 1)),
        tile("001-2-1", box(3, 0, 4, 1)),
        tile("001-3-1", box(6, 0, 7, 1)),
    ]
    with pytest.raises(ValueError, match="No connected group"):
        module.select_adjacent_tiles(rows)
