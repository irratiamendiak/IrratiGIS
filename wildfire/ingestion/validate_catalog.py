"""Validate provenance metadata for the wildfire source catalogue (stdlib only)."""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

REQUIRED = {"id", "theme", "title", "publisher", "landing_page", "format",
            "reference_date", "status", "spatial_role", "known_limitations",
            "attribution", "license", "checksum_sha256"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")

def validate_catalog(data: dict) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["catalog root must be an object"]
    if not isinstance(data.get("pilot"), dict):
        errors.append("pilot must be an object")
    sources = data.get("sources")
    if not isinstance(sources, list) or not sources:
        return errors + ["sources must be a non-empty array"]
    seen: set[str] = set()
    for index, source in enumerate(sources):
        prefix = f"sources[{index}]"
        if not isinstance(source, dict):
            errors.append(f"{prefix} must be an object")
            continue
        missing = sorted(REQUIRED - source.keys())
        if missing:
            errors.append(f"{prefix} missing fields: {', '.join(missing)}")
            continue
        source_id = source["id"]
        if not isinstance(source_id, str) or not source_id.strip():
            errors.append(f"{prefix}.id must be a non-empty string")
        elif source_id in seen:
            errors.append(f"duplicate source id: {source_id}")
        else:
            seen.add(source_id)
        parsed = urlparse(str(source["landing_page"]))
        if parsed.scheme != "https" or not parsed.netloc:
            errors.append(f"{prefix}.landing_page must be an HTTPS URL")
        distribution = source.get("distribution_url")
        if distribution is not None:
            parsed = urlparse(str(distribution))
            if parsed.scheme != "https" or not parsed.netloc:
                errors.append(f"{prefix}.distribution_url must be null or HTTPS")
        if not isinstance(source["known_limitations"], list):
            errors.append(f"{prefix}.known_limitations must be an array")
        for field in ("title", "publisher", "format", "reference_date", "status",
                      "spatial_role", "attribution", "license"):
            if not isinstance(source[field], str) or not source[field].strip():
                errors.append(f"{prefix}.{field} must be a non-empty string")
        checksum = source["checksum_sha256"]
        if checksum is not None and (not isinstance(checksum, str) or not SHA256.fullmatch(checksum)):
            errors.append(f"{prefix}.checksum_sha256 must be null or 64 lowercase hex characters")
    return errors

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True, type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(args.catalog.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Cannot read catalogue: {exc}", file=sys.stderr)
        return 2
    errors = validate_catalog(data)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Catalogue valid: {len(data['sources'])} sources; pilot={data['pilot'].get('name', 'unspecified')}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
