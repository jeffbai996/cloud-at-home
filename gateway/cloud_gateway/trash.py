from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .database import Database


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class TrashEntry:
    id: str
    service_user: str
    original_path: str
    trash_path: str
    size: int
    deleted_at: datetime
    expires_at: datetime


def _entry(row) -> TrashEntry:
    return TrashEntry(
        row["id"], row["service_user"], row["original_path"], row["trash_path"],
        row["size"], datetime.fromisoformat(row["deleted_at"]),
        datetime.fromisoformat(row["expires_at"]),
    )


class TrashStore:
    def __init__(self, database: Database):
        self.database = database

    def add(
        self,
        *,
        service_user: str,
        original_path: str,
        trash_path: str,
        size: int,
        now: datetime | None = None,
        entry_id: str | None = None,
    ) -> TrashEntry:
        now = now or _utcnow()
        result = TrashEntry(
            entry_id or secrets.token_urlsafe(12), service_user, original_path, trash_path,
            max(0, size), now, now + timedelta(days=30),
        )
        with self.database.connect() as connection:
            connection.execute(
                "INSERT INTO trash VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    result.id, result.service_user, result.original_path, result.trash_path,
                    result.size, result.deleted_at.isoformat(), result.expires_at.isoformat(),
                ),
            )
        return result

    def get(self, entry_id: str, service_user: str) -> TrashEntry | None:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM trash WHERE id = ? AND service_user = ?",
                (entry_id, service_user),
            ).fetchone()
        return _entry(row) if row else None

    def list(self, service_user: str) -> list[TrashEntry]:
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM trash WHERE service_user = ? ORDER BY deleted_at DESC",
                (service_user,),
            ).fetchall()
        return [_entry(row) for row in rows]

    def expired(
        self,
        now: datetime | None = None,
        *,
        service_user: str | None = None,
    ) -> list[TrashEntry]:
        now = now or _utcnow()
        with self.database.connect() as connection:
            if service_user is None:
                rows = connection.execute(
                    "SELECT * FROM trash WHERE expires_at <= ? ORDER BY expires_at",
                    (now.isoformat(),),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM trash WHERE expires_at <= ? AND service_user = ? ORDER BY expires_at",
                    (now.isoformat(), service_user),
                ).fetchall()
        return [_entry(row) for row in rows]

    def remove(self, entry_id: str, service_user: str) -> None:
        with self.database.connect() as connection:
            connection.execute(
                "DELETE FROM trash WHERE id = ? AND service_user = ?",
                (entry_id, service_user),
            )
