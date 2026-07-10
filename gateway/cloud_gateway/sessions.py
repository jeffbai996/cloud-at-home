from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken

from .database import Database


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class TokenVault:
    def __init__(self, key: str):
        try:
            self._fernet = Fernet(key.encode())
        except (TypeError, ValueError) as exc:
            raise ValueError("CLOUD_HOME_SECRET_KEY must be a valid Fernet key") from exc

    def encrypt(self, value: str) -> bytes:
        return self._fernet.encrypt(value.encode())

    def decrypt(self, value: bytes) -> str:
        return self._fernet.decrypt(value).decode()


@dataclass(frozen=True)
class Session:
    id: str
    service: str
    token: str
    user_id: str
    username: str
    csrf_token: str
    expires_at: datetime


class SessionStore:
    def __init__(self, database: Database, vault: TokenVault):
        self.database = database
        self.vault = vault

    def create(
        self,
        *,
        service: str,
        token: str,
        user_id: str,
        username: str,
        now: datetime | None = None,
        ttl: timedelta = timedelta(days=30),
    ) -> Session:
        now = now or _utcnow()
        session_id = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(24)
        expires_at = now + ttl
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO sessions (
                    id_hash, service, token_ciphertext, user_id, username,
                    csrf_token, expires_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _hash(session_id), service, self.vault.encrypt(token), user_id,
                    username, csrf_token, expires_at.isoformat(), now.isoformat(),
                ),
            )
        return Session(session_id, service, token, user_id, username, csrf_token, expires_at)

    def get(
        self,
        session_id: str,
        service: str,
        *,
        now: datetime | None = None,
    ) -> Session | None:
        if not session_id:
            return None
        now = now or _utcnow()
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE id_hash = ? AND service = ?",
                (_hash(session_id), service),
            ).fetchone()
            if row is None:
                return None
            expires_at = datetime.fromisoformat(row["expires_at"])
            if expires_at <= now:
                connection.execute("DELETE FROM sessions WHERE id_hash = ?", (_hash(session_id),))
                return None
        try:
            token = self.vault.decrypt(row["token_ciphertext"])
        except InvalidToken:
            return None
        return Session(
            session_id, row["service"], token, row["user_id"], row["username"],
            row["csrf_token"], expires_at,
        )

    def delete(self, session_id: str, service: str) -> None:
        if not session_id:
            return
        with self.database.connect() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE id_hash = ? AND service = ?",
                (_hash(session_id), service),
            )
