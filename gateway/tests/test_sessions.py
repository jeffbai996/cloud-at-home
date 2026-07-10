from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet

from cloud_gateway.database import Database
from cloud_gateway.sessions import SessionStore, TokenVault


def test_session_store_encrypts_token_and_expires_sessions(tmp_path) -> None:
    db = Database(tmp_path / "state.db")
    vault = TokenVault(Fernet.generate_key().decode())
    store = SessionStore(db, vault)
    now = datetime.now(timezone.utc)

    session = store.create(
        service="media",
        token="example-token",
        user_id="user-1",
        username="alice",
        now=now,
        ttl=timedelta(hours=1),
    )

    assert b"upstream-token-that-must-not-appear" not in (tmp_path / "state.db").read_bytes()
    loaded = store.get(session.id, "media", now=now)
    assert loaded is not None
    assert loaded.token == "example-token"
    assert store.get(session.id, "media", now=now + timedelta(hours=2)) is None


def test_session_is_scoped_to_service(tmp_path) -> None:
    store = SessionStore(
        Database(tmp_path / "state.db"),
        TokenVault(Fernet.generate_key().decode()),
    )
    session = store.create(
        service="files",
        token="example-token",
        user_id="1",
        username="alice",
    )
    assert store.get(session.id, "media") is None
