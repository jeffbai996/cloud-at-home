from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cloud_gateway.database import Database
from cloud_gateway.trash import TrashStore


def test_trash_entries_expire_after_thirty_days(tmp_path) -> None:
    store = TrashStore(Database(tmp_path / "state.db"))
    now = datetime(2026, 7, 10, tzinfo=timezone.utc)
    entry = store.add(
        service_user="alice",
        original_path="/documents/report.pdf",
        trash_path="/.cloud-home-trash/id/report.pdf",
        size=42,
        now=now,
    )

    assert entry.expires_at == now + timedelta(days=30)
    assert store.get(entry.id, "alice") == entry
    assert store.expired(now + timedelta(days=29)) == []
    assert store.expired(now + timedelta(days=31)) == [entry]


def test_trash_entries_cannot_cross_users(tmp_path) -> None:
    store = TrashStore(Database(tmp_path / "state.db"))
    entry = store.add(
        service_user="alice",
        original_path="/notes.txt",
        trash_path="/.cloud-home-trash/id/notes.txt",
        size=1,
    )
    assert store.get(entry.id, "bob") is None
