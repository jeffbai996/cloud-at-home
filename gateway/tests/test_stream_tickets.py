from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet

from cloud_gateway.database import Database
from cloud_gateway.sessions import TokenVault
from cloud_gateway.stream_tickets import StreamTicketStore, rewrite_hls_playlist


def test_stream_ticket_is_item_scoped_encrypted_and_expires(tmp_path) -> None:
    database = Database(tmp_path / "state.db")
    store = StreamTicketStore(database, TokenVault(Fernet.generate_key().decode()))
    now = datetime(2026, 7, 10, tzinfo=timezone.utc)
    ticket = store.create(token="jellyfin-token", item_id="item-1", now=now)

    assert b"jellyfin-token" not in (tmp_path / "state.db").read_bytes()
    assert store.get(ticket.id, "item-1", now=now) == ticket
    assert store.get(ticket.id, "item-2", now=now) is None
    assert store.get(ticket.id, "item-1", now=now + timedelta(hours=7)) is None


def test_hls_rewriter_scopes_relative_absolute_and_attribute_urls() -> None:
    playlist = """#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,URI=\"subs/main.m3u8\"
#EXT-X-MAP:URI=\"/videos/item-1/init.mp4\"
segment-001.ts?token=upstream
"""
    result = rewrite_hls_playlist(
        playlist,
        upstream_path="videos/item-1/master/main.m3u8",
        public_prefix="/api/media/stream/ticket-1/",
    )

    assert 'URI="/api/media/stream/ticket-1/videos/item-1/master/subs/main.m3u8"' in result
    assert 'URI="/api/media/stream/ticket-1/videos/item-1/init.mp4"' in result
    assert "/api/media/stream/ticket-1/videos/item-1/master/segment-001.ts?token=upstream" in result
