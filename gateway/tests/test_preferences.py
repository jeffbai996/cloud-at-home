from __future__ import annotations

import pytest

from cloud_gateway.preferences import DEFAULT_PREFERENCES, merge_preferences


def test_preferences_default_to_noir_and_accessible_caption_values() -> None:
    assert DEFAULT_PREFERENCES["theme"] == "noir"
    assert DEFAULT_PREFERENCES["captions"]["fontSize"] == 75
    assert DEFAULT_PREFERENCES["captions"]["lineHeight"] == 1.53


def test_merge_preferences_keeps_unknown_or_invalid_values_out() -> None:
    merged = merge_preferences({
        "theme": "laser-beige",
        "motion": "reduced",
        "captions": {"fontSize": 999, "offset": 12, "evil": "value"},
        "admin": True,
    })

    assert merged["theme"] == "noir"
    assert merged["motion"] == "reduced"
    assert merged["captions"]["fontSize"] == 200
    assert merged["captions"]["offset"] == 12
    assert "evil" not in merged["captions"]
    assert "admin" not in merged
