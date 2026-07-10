from __future__ import annotations

from cloud_gateway.playback import jellyfin_progress_payload


def test_progress_payload_uses_jellyfin_ticks_and_expected_state() -> None:
    payload = jellyfin_progress_payload(
        item_id="episode-1",
        media_source_id="source-1",
        play_session_id="session-1",
        seconds=12.345,
        paused=False,
        muted=True,
        volume=42,
        method="Transcode",
    )

    assert payload["PositionTicks"] == 123_450_000
    assert payload["IsPaused"] is False
    assert payload["IsMuted"] is True
    assert payload["VolumeLevel"] == 42
    assert payload["PlayMethod"] == "Transcode"
