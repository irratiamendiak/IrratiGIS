#!/usr/bin/env python3
"""Download selected MDT ZIPs one by one, validate archives and inspect ASCII-grid metadata.

Raster payloads are temporary and are not included in the resulting artifact.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import json
import re
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


def download_and_inspect(row: dict, timeout: int, retries: int, max_bytes: int) -> dict:
    url = row["url"]
    result = {
        "HOJA": row["HOJA"], "url": url, "download_ok": False,
        "archive_valid": False, "asc_file": None, "prj_file": None,
        "columns": None, "rows": None, "cellsize": None,
        "xllcorner": None, "yllcorner": None, "xllcenter": None, "yllcenter": None,
        "nodata_value": None, "bounds_xmin": None, "bounds_ymin": None,
        "bounds_xmax": None, "bounds_ymax": None, "prj_text": None,
        "sha256": None, "download_bytes": None, "zip_members": None,
        "error": None,
    }
    last_error = None
    for attempt in range(retries + 1):
        digest = hashlib.sha256()
        total = 0
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "IrratiGIS-MDT-inspector/1.0"})
            with urllib.request.urlopen(request, timeout=timeout) as response, tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
                declared = response.headers.get("Content-Length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise ValueError(f"ZIP exceeds configured limit ({declared} bytes)")
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError(f"ZIP exceeded configured limit ({max_bytes} bytes)")
                    digest.update(chunk)
                    tmp.write(chunk)
                tmp.flush()
                result["download_bytes"] = total
                result["sha256"] = digest.hexdigest()
                result["download_ok"] = True
                with zipfile.ZipFile(tmp.name) as archive:
                    bad_member = archive.testzip()
                    if bad_member:
                        raise ValueError(f"CRC failure in ZIP member: {bad_member}")
                    members = [n for n in archive.namelist() if not n.endswith("/")]
                    result["zip_members"] = len(members)
                    asc_names = [n for n in members if n.lower().endswith(".asc")]
                    prj_names = [n for n in members if n.lower().endswith(".prj")]
                    if len(asc_names) != 1:
                        raise ValueError(f"Expected exactly one .asc file, found {len(asc_names)}")
                    asc_name = asc_names[0]
                    result["asc_file"] = asc_name
                    prj_match = next((n for n in prj_names if PurePosixPath(n).stem.lower() == PurePosixPath(asc_name).stem.lower()), None)
                    if prj_match is None and len(prj_names) == 1:
                        prj_match = prj_names[0]
                    result["prj_file"] = prj_match
                    with archive.open(asc_name) as asc:
                        header = {}
                        for _ in range(12):
                            line = asc.readline()
                            if not line:
                                break
                            try:
                                key, value = line.decode("ascii", errors="strict").strip().split(None, 1)
                            except ValueError:
                                break
                            key = key.lower()
                            if key not in {"ncols", "nrows", "xllcorner", "yllcorner", "xllcenter", "yllcenter", "cellsize", "nodata_value"}:
                                break
                            header[key] = value
                    for key in ("ncols", "nrows", "cellsize", "xllcorner", "yllcorner", "xllcenter", "yllcenter", "nodata_value"):
                        if key in header:
                            result[key] = float(header[key]) if key not in ("ncols", "nrows") else int(header[key])
                    if "ncols" not in header or "nrows" not in header or "cellsize" not in header:
                        raise ValueError(f"Incomplete ESRI ASCII grid header: {header}")
                    cell = float(header["cellsize"])
                    nx, ny = int(header["ncols"]), int(header["nrows"])
                    xmin = float(header.get("xllcorner", float(header.get("xllcenter", 0)) - cell / 2))
                    ymin = float(header.get("yllcorner", float(header.get("yllcenter", 0)) - cell / 2))
                    result.update({
                        "bounds_xmin": xmin, "bounds_ymin": ymin,
                        "bounds_xmax": xmin + nx * cell, "bounds_ymax": ymin + ny * cell,
                        "archive_valid": True,
                    })
                    if prj_match:
                        raw_prj = archive.read(prj_match).decode("utf-8", errors="replace")
                        result["prj_text"] = raw_prj[:2000]
            return result
        except (urllib.error.URLError, TimeoutError, OSError, zipfile.BadZipFile, ValueError, KeyError) as exc:
            last_error = str(exc)
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    result["error"] = last_error or "Unknown error"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--availability", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--max-mb", type=int, default=500)
    parser.add_argument("--batch-id", type=int, help="Optional manifest batch number; labels outputs for independent reruns")
    parser.add_argument("--resume", action="store_true", help="Reuse valid results from an earlier run and retry failed tiles")
    args = parser.parse_args()

    source = json.loads(args.availability.read_text(encoding="utf-8"))
    rows = [r for r in source.get("results", []) if r.get("available") is True]
    if not rows:
        parser.error("No available ZIPs in availability manifest")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    stem = f"mdt_2017_raster_inspection_batch-{args.batch_id:03d}" if args.batch_id else "mdt_2017_raster_inspection"
    json_path = args.output_dir / f"{stem}.json"
    cached = {}
    if args.resume and json_path.exists():
        previous = json.loads(json_path.read_text(encoding="utf-8"))
        url_by_sheet = {row["HOJA"]: row["url"] for row in rows}
        cached = {
            row["HOJA"]: row for row in previous.get("results", [])
            if row.get("archive_valid") is True and url_by_sheet.get(row.get("HOJA")) == row.get("url")
        }
    inspected = list(cached.values())
    pending = [row for row in rows if row["HOJA"] not in cached]

    def save_checkpoint():
        inspected.sort(key=lambda row: row["HOJA"])
        fields = list(inspected[0].keys()) if inspected else []
        with (args.output_dir / f"{stem}.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(inspected)
        good = [row for row in inspected if row["archive_valid"]]
        summary = {
            "checked_zip_count": len(inspected),
            "download_success_count": sum(row["download_ok"] for row in inspected),
            "valid_ascii_grid_archive_count": len(good),
            "failed_count": len(inspected) - len(good),
            "total_downloaded_bytes": sum(row["download_bytes"] or 0 for row in inspected),
            "cellsize_values": sorted({row["cellsize"] for row in good if row["cellsize"] is not None}),
            "crs_sidecar_count": sum(bool(row["prj_file"]) for row in good),
            "note": "ZIPs are temporary, SHA256 hashed and CRC-tested; ASCII-grid headers and PRJ sidecars are inspected, not raster pixels.",
            "results": inspected,
        }
        json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")

    save_checkpoint()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(download_and_inspect, row, args.timeout, args.retries, args.max_mb * 1024 * 1024) for row in pending]
        for future in concurrent.futures.as_completed(futures):
            inspected.append(future.result())
            save_checkpoint()
            print(f"Inspected {len(inspected)}/{len(rows)} ZIPs", flush=True)

    inspected.sort(key=lambda row: row["HOJA"])
    good = [row for row in inspected if row["archive_valid"]]
    summary = json.loads(json_path.read_text(encoding="utf-8"))
    return 0 if len(good) == len(inspected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
