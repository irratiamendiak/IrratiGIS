#!/usr/bin/env python3
"""Check official geoEuskadi MDT ZIP URLs for the selected 1:5,000 sheets.

This is a lightweight availability check only: it does not download raster ZIPs
or assume that the cartographic sheet footprint equals the raster footprint.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


BASE = "https://www.geo.euskadi.eus/lidar/DatosDescarga/MDE/MAX_ACTUALIDAD/MDT_LIDAR_2017_ETRS89/MDT"


def url_for_sheet(sheet: str) -> str:
    match = re.fullmatch(r"(\d{3})-(\d+)-(\d+)", str(sheet).strip())
    if not match:
        raise ValueError(f"Unexpected HOJA identifier: {sheet!r}")
    folder, col, row = match.groups()
    filename = f"mdt_{folder}_{col}_{row}.zip"
    return f"{BASE}/H0{folder}/{filename}"


def probe(url: str, timeout: int, retries: int) -> dict:
    last_error = None
    for attempt in range(retries + 1):
        for method, headers in (
            ("HEAD", {}),
            ("GET", {"Range": "bytes=0-0"}),
        ):
            request = urllib.request.Request(
                url, method=method, headers={"User-Agent": "IrratiGIS-MDT-index/1.0", **headers}
            )
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    status = response.status
                    result_headers = response.headers
                    content_range = result_headers.get("Content-Range", "")
                    length = result_headers.get("Content-Length", "")
                    if content_range and "/" in content_range:
                        length = content_range.rsplit("/", 1)[-1]
                    return {
                        "http_status": status,
                        "available": 200 <= status < 300,
                        "checked_method": method,
                        "content_length_bytes": int(length) if length.isdigit() else None,
                        "content_range": content_range or None,
                        "final_url": response.geturl(),
                        "error": None,
                    }
            except urllib.error.HTTPError as exc:
                last_error = f"HTTP {exc.code}"
                if exc.code == 404:
                    return {
                        "http_status": 404, "available": False, "checked_method": method,
                        "content_length_bytes": None, "content_range": None,
                        "final_url": exc.geturl(), "error": "Not found",
                    }
                if method == "HEAD" and exc.code in (405, 501):
                    continue
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = str(exc)
                if method == "HEAD":
                    continue
        if attempt < retries:
            time.sleep(1.5 * (attempt + 1))
    return {
        "http_status": None, "available": None, "checked_method": None,
        "content_length_bytes": None, "content_range": None,
        "final_url": url, "error": last_error or "Unknown probe failure",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True, type=Path, help="Sheet-index JSON")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=25)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()

    source = json.loads(args.index.read_text(encoding="utf-8"))
    records = source.get("selected_records", [])
    if not records:
        parser.error("The sheet index contains no selected_records")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        for record in records:
            sheet = str(record["HOJA"])
            url = url_for_sheet(sheet)
            futures[pool.submit(probe, url, args.timeout, args.retries)] = (record, url)
        for future in concurrent.futures.as_completed(futures):
            record, url = futures[future]
            result = future.result()
            rows.append({
                "HOJA": record["HOJA"],
                "OBJECTID": record.get("OBJECTID"),
                "pilot_intersection_area_km2": record.get("pilot_intersection_area_km2"),
                "url": url,
                **result,
            })

    rows.sort(key=lambda row: row["HOJA"])
    fields = [
        "HOJA", "OBJECTID", "pilot_intersection_area_km2", "url",
        "http_status", "available", "checked_method", "content_length_bytes",
        "content_range", "final_url", "error",
    ]
    csv_path = args.output_dir / "mdt_2017_zip_availability.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    summary = {
        "source_sheet_index": str(args.index),
        "source_layer_url": source.get("source_layer_url"),
        "source_sheet_count": len(records),
        "checked_count": len(rows),
        "available_count": sum(row["available"] is True for row in rows),
        "not_found_count": sum(row["http_status"] == 404 for row in rows),
        "indeterminate_count": sum(row["available"] is None for row in rows),
        "unavailable_other_count": sum(row["available"] is False and row["http_status"] != 404 for row in rows),
        "total_advertised_bytes_available": sum(
            row["content_length_bytes"] or 0 for row in rows if row["available"] is True
        ),
        "url_pattern": BASE + "/H{NNN}/mdt_{NNN}_{i}_{j}.zip",
        "note": (
            "HTTP availability and advertised size only. No raster archive was downloaded; "
            "each ZIP's internal extent, CRS, resolution and NoData coverage still require inspection."
        ),
        "results": rows,
    }
    json_path = args.output_dir / "mdt_2017_zip_availability.json"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "results"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
