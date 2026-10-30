"""Download and prepare the B5M Gipuzkoa municipal boundary dataset.

Preserves source polygons, dissolves the 88 municipalities by CODMUNI,
keeps four special territorial units separately, and creates a pilot outline.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
from shapely.ops import unary_union

from wildfire.ingestion.download_source import download_source

SPECIAL_CODES = {"996", "997", "998", "999"}


def column_name(frame: gpd.GeoDataFrame, expected: str) -> str:
    matches = [name for name in frame.columns if str(name).upper() == expected.upper()]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {expected!r} field; found {matches}")
    return matches[0]


def find_shapefile(root: Path) -> Path:
    matches = sorted(root.rglob("*.shp"))
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one .shp in extracted source, found {len(matches)}")
    return matches[0]


def write_boundary_layers(gpkg: Path, source_features: gpd.GeoDataFrame,
                          municipalities: gpd.GeoDataFrame,
                          special_units: gpd.GeoDataFrame,
                          boundary: gpd.GeoDataFrame) -> None:
    """Write all source and derived layers into one GeoPackage."""
    if gpkg.exists():
        gpkg.unlink()
    source_features.to_file(gpkg, layer="source_features", driver="GPKG")
    municipalities.to_file(gpkg, layer="municipalities", driver="GPKG", mode="a")
    special_units.to_file(gpkg, layer="special_territorial_units", driver="GPKG", mode="a")
    boundary.to_file(gpkg, layer="pilot_boundary", driver="GPKG", mode="a")


def prepare(catalog: Path, output: Path, force: bool = False) -> dict:
    raw = output / "raw"
    record = download_source(catalog, "gipuzkoa_b5m_municipal_boundaries", raw, force=force)
    source_root = raw / "gipuzkoa_b5m_municipal_boundaries" / "extracted"
    shp = find_shapefile(source_root)
    source = gpd.read_file(shp)

    if source.empty:
        raise ValueError("Boundary dataset contains no features")
    if source.crs is None:
        raise ValueError("Boundary dataset has no declared CRS; refusing to guess")

    code_field = column_name(source, "CODMUNI")
    name_field = column_name(source, "NAME_ES")
    codes = source[code_field].astype(str).str.strip()
    if source.geometry.isna().any() or source.geometry.is_empty.any():
        raise ValueError("Boundary dataset contains null or empty geometries")

    invalid_before = int((~source.geometry.is_valid).sum())
    if invalid_before:
        source.geometry = source.geometry.make_valid()
    if (~source.geometry.is_valid).any():
        raise ValueError("Some source geometries remain invalid after make_valid")

    source_crs = source.crs.to_string()
    source = source.to_crs("EPSG:25830")
    codes = source[code_field].astype(str).str.strip()
    municipal_source = source.loc[~codes.isin(SPECIAL_CODES)].copy()
    special_source = source.loc[codes.isin(SPECIAL_CODES)].copy()
    if municipal_source.empty or special_source.empty:
        raise ValueError("Expected municipal features and the four special territorial units")

    municipalities = municipal_source.dissolve(by=code_field, as_index=False, aggfunc="first")
    special_units = special_source.dissolve(by=code_field, as_index=False, aggfunc="first")
    if len(municipalities) != 88:
        raise ValueError(f"Expected 88 municipalities, found {len(municipalities)}")
    if set(special_units[code_field].astype(str)) != SPECIAL_CODES:
        raise ValueError("The four expected special territorial units are not all present")

    dissolved = unary_union(list(source.geometry))
    boundary = gpd.GeoDataFrame(
        [{"pilot": "Gipuzkoa", "source_id": "gipuzkoa_b5m_municipal_boundaries",
          "source_sha256": record["sha256"], "source_updated": "2026-10-26"}],
        geometry=[dissolved], crs="EPSG:25830"
    )

    output.mkdir(parents=True, exist_ok=True)
    gpkg = output / "gipuzkoa_boundary.gpkg"
    write_boundary_layers(gpkg, source, municipalities, special_units, boundary)

    area_km2 = float(boundary.geometry.area.iloc[0] / 1_000_000)
    minx, miny, maxx, maxy = boundary.total_bounds
    report = {
        "pilot": "Gipuzkoa",
        "source": record,
        "source_crs": source_crs,
        "processing_crs": "EPSG:25830",
        "source_feature_count": int(len(source)),
        "municipality_count": int(len(municipalities)),
        "special_territorial_unit_count": int(len(special_units)),
        "invalid_geometries_repaired": invalid_before,
        "area_km2_planar": round(area_km2, 3),
        "bounds_epsg25830": [float(minx), float(miny), float(maxx), float(maxy)],
        "output": str(gpkg),
        "layers": ["source_features", "municipalities", "special_territorial_units", "pilot_boundary"],
        "quality_flags": []
    }
    if not 1800 <= area_km2 <= 2200:
        report["quality_flags"].append("Dissolved area outside broad expected 1800-2200 km2 range; inspect CRS, enclaves and source geometry.")
    report_path = output / "gipuzkoa_boundary_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("wildfire/ingestion/sources.euskadi-gipuzkoa.json"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/gipuzkoa"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        result = prepare(args.catalog, args.output, force=args.force)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
