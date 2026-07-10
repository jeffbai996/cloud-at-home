from __future__ import annotations

import hashlib
import posixpath
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from cryptography.fernet import InvalidToken

from .database import Database
from .sessions import TokenVault


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class StreamTicket:
    id: str
    token: str
    item_id: str
    expires_at: datetime


class StreamTicketStore:
    def __init__(self, database: Database, vault: TokenVault):
        self.database = database
        self.vault = vault

    def create(
        self,
        *,
        token: str,
        item_id: str,
        now: datetime | None = None,
    ) -> StreamTicket:
        now = now or _utcnow()
        ticket_id = secrets.token_urlsafe(32)
        result = StreamTicket(ticket_id, token, item_id, now + timedelta(hours=6))
        with self.database.connect() as connection:
            connection.execute(
                "INSERT INTO stream_tickets VALUES (?, ?, ?, ?, ?)",
                (
                    _hash(ticket_id), self.vault.encrypt(token), item_id,
                    result.expires_at.isoformat(), now.isoformat(),
                ),
            )
        return result

    def get(
        self,
        ticket_id: str,
        item_id: str,
        *,
        now: datetime | None = None,
    ) -> StreamTicket | None:
        if not ticket_id or not item_id:
            return None
        now = now or _utcnow()
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM stream_tickets WHERE id_hash = ? AND item_id = ?",
                (_hash(ticket_id), item_id),
            ).fetchone()
            if row is None:
                return None
            expires_at = datetime.fromisoformat(row["expires_at"])
            if expires_at <= now:
                connection.execute("DELETE FROM stream_tickets WHERE id_hash = ?", (_hash(ticket_id),))
                return None
        try:
            token = self.vault.decrypt(row["token_ciphertext"])
        except InvalidToken:
            return None
        return StreamTicket(ticket_id, token, item_id, expires_at)


def rewrite_hls_playlist(playlist: str, *, upstream_path: str, public_prefix: str) -> str:
    """Route every HLS child resource back through the scoped public ticket."""
    base = posixpath.dirname(upstream_path)
    prefix = public_prefix.rstrip("/") + "/"

    def public_uri(value: str) -> str:
        parsed = urlsplit(value)
        raw_path = parsed.path
        if raw_path.startswith("/"):
            normalized = posixpath.normpath(raw_path).lstrip("/")
        else:
            normalized = posixpath.normpath(posixpath.join(base, raw_path)).lstrip("/")
        query = f"?{parsed.query}" if parsed.query else ""
        return prefix + normalized + query

    output: list[str] = []
    uri_pattern = re.compile(r'URI="([^"]+)"')
    for line in playlist.splitlines():
        if line.startswith("#"):
            line = uri_pattern.sub(lambda match: f'URI="{public_uri(match.group(1))}"', line)
        elif line.strip():
            line = public_uri(line.strip())
        output.append(line)
    return "\n".join(output) + ("\n" if playlist.endswith("\n") else "")
