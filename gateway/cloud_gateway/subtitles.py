from __future__ import annotations

import re


_REGION_HEADER = re.compile(r"(?m)^Region:[^\n]*\n+")
_CUE_REGION = re.compile(r"(?m)(^\S+[ \t]+-->[ \t]+\S+[^\n]*?)[ \t]+region:\S+")


def normalize_vtt(value: bytes) -> bytes:
    """Return conservative WebVTT that Safari and AVKit both accept."""
    text = value.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    text = _REGION_HEADER.sub("", text)
    text = _CUE_REGION.sub(r"\1", text)
    if not text.startswith("WEBVTT"):
        raise ValueError("invalid WebVTT")
    return text.encode("utf-8")
