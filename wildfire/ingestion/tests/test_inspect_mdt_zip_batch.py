from __future__ import annotations

import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "inspect_mdt_zip_batch.py"
SPEC = importlib.util.spec_from_file_location("inspect_mdt_zip_batch", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_resume_reuses_only_successful_rows_with_matching_source_url():
    rows = [
        {"HOJA": "A", "url": "https://example.test/a.zip"},
        {"HOJA": "B", "url": "https://example.test/b.zip"},
    ]
    previous = [
        {"HOJA": "A", "url": "https://example.test/a.zip", "archive_valid": True},
        {"HOJA": "B", "url": "https://example.test/old-b.zip", "archive_valid": True},
        {"HOJA": "C", "url": "https://example.test/c.zip", "archive_valid": True},
        {"HOJA": "B", "url": "https://example.test/b.zip", "archive_valid": False},
    ]

    assert MODULE.select_resumable_results(rows, previous) == {
        "A": previous[0],
    }


def test_resume_returns_empty_for_no_successful_prior_results():
    rows = [{"HOJA": "A", "url": "https://example.test/a.zip"}]
    previous = [{"HOJA": "A", "url": rows[0]["url"], "archive_valid": False}]

    assert MODULE.select_resumable_results(rows, previous) == {}
