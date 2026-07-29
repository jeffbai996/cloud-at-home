from __future__ import annotations

import base64
import json

from cloud_gateway.adapters import (
    FileBrowserAdapter, JellyfinAdapter, filebrowser_identity,
)


def _token(payload: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


def test_filebrowser_identity_comes_from_authenticated_token() -> None:
    token = _token({"user": {"id": 7, "username": "alice"}})

    assert filebrowser_identity(token, "fallback") == ("7", "alice")


def test_filebrowser_identity_falls_back_for_legacy_tokens() -> None:
    assert filebrowser_identity("not-a-jwt", "alice") == ("alice", "alice")


def test_jellyfin_logins_use_unique_device_ids(monkeypatch) -> None:
    headers: list[str] = []

    class Response:
        status_code = 200

        @staticmethod
        def json() -> dict:
            return {"AccessToken": "token", "User": {"Id": "user-1", "Name": "alice"}}

    def fake_post(*_args, **kwargs):
        headers.append(kwargs["headers"]["X-Emby-Authorization"])
        return Response()

    monkeypatch.setattr("cloud_gateway.adapters.requests.post", fake_post)
    adapter = JellyfinAdapter("http://jellyfin.example")

    adapter.login("alice", "secret")
    adapter.login("alice", "secret")

    assert headers[0] != headers[1]
    assert all('DeviceId="cloud-at-home-web-' in header for header in headers)


def test_logins_get_the_full_read_budget(monkeypatch) -> None:
    """`timeout` is a (connect, read) pair. Login passed only the connect
    element, so the whole request was capped at 5s — and a Jellyfin that had
    been paged out took 13-25s to answer, which the gateway reported as
    "Jellyfin is unavailable" and Video showed as a network error against a
    server that was merely slow."""
    seen: list[object] = []

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"AccessToken": "t", "User": {"Id": "1", "Name": "alice"}}

    def fake_post(url, **kwargs):
        seen.append(kwargs["timeout"])
        return Response()

    monkeypatch.setattr("cloud_gateway.adapters.requests.post", fake_post)
    adapter = JellyfinAdapter("http://jellyfin.example", timeout=(5, 120))
    adapter.login("alice", "correct horse")

    assert seen == [(5, 120)]


def test_filebrowser_login_gets_the_full_read_budget(monkeypatch) -> None:
    seen: list[object] = []

    class Response:
        status_code = 200
        text = "not-a-jwt"

    def fake_post(url, **kwargs):
        seen.append(kwargs["timeout"])
        return Response()

    monkeypatch.setattr("cloud_gateway.adapters.requests.post", fake_post)
    FileBrowserAdapter("http://files.example", timeout=(5, 120)).login("alice", "pw")

    assert seen == [(5, 120)]
