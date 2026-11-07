from __future__ import annotations

import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "prepare_mdt_batches.py"
SPEC = importlib.util.spec_from_file_location("prepare_mdt_batches", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_build_batches_sorts_and_excludes_unavailable_rows():
    rows = [
        {"HOJA": "040-3-1", "available": True},
        {"HOJA": "040-1-1", "available": False},
        {"HOJA": "040-2-1", "available": True},
        {"HOJA": "040-1-1", "available": True},
    ]

    batches = MODULE.build_batches(rows, 2)

    assert [[row["HOJA"] for row in batch] for batch in batches] == [
        ["040-1-1", "040-2-1"],
        ["040-3-1"],
    ]


def test_build_batches_handles_exact_multiple_and_single_batch():
    rows = [{"HOJA": f"tile-{i:02}", "available": True} for i in range(4)]

    assert [len(batch) for batch in MODULE.build_batches(rows, 2)] == [2, 2]
    assert [len(batch) for batch in MODULE.build_batches(rows, 10)] == [4]


def test_build_batches_rejects_nonpositive_size():
    try:
        MODULE.build_batches([], 0)
    except ValueError as exc:
        assert "batch_size" in str(exc)
    else:
        raise AssertionError("Expected ValueError")
