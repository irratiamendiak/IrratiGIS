"""Fetch official geoEuskadi 1:5,000 sheet footprints intersecting a pilot boundary."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape

DEFAULT_LAYER_URL = (
    "https://www.geo.euskadi.eus/geoeuskadi/rest/services/"
    "U11/WMS_KARTOGRAFIA/MapServer/67"
)
OUT_FIELDS = "OBJECTID,CCFF,CFXMTN50,SC50CLAS,HOJA"


def arcgis_get(url: str, params: dict, timeout: int = 60) -> dict:
    request_url = url + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        request_url, headers={"User-Agent": "IrratiGIS-Wildfire-DataIngestion/0.1"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if "error" in payload:
        raise RuntimeError(f"ArcGIS REST error: {payload['error']}")
    return payload


def fetch_sheet_index(
    boundary_path: Path,
    output: Path,
    boundary_layer: str = "pilot_boundary",
    layer_url: str = DEFAULT_LAYER_URL,
    batch_size: int = 200,
) -> dict:
    if batch_size < 1 or batch_size > 500:
        raise ValueError("batch_size must be between 1 and 500")
    boundary = gpd.read_file(boundary_path, layer=boundary_layer)
    if boundary.empty or boundary.crs is None:
        raise ValueError("Boundary layer is empty or has no declared CRS")
    if boundary.geometry.isna().any() or boundary.geometry.is_empty.any():
        raise ValueError("Boundary contains null or empty geometries")
    if (~boundary.geometry.is_valid).any():
        raise ValueError("Boundary contains invalid geometries")
    boundary = boundary.to_crs("EPSG:25830")
    pilot = boundary.geometry.union_all()
    minx, miny, maxx, maxy = pilot.bounds

    ids_payload = arcgis_get(
        layer_url + "/query",
        {
            "where": "1=1",
            "geometry": f"{minx},{miny},{maxx},{maxy}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": 25830,
            "spatialRel": "esriSpatialRelIntersects",
            "returnIdsOnly": "true",
            "f": "json",
        },
    )
    object_ids = ids_payload.get("objectIds") or []
    if not object_ids:
        raise ValueError("The official sheet index returned no candidates for the pilot bbox")

    features = []
    for start in range(0, len(object_ids), batch_size):
        batch = object_ids[start:start + batch_size]
        payload = arcgis_get(
            layer_url + "/query",
            {
                "objectIds": ",".join(str(value) for value in batch),
                "outFields": OUT_FIELDS,
                "returnGeometry": "true",
                "outSR": 25830,
                "f": "geojson",
            },
        )
        features.extend(payload.get("features", []))

    if not features:
        raise ValueError("ArcGIS returned IDs but no sheet geometries")
    index = gpd.GeoDataFrame.from_features(features, crs="EPSG:25830")
    if index.empty or index.geometry.isna().any() or index.geometry.is_empty.any():
        raise ValueError("The downloaded sheet index contains empty geometries")
    if (~index.geometry.is_valid).any():
        raise ValueError("The downloaded sheet index contains invalid geometries")

    # ArcGIS envelope query is only a candidate filter; exact intersection is local.
    selected = index.loc[index.geometry.intersects(pilot)].copy()
    if selected.empty:
        raise ValueError("No 1:5,000 sheet polygons intersect the exact pilot boundary")
    selected["pilot_intersection_area_km2"] = (
        selected.geometry.intersection(pilot).area / 1_000_000
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    selected.to_file(output, layer="intersecting_sheet_index", driver="GPKG")
    report = {
        "source_layer_url": layer_url,
        "source_layer_id": 67,
        "source_layer_name": "MC_HOJAS_5000",
        "source_crs": "EPSG:25830",
        "boundary": str(boundary_path),
        "boundary_layer": boundary_layer,
        "pilot_bbox_epsg25830": [minx, miny, maxx, maxy],
        "candidate_object_id_count": len(object_ids),
        "downloaded_feature_count": len(features),
        "selected_intersecting_sheet_count": int(len(selected)),
        "fields": [str(column) for column in selected.columns if column != selected.geometry.name],
        "selected_records": selected.drop(columns=selected.geometry.name).to_dict(orient="records"),
        "output": str(output),
        "warning": (
            "Cartographic 1:5,000 sheet identifiers are not assumed to match MDT ZIP "
            "names. Verify the relationship and each raster's internal extent before download."
        ),
    }
    report_path = output.with_suffix(".json")
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--boundary", type=Path, required=True)
    parser.add_argument("--boundary-layer", default="pilot_boundary")
    parser.add_argument(
        "--output", type=Path,
        default=Path("data/processed/gipuzkoa/mdt_5000_sheet_index.gpkg"),
    )
    parser.add_argument("--layer-url", default=DEFAULT_LAYER_URL)
    parser.add_argument("--batch-size", type=int, default=200)
    args = parser.parse_args()
    try:
        report = fetch_sheet_index(
            args.boundary, args.output, args.boundary_layer,
            args.layer_url, args.batch_size,
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
