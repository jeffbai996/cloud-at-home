from __future__ import annotations

import base64
import json

from cloud_gateway.adapters import filebrowser_identity


def _token(payload: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


def test_filebrowser_identity_comes_from_authenticated_token() -> None:
    token = _token({"user": {"id": 7, "username": "alice"}})

    assert filebrowser_identity(token, "fallback") == ("7", "alice")


def test_filebrowser_identity_falls_back_for_legacy_tokens() -> None:
    assert filebrowser_identity("not-a-jwt", "alice") == ("alice", "alice")
