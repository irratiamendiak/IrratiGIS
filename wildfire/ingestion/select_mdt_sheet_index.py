"""Select official cartographic sheet footprints intersecting a pilot boundary."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import geopandas as gpd

def select_sheets(boundary_path: Path, index_path: Path, output: Path,
                  boundary_layer: str = "pilot_boundary", index_layer: str | None = None) -> dict:
    boundary = gpd.read_file(boundary_path, layer=boundary_layer)
    if boundary.empty or boundary.crs is None:
        raise ValueError("Boundary layer is empty or has no declared CRS")
    if boundary.geometry.isna().any() or boundary.geometry.is_empty.any():
        raise ValueError("Boundary contains null or empty geometries")
    if (~boundary.geometry.is_valid).any():
        raise ValueError("Boundary contains invalid geometries; repair/review before selection")
    index = gpd.read_file(index_path, layer=index_layer) if index_layer else gpd.read_file(index_path)
    if index.empty or index.crs is None:
        raise ValueError("Sheet index is empty or has no declared CRS")
    if index.geometry.isna().any() or index.geometry.is_empty.any():
        raise ValueError("Sheet index contains null or empty geometries")
    if (~index.geometry.is_valid).any():
        raise ValueError("Sheet index contains invalid geometries; inspect source before selection")
    target_crs = boundary.crs
    index = index.to_crs(target_crs)
    pilot = boundary.geometry.union_all()
    selected = index.loc[index.geometry.intersects(pilot)].copy()
    if selected.empty:
        raise ValueError("No sheet-index features intersect the pilot boundary; verify layer, CRS and index coverage")
    selected["pilot_intersection_area_km2"] = selected.geometry.intersection(pilot).area / 1_000_000
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    selected.to_file(output, layer="intersecting_sheet_index", driver="GPKG")
    report = {
        "boundary": str(boundary_path), "boundary_layer": boundary_layer,
        "index": str(index_path), "index_layer": index_layer,
        "crs": target_crs.to_string(), "selected_feature_count": int(len(selected)),
        "source_index_fields": [str(c) for c in selected.columns if c != selected.geometry.name],
        "selected_records": selected.drop(columns=selected.geometry.name).to_dict(orient="records"),
        "output": str(output),
        "warning": "This is a geometric index selection only. Confirm sheet scale/identifier fields and actual raster coverage before downloading MDT files."
    }
    report_path = output.with_suffix(".json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    return report

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--boundary", type=Path, required=True)
    parser.add_argument("--boundary-layer", default="pilot_boundary")
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--index-layer")
    parser.add_argument("--output", type=Path, default=Path("data/processed/gipuzkoa/mdt_sheet_index.gpkg"))
    args = parser.parse_args()
    report = select_sheets(args.boundary, args.index, args.output, args.boundary_layer, args.index_layer)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
