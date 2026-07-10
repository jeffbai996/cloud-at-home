from __future__ import annotations

from datetime import datetime, timezone

import pytest

from cloud_gateway.paths import normalize_virtual_path, restored_name


@pytest.mark.parametrize(
    "value, expected",
    [
        ("/", "/"),
        ("/TV Shows/Season 01", "/TV Shows/Season 01"),
        ("TV Shows//Season 01/", "/TV Shows/Season 01"),
        ("/a/./b", "/a/b"),
    ],
)
def test_normalize_virtual_path_accepts_safe_paths(value: str, expected: str) -> None:
    assert normalize_virtual_path(value) == expected


@pytest.mark.parametrize("value", ["../etc", "/a/../../etc", "a\\..\\secret", "\x00bad"])
def test_normalize_virtual_path_rejects_escape_attempts(value: str) -> None:
    with pytest.raises(ValueError):
        normalize_virtual_path(value)


def test_restore_conflict_name_is_deterministic_and_preserves_extension() -> None:
    now = datetime(2026, 7, 10, 8, 45, tzinfo=timezone.utc)
    assert restored_name("notes.md", now) == "notes (restored 2026-07-10 0845).md"
    assert restored_name("folder", now) == "folder (restored 2026-07-10 0845)"
