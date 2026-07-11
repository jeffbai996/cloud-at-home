from __future__ import annotations

from copy import deepcopy
from typing import Any


DEFAULT_PREFERENCES: dict[str, Any] = {
    "theme": "noir",
    "motion": "full",
    "view": "grid",
    "captions": {
        "fontFamily": "Inter",
        "fontSize": 75,
        "fontWeight": 600,
        "lineHeight": 1.25,
        "letterSpacing": 0,
        "offset": 8,
        "color": "#ffffff",
        "backgroundOpacity": 0.72,
        "outline": 2,
    },
}


def _number(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return min(max(float(value), minimum), maximum)
    return fallback


def merge_preferences(candidate: object) -> dict[str, Any]:
    """Validate user-controlled preference JSON against a small allowlist."""
    merged = deepcopy(DEFAULT_PREFERENCES)
    if not isinstance(candidate, dict):
        return merged
    if candidate.get("theme") in {"noir", "oled"}:
        merged["theme"] = candidate["theme"]
    if candidate.get("motion") in {"full", "reduced"}:
        merged["motion"] = candidate["motion"]
    if candidate.get("view") in {"grid", "list"}:
        merged["view"] = candidate["view"]

    captions = candidate.get("captions")
    if not isinstance(captions, dict):
        return merged
    defaults = DEFAULT_PREFERENCES["captions"]
    if captions.get("fontFamily") in {"Inter", "Plus Jakarta Sans", "system-ui"}:
        merged["captions"]["fontFamily"] = captions["fontFamily"]
    merged["captions"].update({
        "fontSize": int(_number(captions.get("fontSize"), 0, 200, defaults["fontSize"])),
        "fontWeight": int(_number(captions.get("fontWeight"), 400, 800, defaults["fontWeight"])),
        "lineHeight": _number(captions.get("lineHeight"), 1, 2, defaults["lineHeight"]),
        "letterSpacing": _number(captions.get("letterSpacing"), -2, 8, defaults["letterSpacing"]),
        "offset": int(_number(captions.get("offset"), -20, 30, defaults["offset"])),
        "backgroundOpacity": _number(
            captions.get("backgroundOpacity"), 0, 1, defaults["backgroundOpacity"]
        ),
        "outline": int(_number(captions.get("outline"), 0, 6, defaults["outline"])),
    })
    color = captions.get("color")
    if isinstance(color, str) and len(color) == 7 and color.startswith("#"):
        try:
            int(color[1:], 16)
        except ValueError:
            pass
        else:
            merged["captions"]["color"] = color.lower()
    return merged
