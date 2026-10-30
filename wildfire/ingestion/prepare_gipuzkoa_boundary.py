"""Download and prepare the official Gipuzkoa municipal boundary dataset.

Keeps municipality polygons and creates a dissolved pilot boundary. Requires
GeoPandas/pyogrio. The input archive and its SHA-256 manifest are preserved.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
from shapely.ops import unary_union

from wildfire.ingestion.download_source import download_source


def find_shapefile(root: Path) -> Path:
    matches = sorted(root.rglob("*.shp"))
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one .shp in extracted source, found {len(matches)}")
    return matches[0]


def prepare(catalog: Path, output: Path, force: bool = False) -> dict:
    raw = output / "raw"
    record = download_source(
        catalog, "gipuzkoa_b5m_municipal_boundaries", raw, force=force
    )
    source_root = raw / "gipuzkoa_b5m_municipal_boundaries" / "extracted"
    shp = find_shapefile(source_root)
    municipalities = gpd.read_file(shp)

    if municipalities.empty:
        raise ValueError("Boundary dataset contains no features")
    if municipalities.crs is None:
        raise ValueError("Boundary dataset has no declared CRS; refusing to guess")
    if "name" not in municipalities.columns and "name_es" not in municipalities.columns and "name_eu" not in municipalities.columns:
        raise ValueError("Expected municipality name attribute not found; inspect schema manually")

    source_crs = municipalities.crs.to_string()
    if municipalities.geometry.isna().any() or municipalities.geometry.is_empty.any():
        raise ValueError("Boundary dataset contains null or empty geometries")

    invalid_before = int((~municipalities.geometry.is_valid).sum())
    if invalid_before:
        try:
            municipalities.geometry = municipalities.geometry.make_valid()
        except AttributeError:
            from shapely import make_valid
            municipalities.geometry = municipalities.geometry.apply(make_valid)
    if (~municipalities.geometry.is_valid).any():
        raise ValueError("Some municipality geometries remain invalid after make_valid")

    municipalities = municipalities.to_crs("EPSG:25830")
    dissolved = unary_union(list(municipalities.geometry))
    boundary = gpd.GeoDataFrame(
        [{"pilot": "Gipuzkoa", "source_id": "gipuzkoa_b5m_municipal_boundaries",
          "source_sha256": record["sha256"], "source_updated": "2026-10-26"}],
        geometry=[dissolved], crs="EPSG:25830"
    )

    output.mkdir(parents=True, exist_ok=True)
    gpkg = output / "gipuzkoa_boundary.gpkg"
    if gpkg.exists():
        gpkg.unlink()
    municipalities.to_file(gpkg, layer="municipalities", driver="GPKG")
    boundary.to_file(gpkg, layer="pilot_boundary", driver="GPKG")

    area_km2 = float(boundary.geometry.area.iloc[0] / 1_000_000)
    minx, miny, maxx, maxy = boundary.total_bounds
    report = {
        "pilot": "Gipuzkoa",
        "source": record,
        "source_crs": source_crs,
        "processing_crs": "EPSG:25830",
        "municipality_count": int(len(municipalities)),
        "invalid_geometries_repaired": invalid_before,
        "area_km2_planar": round(area_km2, 3),
        "bounds_epsg25830": [float(minx), float(miny), float(maxx), float(maxy)],
        "output": str(gpkg),
        "layers": ["municipalities", "pilot_boundary"],
        "quality_flags": []
    }
    if not 80 <= len(municipalities) <= 95:
        report["quality_flags"].append("Municipality count outside expected 80-95 range; inspect source coverage and duplicate/enclave features.")
    if not 1800 <= area_km2 <= 2200:
        report["quality_flags"].append("Dissolved area outside broad expected 1800-2200 km2 range; inspect CRS, enclaves and source geometry.")
    report_path = output / "gipuzkoa_boundary_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("wildfire/ingestion/sources.euskadi-gipuzkoa.json"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/gipuzkoa"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        result = prepare(args.catalog, args.output, args.force)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
