from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet

from cloud_gateway.adapters import AuthResult, UpstreamResponse
from cloud_gateway.app import create_app


class FakeAdapter:
    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.logins: list[tuple[str, str]] = []
        self.response_status = 200

    def login(self, username: str, password: str) -> AuthResult:
        self.logins.append((username, password))
        assert password == "correct horse"
        return AuthResult("test-upstream-token", "user-1", username)

    def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
        self.requests.append({"token": token, "method": method, "path": path, **kwargs})
        return UpstreamResponse(
            status=self.response_status,
            headers={"Content-Type": "application/json"},
            body=b'{"path":"' + path.encode() + b'"}',
        )


def _app(tmp_path, adapters=None, config=None):
    settings = {
        "TESTING": True,
        "DATABASE_PATH": str(tmp_path / "state.db"),
        "SECRET_KEY": Fernet.generate_key().decode(),
        "COOKIE_SECURE": False,
        "MEDIA_AUTO_LOGIN_USERNAME": "",
        "MEDIA_AUTO_LOGIN_PASSWORD": "",
        "EXTRA_SERVICE_LABEL": "example-store",
        "EXTRA_SERVICE_URL": "https://server.example:8443/example",
    }
    settings.update(config or {})
    return create_app(
        settings,
        adapters=adapters or {"media": FakeAdapter(), "files": FakeAdapter()},
    )


def test_extra_service_navigation_uses_runtime_configuration(tmp_path) -> None:
    client = _app(tmp_path).test_client()
    metadata = client.get("/api/navigation/extra-service")
    response = client.get("/api/navigation/extra-service/open")

    assert metadata.json == {"label": "example-store", "href": "/api/navigation/extra-service/open"}
    assert response.status_code == 302
    assert response.headers["Location"] == "https://server.example:8443/example"


def test_login_returns_csrf_and_http_only_cookie(tmp_path) -> None:
    client = _app(tmp_path).test_client()
    response = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )

    assert response.status_code == 200
    assert response.json["user"] == {"id": "user-1", "name": "alice"}
    assert response.json["csrf"]
    cookie = response.headers["Set-Cookie"]
    assert "cloud-home_media_session=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=Strict" in cookie
    assert "test-upstream-token" not in response.text + cookie


def test_media_session_auto_logs_in_without_changing_files_auth(tmp_path) -> None:
    media = FakeAdapter()
    app = _app(
        tmp_path,
        {"media": media, "files": FakeAdapter()},
        {"MEDIA_AUTO_LOGIN_USERNAME": "viewer", "MEDIA_AUTO_LOGIN_PASSWORD": "correct horse"},
    )
    client = app.test_client()

    response = client.get("/api/auth/media/session")

    assert response.status_code == 200
    assert response.json["user"] == {"id": "user-1", "name": "viewer"}
    assert media.logins == [("viewer", "correct horse")]
    assert "cloud-home_media_session=" in response.headers["Set-Cookie"]
    assert app.test_client().get("/api/auth/files/session").status_code == 401


def test_media_session_replaces_an_upstream_rejected_cookie(tmp_path) -> None:
    media = FakeAdapter()
    app = _app(
        tmp_path,
        {"media": media, "files": FakeAdapter()},
        {"MEDIA_AUTO_LOGIN_USERNAME": "viewer", "MEDIA_AUTO_LOGIN_PASSWORD": "correct horse"},
    )
    client = app.test_client()
    assert client.post(
        "/api/auth/media/login",
        json={"username": "viewer", "password": "correct horse"},
    ).status_code == 200
    media.response_status = 401

    response = client.get("/api/auth/media/session")

    assert response.status_code == 200
    assert media.logins == [("viewer", "correct horse"), ("viewer", "correct horse")]
    assert "cloud-home_media_session=" in response.headers["Set-Cookie"]


def test_state_changing_proxy_requires_csrf(tmp_path) -> None:
    client = _app(tmp_path).test_client()
    login = client.post(
        "/api/auth/files/login",
        json={"username": "alice", "password": "correct horse"},
    )
    assert client.patch("/api/files/proxy/resources/a").status_code == 403
    response = client.patch(
        "/api/files/proxy/resources/a",
        headers={"X-CSRF-Token": login.json["csrf"]},
    )
    assert response.status_code == 200


def test_json_proxy_buffers_body_and_recalculates_content_length(tmp_path) -> None:
    media = FakeAdapter()
    app = _app(tmp_path, {"media": media, "files": FakeAdapter()})
    client = app.test_client()
    login = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )

    response = client.post(
        "/api/media/proxy/Items/example123/PlaybackInfo",
        json={"UserId": "user-1", "EnableDirectPlay": True},
        headers={"X-CSRF-Token": login.json["csrf"]},
    )

    assert response.status_code == 200
    forwarded = media.requests[-1]
    assert isinstance(forwarded["data"], bytes)
    assert forwarded["data"] == b'{"EnableDirectPlay": true, "UserId": "user-1"}'
    assert not any(key.lower() == "content-length" for key in forwarded["headers"])


def test_large_proxy_body_stays_streamed_with_content_length(tmp_path) -> None:
    files = FakeAdapter()
    app = _app(tmp_path, {"media": FakeAdapter(), "files": files})
    client = app.test_client()
    login = client.post(
        "/api/auth/files/login",
        json={"username": "alice", "password": "correct horse"},
    )
    payload = b"x" * (2 * 1024 * 1024 + 1)

    response = client.post(
        "/api/files/proxy/resources/example.bin",
        data=payload,
        headers={"X-CSRF-Token": login.json["csrf"]},
    )

    assert response.status_code == 200
    forwarded = files.requests[-1]
    assert not isinstance(forwarded["data"], bytes)
    assert forwarded["headers"]["Content-Length"] == str(len(payload))


def test_preferences_round_trip_is_scoped_to_authenticated_user(tmp_path) -> None:
    client = _app(tmp_path).test_client()
    login = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )
    saved = client.put(
        "/api/preferences/media",
        json={"theme": "oled", "captions": {"fontSize": 140}},
        headers={"X-CSRF-Token": login.json["csrf"]},
    )
    assert saved.status_code == 200
    assert client.get("/api/preferences/media").json["theme"] == "oled"


def test_listing_trash_purges_expired_upstream_entries(tmp_path) -> None:
    app = _app(tmp_path)
    client = app.test_client()
    client.post(
        "/api/auth/files/login",
        json={"username": "alice", "password": "correct horse"},
    )
    store = app.extensions["cloud-home"]["trash"]
    entry = store.add(
        service_user="user-1",
        original_path="/old.txt",
        trash_path="/.cloud-home-trash/example/old.txt",
        size=1,
        now=datetime.now(timezone.utc) - timedelta(days=31),
    )

    response = client.get("/api/files/trash")

    assert response.status_code == 200
    assert response.json == []
    assert store.get(entry.id, "user-1") is None
