from __future__ import annotations

from typing import Any


TICKS_PER_SECOND = 10_000_000


def jellyfin_progress_payload(
    *,
    item_id: str,
    media_source_id: str,
    play_session_id: str,
    seconds: float,
    paused: bool,
    muted: bool,
    volume: int,
    method: str,
) -> dict[str, Any]:
    return {
        "ItemId": item_id,
        "MediaSourceId": media_source_id,
        "PlaySessionId": play_session_id,
        "PositionTicks": max(0, round(seconds * TICKS_PER_SECOND)),
        "IsPaused": paused,
        "IsMuted": muted,
        "VolumeLevel": min(max(volume, 0), 100),
        "PlayMethod": method,
        "CanSeek": True,
    }
