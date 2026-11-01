#!/usr/bin/env python3
"""Publish vector tiles from a GDAL MBTiles file to Supabase Storage.

Usage (PowerShell):
  $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
  python publish_forest_tiles.py forestal_gipuzkoa.mbtiles forestal-gipuzkoa

Create the bucket named by the second argument in Supabase Storage and make it
public first. Keep the service-role key local; never commit it or expose it in
browser code. The script uploads XYZ paths: z/x/y.pbf (MBTiles rows are TMS).
"""
import gzip
import os
import sqlite3
import sys
import urllib.error
import urllib.request

if len(sys.argv) != 3:
    raise SystemExit("Usage: python publish_forest_tiles.py <file.mbtiles> <bucket>")
mbtiles, bucket = sys.argv[1:]
base = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
conn = sqlite3.connect(mbtiles)
rows = conn.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles ORDER BY zoom_level").fetchall()
if not rows:
    raise SystemExit("No tiles found in the MBTiles file.")

for i, (z, x, tms_y, data) in enumerate(rows, 1):
    xyz_y = (1 << z) - 1 - tms_y
    path = f"{z}/{x}/{xyz_y}.pbf"
    # GDAL MBTiles may store gzip-compressed MVT payloads; Storage serves the
    # object bytes as-is, so publish the decoded protobuf for Leaflet.VectorGrid.
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    url = f"{base}/storage/v1/object/{bucket}/{path}"
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/vnd.mapbox-vector-tile",
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            response.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit(f"Upload failed at {path}: HTTP {e.code}: {detail}") from e
    if i % 50 == 0 or i == len(rows):
        print(f"Uploaded {i}/{len(rows)} tiles")
print(f"Done: {len(rows)} tiles uploaded to {base}/storage/v1/object/public/{bucket}/")
