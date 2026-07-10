from __future__ import annotations

from datetime import datetime
from pathlib import PurePosixPath


def normalize_virtual_path(value: str) -> str:
    """Normalize a FileBrowser path without allowing a scope escape."""
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError("invalid path")
    raw = value.replace("\\", "/")
    parts: list[str] = []
    for part in raw.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            raise ValueError("path traversal is not allowed")
        parts.append(part)
    return "/" + "/".join(parts) if parts else "/"


def restored_name(name: str, now: datetime) -> str:
    """Return a conflict-safe restore name while preserving file extensions."""
    path = PurePosixPath(name)
    suffix = "".join(path.suffixes)
    stem = name[:-len(suffix)] if suffix else name
    stamp = now.strftime("%Y-%m-%d %H%M")
    return f"{stem} (restored {stamp}){suffix}"
