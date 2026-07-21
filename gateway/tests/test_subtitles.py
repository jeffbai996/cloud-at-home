from __future__ import annotations

from cloud_gateway.subtitles import normalize_vtt


def test_normalize_vtt_removes_jellyfin_regions_that_break_safari() -> None:
    source = (
        b"\xef\xbb\xbfWEBVTT\r\n\r\n"
        b"Region: id:subtitle width:80% lines:3\r\n\r\n"
        b"00:01:38.285 --> 00:01:41.285 region:subtitle line:90%\r\n"
        b"You are live.\r\n"
    )

    assert normalize_vtt(source) == (
        b"WEBVTT\n\n"
        b"00:01:38.285 --> 00:01:41.285 line:90%\n"
        b"You are live.\n"
    )
