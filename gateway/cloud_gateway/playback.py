from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit


TICKS_PER_SECOND = 10_000_000
_SENSITIVE_STREAM_QUERY_KEYS = {
    "api_key",
    "apikey",
    "token",
    "access_token",
    "x_emby_token",
    "xembytoken",
}


def _public_stream_path(value: object) -> str | None:
    """Keep only same-upstream video routes whose auth is held by a ticket."""
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    path = parsed.path.lstrip("/")
    if not path.startswith(("Videos/", "videos/")):
        return None
    query = urlencode([
        (key, query_value)
        for key, query_value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower().replace("-", "_") not in _SENSITIVE_STREAM_QUERY_KEYS
    ])
    return f"{path}?{query}" if query else path


def _public_media_stream(stream: object) -> dict[str, Any] | None:
    if not isinstance(stream, Mapping):
        return None
    result: dict[str, Any] = {}
    for key in (
        "Index", "Type", "DisplayTitle", "Language", "Codec", "Profile", "BitDepth",
        "RealFrameRate", "AverageFrameRate", "BitRate", "Channels", "SampleRate", "Width",
        "Height", "IsDefault", "IsExternal",
    ):
        value = stream.get(key)
        if isinstance(value, (str, int, float, bool)):
            result[key] = value
    return result if result else None


def _public_trickplay(value: object) -> dict[str, dict[str, dict[str, int | float]]]:
    if not isinstance(value, Mapping):
        return {}
    result: dict[str, dict[str, dict[str, int | float]]] = {}
    fields = (
        "Width", "Height", "TileWidth", "TileHeight", "ThumbnailCount", "Interval", "Bandwidth",
    )
    for item_id, raw_widths in value.items():
        if not isinstance(item_id, str) or not isinstance(raw_widths, Mapping):
            continue
        widths: dict[str, dict[str, int | float]] = {}
        for width, raw_details in raw_widths.items():
            if not isinstance(width, str) or not isinstance(raw_details, Mapping):
                continue
            details = {
                field: field_value for field in fields
                if isinstance(field_value := raw_details.get(field), (int, float))
            }
            if details:
                widths[width] = details
        if widths:
            result[item_id] = widths
    return result


def sanitize_playback_info(payload: object) -> dict[str, Any]:
    """Return the minimal browser playback contract without upstream internals."""
    if not isinstance(payload, Mapping):
        raise ValueError("invalid playback response")
    play_session_id = payload.get("PlaySessionId")
    raw_sources = payload.get("MediaSources")
    if not isinstance(play_session_id, str) or not play_session_id or not isinstance(raw_sources, list):
        raise ValueError("invalid playback response")
    result: dict[str, Any] = {"PlaySessionId": play_session_id}

    sources: list[dict[str, Any]] = []
    for raw_source in raw_sources:
        if not isinstance(raw_source, Mapping):
            continue
        source_id = raw_source.get("Id")
        if not isinstance(source_id, str):
            continue
        source: dict[str, Any] = {
            "Id": source_id,
            "SupportsDirectPlay": raw_source.get("SupportsDirectPlay") is True,
            "SupportsTranscoding": raw_source.get("SupportsTranscoding") is True,
        }
        container = raw_source.get("Container")
        if isinstance(container, str):
            source["Container"] = container
        transcoding_url = _public_stream_path(raw_source.get("TranscodingUrl"))
        if transcoding_url is not None:
            source["TranscodingUrl"] = transcoding_url
        trickplay = _public_trickplay(raw_source.get("Trickplay"))
        if trickplay:
            source["Trickplay"] = trickplay
        streams = [
            clean_stream for raw_stream in raw_source.get("MediaStreams", [])
            if (clean_stream := _public_media_stream(raw_stream)) is not None
        ] if isinstance(raw_source.get("MediaStreams"), list) else []
        if streams:
            source["MediaStreams"] = streams
        sources.append(source)
    result["MediaSources"] = sources
    return result


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
