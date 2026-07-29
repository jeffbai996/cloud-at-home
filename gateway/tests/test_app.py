from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet
from requests.exceptions import ChunkedEncodingError

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


class FakeHttpResponse:
    def __init__(self, payload=None, content: bytes = b"", status: int = 200) -> None:
        self._payload = payload
        self.content = content
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


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

    assert metadata.json == {
        "label": "example-store",
        "href": "/api/navigation/extra-service/open",
    }
    assert response.status_code == 302
    assert response.headers["Location"] == "https://server.example:8443/example"



def test_photos_upload_is_confined_to_library_root(tmp_path) -> None:
    files = FakeAdapter()
    client = _app(tmp_path, {
        "media": FakeAdapter(), "files": files, "photos": FakeAdapter(),
    }).test_client()
    login = client.post("/api/auth/files/login", json={
        "username": "alice", "password": "correct horse",
    })
    headers = {"X-CSRF-Token": login.json["csrf"], "Content-Type": "image/jpeg"}
    allowed = client.post("/api/photos/upload/photos/trip/a.jpg", data=b"jpg", headers=headers)
    blocked = client.post("/api/photos/upload/documents/a.jpg", data=b"jpg", headers=headers)
    assert allowed.status_code == 200
    assert blocked.status_code == 400
    assert files.requests[-1]["path"] == "api/resources/photos/trip/a.jpg?override=false"


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


def test_file_save_forwards_optimistic_concurrency_headers(tmp_path) -> None:
    files = FakeAdapter()
    app = _app(tmp_path, {"media": FakeAdapter(), "files": files})
    client = app.test_client()
    login = client.post(
        "/api/auth/files/login",
        json={"username": "alice", "password": "correct horse"},
    )

    response = client.put(
        "/api/files/proxy/resources/notes.txt",
        data="updated",
        headers={"X-CSRF-Token": login.json["csrf"], "If-Match": '"example-etag"'},
    )

    assert response.status_code == 200
    assert files.requests[-1]["headers"]["If-Match"] == '"example-etag"'


def test_json_proxy_buffers_body_and_recalculates_content_length(tmp_path) -> None:
    media = FakeAdapter()
    app = _app(tmp_path, {"media": media, "files": FakeAdapter()})
    client = app.test_client()
    login = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )

    response = client.post(
        "/api/media/proxy/Sessions/Playing/Progress",
        json={"ItemId": "example123", "PositionTicks": 123},
        headers={"X-CSRF-Token": login.json["csrf"]},
    )

    assert response.status_code == 200
    forwarded = media.requests[-1]
    assert isinstance(forwarded["data"], bytes)
    assert forwarded["data"] == b'{"ItemId": "example123", "PositionTicks": 123}'
    assert not any(key.lower() == "content-length" for key in forwarded["headers"])


def test_generic_playback_info_proxy_is_blocked(tmp_path) -> None:
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

    assert response.status_code == 403
    assert media.requests == []

    root_response = client.post(
        "/api/media/proxy/PlaybackInfo/",
        json={"UserId": "user-1"},
        headers={"X-CSRF-Token": login.json["csrf"]},
    )

    assert root_response.status_code == 403
    assert media.requests == []


def test_media_playback_endpoint_redacts_upstream_credentials_and_paths(tmp_path) -> None:
    class PlaybackAdapter(FakeAdapter):
        def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
            self.requests.append({"token": token, "method": method, "path": path, **kwargs})
            if path.endswith("PlaybackInfo"):
                return UpstreamResponse(
                    status=200,
                    headers={"Content-Type": "application/json"},
                    body=json.dumps({
                        "PlaySessionId": "play-session-1",
                        "ServerId": "private-server",
                        "MediaSources": [{
                            "Id": "source-1",
                            "Path": "/mnt/private-library/Example.mkv",
                            "Container": "mkv",
                            "SupportsDirectPlay": True,
                            "SupportsTranscoding": True,
                            "TranscodingUrl": "/Videos/movie1234/master.m3u8?%61pi_key=example&%74oken=example&audioStreamIndex=2",
                            "Trickplay": {
                                "movie1234": {
                                    "320": {
                                        "Width": 320,
                                        "Height": 180,
                                        "TileWidth": 10,
                                        "TileHeight": 10,
                                        "ThumbnailCount": 100,
                                        "Interval": 10_000,
                                        "Bandwidth": 10_000,
                                        "Path": "/mnt/private-library/trickplay",
                                        "Token": "other-secret",
                                    },
                                },
                            },
                            "MediaStreams": [{
                                "Index": 0,
                                "Type": "Video",
                                "Path": "/mnt/private-library/Example.mkv",
                                "DeliveryUrl": "/Videos/movie1234/stream?%61pi_key=example",
                            }],
                        }],
                    }).encode(),
                )
            return UpstreamResponse(
                status=200,
                headers={"Content-Type": "application/vnd.apple.mpegurl"},
                body=b"#EXTM3U\n",
            )

    media = PlaybackAdapter()
    client = _app(tmp_path, {"media": media, "files": FakeAdapter()}).test_client()
    login = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )

    response = client.post(
        "/api/media/items/movie1234/playback",
        json={"UserId": "other-user", "DeviceProfile": {"Name": "web"}},
        headers={"X-CSRF-Token": login.json["csrf"]},
    )

    assert response.status_code == 200
    payload = response.json
    serialized = json.dumps(payload)
    assert "upstream-api-key" not in serialized
    assert "other-secret" not in serialized
    assert "/mnt/private-library" not in serialized
    assert "Path" not in serialized
    assert "DeliveryUrl" not in serialized
    assert payload["MediaSources"][0]["TranscodingUrl"] == (
        "Videos/movie1234/master.m3u8?audioStreamIndex=2"
    )
    assert media.requests[0]["path"] == "Items/movie1234/PlaybackInfo"
    assert json.loads(media.requests[0]["data"])["UserId"] == "user-1"

    ticket = client.post(
        "/api/media/tickets",
        json={"itemId": "movie1234"},
        headers={"X-CSRF-Token": login.json["csrf"]},
    ).json["ticket"]
    stream = client.get(
        f"/api/media/stream/{ticket}/{payload['MediaSources'][0]['TranscodingUrl']}",
    )

    assert stream.status_code == 200
    assert media.requests[-1]["path"] == "Videos/movie1234/master.m3u8"
    assert media.requests[-1]["query"] == b"audioStreamIndex=2"


def test_media_playback_endpoint_rejects_incomplete_upstream_payload(tmp_path) -> None:
    class InvalidPlaybackAdapter(FakeAdapter):
        def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
            return UpstreamResponse(
                status=200,
                headers={"Content-Type": "application/json"},
                body=b'{"MediaSources": []}',
            )

    client = _app(
        tmp_path,
        {"media": InvalidPlaybackAdapter(), "files": FakeAdapter()},
    ).test_client()
    login = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )

    response = client.post(
        "/api/media/items/movie1234/playback",
        json={"DeviceProfile": {"Name": "web"}},
        headers={"X-CSRF-Token": login.json["csrf"]},
    )

    assert response.status_code == 502
    assert response.json == {"error": "invalid Jellyfin playback response"}


def test_media_subtitle_route_returns_normalized_same_origin_vtt(tmp_path) -> None:
    class SubtitleAdapter(FakeAdapter):
        def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
            self.requests.append({"token": token, "method": method, "path": path, **kwargs})
            return UpstreamResponse(
                status=200,
                headers={"Content-Type": "text/vtt"},
                body=iter([b"\xef\xbb\xbfWEBVTT\r\n\r\nRegion: id:subtitle width:80%\r\n\r\n", b"00:00:01.000 --> 00:00:02.000 region:subtitle\r\nHello\r\n"]),
            )

    media = SubtitleAdapter()
    client = _app(tmp_path, {"media": media, "files": FakeAdapter()}).test_client()
    client.post("/api/auth/media/login", json={"username": "alice", "password": "correct horse"})

    response = client.get("/api/media/subtitles/item-123/source-456/0.vtt")

    assert response.status_code == 200
    assert response.content_type == "text/vtt; charset=utf-8"
    assert response.data == b"WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
    assert media.requests[-1]["path"] == "Videos/item-123/source-456/Subtitles/0/Stream.vtt"


def test_stream_ticket_accepts_jellyfin_hyphenated_item_id(tmp_path) -> None:
    media = FakeAdapter()
    app = _app(tmp_path, {"media": media, "files": FakeAdapter()})
    client = app.test_client()
    login = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )
    compact_id = "461ecbe3269ee48076526b2f9906adf0"
    ticket = client.post(
        "/api/media/tickets",
        json={"itemId": compact_id},
        headers={"X-CSRF-Token": login.json["csrf"]},
    ).json["ticket"]

    response = client.get(
        f"/api/media/stream/{ticket}/Videos/461ecbe3-269e-e480-7652-6b2f9906adf0/master.m3u8",
    )

    assert response.status_code == 200
    assert media.requests[-1]["path"].startswith("Videos/461ecbe3-269e-e480")


def test_hls_segment_retries_before_sending_a_truncated_upstream_body(tmp_path) -> None:
    class TruncatedSegmentAdapter(FakeAdapter):
        def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
            self.requests.append({"token": token, "method": method, "path": path, **kwargs})
            if len(self.requests) == 1:
                def truncated_body():
                    yield b"partial-"
                    raise ChunkedEncodingError("upstream segment ended early")

                body = truncated_body()
            else:
                body = iter([b"complete-segment"])
            return UpstreamResponse(
                status=200,
                headers={"Content-Type": "video/mp2t", "Content-Length": "16"},
                body=body,
            )

    media = TruncatedSegmentAdapter()
    app = _app(tmp_path, {"media": media, "files": FakeAdapter()})
    client = app.test_client()
    login = client.post(
        "/api/auth/media/login",
        json={"username": "alice", "password": "correct horse"},
    )
    item_id = "461ecbe3269ee48076526b2f9906adf0"
    ticket = client.post(
        "/api/media/tickets",
        json={"itemId": item_id},
        headers={"X-CSRF-Token": login.json["csrf"]},
    ).json["ticket"]

    response = client.get(
        f"/api/media/stream/{ticket}/videos/461ecbe3-269e-e480-7652-6b2f9906adf0/hls1/main/1.ts",
    )

    assert response.status_code == 200
    assert response.data == b"complete-segment"
    assert len(media.requests) == 2


def test_stream_ticket_refreshes_rejected_jellyfin_session_and_retries(tmp_path) -> None:
    class RestartingAdapter(FakeAdapter):
        def login(self, username: str, password: str) -> AuthResult:
            self.logins.append((username, password))
            return AuthResult(f"token-{len(self.logins)}", "user-1", username)

        def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
            self.requests.append({"token": token, "method": method, "path": path, **kwargs})
            status = 401 if token == "token-1" else 200
            return UpstreamResponse(
                status=status,
                headers={"Content-Type": "video/mp2t"},
                body=b"segment" if status == 200 else b"rejected",
            )

    media = RestartingAdapter()
    app = _app(
        tmp_path,
        {"media": media, "files": FakeAdapter()},
        {"MEDIA_AUTO_LOGIN_USERNAME": "viewer", "MEDIA_AUTO_LOGIN_PASSWORD": "correct horse"},
    )
    client = app.test_client()
    login = client.post("/api/auth/media/login", json={"username": "viewer", "password": "correct horse"})
    item_id = "461ecbe3269ee48076526b2f9906adf0"
    ticket = client.post(
        "/api/media/tickets",
        json={"itemId": item_id},
        headers={"X-CSRF-Token": login.json["csrf"]},
    ).json["ticket"]

    response = client.get(
        f"/api/media/stream/{ticket}/videos/{item_id}/hls1/main/1.ts",
    )

    assert response.status_code == 200
    assert response.data == b"segment"
    assert [request["token"] for request in media.requests] == ["token-1", "token-2"]
    assert len(media.logins) == 2


def test_concurrent_stale_ticket_requests_share_one_jellyfin_refresh(tmp_path) -> None:
    class ConcurrentRestartAdapter(FakeAdapter):
        def __init__(self) -> None:
            super().__init__()
            self.old_token_requests = threading.Barrier(2)
            self.request_lock = threading.Lock()

        def login(self, username: str, password: str) -> AuthResult:
            with self.request_lock:
                self.logins.append((username, password))
                token = f"token-{len(self.logins)}"
            return AuthResult(token, "user-1", username)

        def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
            if token == "token-1":
                self.old_token_requests.wait(timeout=5)
            with self.request_lock:
                self.requests.append({"token": token, "method": method, "path": path, **kwargs})
            status = 401 if token == "token-1" else 200
            return UpstreamResponse(
                status=status,
                headers={"Content-Type": "video/mp2t"},
                body=b"segment" if status == 200 else b"rejected",
            )

    media = ConcurrentRestartAdapter()
    app = _app(
        tmp_path,
        {"media": media, "files": FakeAdapter()},
        {"MEDIA_AUTO_LOGIN_USERNAME": "viewer", "MEDIA_AUTO_LOGIN_PASSWORD": "correct horse"},
    )
    client = app.test_client()
    login = client.post("/api/auth/media/login", json={"username": "viewer", "password": "correct horse"})
    item_id = "461ecbe3269ee48076526b2f9906adf0"
    ticket = client.post(
        "/api/media/tickets",
        json={"itemId": item_id},
        headers={"X-CSRF-Token": login.json["csrf"]},
    ).json["ticket"]
    path = f"/api/media/stream/{ticket}/videos/{item_id}/hls1/main/1.ts"

    def fetch() -> tuple[int, bytes]:
        response = app.test_client().get(path)
        return response.status_code, response.data

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: fetch(), range(2)))

    assert results == [(200, b"segment"), (200, b"segment")]
    assert len(media.logins) == 2


def test_persistent_stream_401_retries_once_then_fails_explicitly(tmp_path) -> None:
    class RejectingAdapter(FakeAdapter):
        def login(self, username: str, password: str) -> AuthResult:
            self.logins.append((username, password))
            return AuthResult(f"token-{len(self.logins)}", "user-1", username)

        def request(self, token: str, method: str, path: str, **kwargs) -> UpstreamResponse:
            self.requests.append({"token": token, "method": method, "path": path, **kwargs})
            return UpstreamResponse(
                status=401,
                headers={"Content-Type": "application/json"},
                body=b'{"error":"rejected"}',
            )

    media = RejectingAdapter()
    app = _app(
        tmp_path,
        {"media": media, "files": FakeAdapter()},
        {"MEDIA_AUTO_LOGIN_USERNAME": "viewer", "MEDIA_AUTO_LOGIN_PASSWORD": "correct horse"},
    )
    client = app.test_client()
    login = client.post("/api/auth/media/login", json={"username": "viewer", "password": "correct horse"})
    item_id = "461ecbe3269ee48076526b2f9906adf0"
    ticket = client.post(
        "/api/media/tickets",
        json={"itemId": item_id},
        headers={"X-CSRF-Token": login.json["csrf"]},
    ).json["ticket"]

    response = client.get(
        f"/api/media/stream/{ticket}/videos/{item_id}/hls1/main/1.ts",
    )

    assert response.status_code == 502
    assert response.json == {"error": "media stream authentication failed"}
    assert len(media.requests) == 2
    assert len(media.logins) == 2


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
    store = app.extensions["cloud-at-home"]["trash"]
    entry = store.add(
        service_user="user-1",
        original_path="/old.txt",
        trash_path="/.cloud-at-home-trash/example/old.txt",
        size=1,
        now=datetime.now(timezone.utc) - timedelta(days=31),
    )

    response = client.get("/api/files/trash")

    assert response.status_code == 200
    assert response.json == []
    assert store.get(entry.id, "user-1") is None


def test_trash_uses_filebrowser_upload_endpoint_for_directories(tmp_path) -> None:
    files = FakeAdapter()
    app = _app(tmp_path, {"media": FakeAdapter(), "files": files})
    client = app.test_client()
    login = client.post(
        "/api/auth/files/login",
        json={"username": "alice", "password": "correct horse"},
    )

    response = client.post(
        "/api/files/trash",
        json={"path": "/notes.txt", "size": 12},
        headers={"X-CSRF-Token": login.json["csrf"]},
    )

    assert response.status_code == 201
    assert files.requests[0]["method"] == "POST"
    assert files.requests[0]["path"] == "api/resources/.cloud-at-home-trash/?override=false"
    assert files.requests[1]["method"] == "POST"
    assert files.requests[1]["path"].startswith("api/resources/.cloud-at-home-trash/")
    assert files.requests[1]["path"].endswith("/?override=false")
    assert files.requests[2]["method"] == "PATCH"


def _photos_app(tmp_path, username="shutterbug", password="correct horse"):
    adapters = {"media": FakeAdapter(), "files": FakeAdapter(), "photos": FakeAdapter()}
    app = _app(tmp_path, adapters=adapters, config={
        "PHOTOS_AUTO_LOGIN_USERNAME": username,
        "PHOTOS_AUTO_LOGIN_PASSWORD": password,
    })
    return app, adapters


def test_photos_session_auto_logs_in_with_server_credentials(tmp_path) -> None:
    """Tailnet-only Photos is login-free for the viewer: the gateway holds the
    credentials and mints the scoped session itself."""
    app, adapters = _photos_app(tmp_path)
    client = app.test_client()

    response = client.get("/api/auth/photos/session")

    assert response.status_code == 200
    assert response.json["authenticated"] is True
    assert adapters["photos"].logins == [("shutterbug", "correct horse")]
    assert "cloud-home_photos_session" in response.headers.get("Set-Cookie", "")


def test_photos_session_stays_gated_without_configured_credentials(tmp_path) -> None:
    app, _ = _photos_app(tmp_path, username="", password="")
    response = app.test_client().get("/api/auth/photos/session")
    assert response.status_code == 401


def test_photos_session_rejects_a_stale_filebrowser_token(tmp_path) -> None:
    app, adapters = _photos_app(tmp_path, username="", password="")
    client = app.test_client()
    login = client.post(
        "/api/auth/photos/login",
        json={"username": "alice", "password": "correct horse"},
    )
    assert login.status_code == 200
    adapters["photos"].response_status = 500

    response = client.get("/api/auth/photos/session")

    assert response.status_code == 401
    assert response.json == {"authenticated": False}
    assert "cloud-home_photos_session=;" in response.headers["Set-Cookie"]
    assert adapters["photos"].requests[-1]["path"] == "api/resources/"


def test_photos_session_keeps_a_filebrowser_token_that_still_works(tmp_path) -> None:
    app, adapters = _photos_app(tmp_path, username="", password="")
    client = app.test_client()
    login = client.post(
        "/api/auth/photos/login",
        json={"username": "alice", "password": "correct horse"},
    )
    assert login.status_code == 200

    response = client.get("/api/auth/photos/session")

    assert response.status_code == 200
    assert response.json["authenticated"] is True
    assert adapters["photos"].requests[-1]["path"] == "api/resources/"


def test_photos_proxy_reads_the_library_and_nothing_else(tmp_path) -> None:
    app, adapters = _photos_app(tmp_path)
    client = app.test_client()
    assert client.get("/api/auth/photos/session").status_code == 200

    allowed = client.get("/api/photos/proxy/resources/photos/trip")
    outside = client.get("/api/photos/proxy/resources/documents")
    write = client.patch("/api/photos/proxy/resources/photos/a.jpg")

    assert allowed.status_code == 200
    # FileBrowser upstream paths carry the api/ prefix, same as the files
    # service — Photos uses the same Drive account, so the same paths.
    assert adapters["photos"].requests[-1]["path"] == "api/resources/photos/trip"
    assert outside.status_code == 403
    assert write.status_code in (403, 401)


def test_media_session_recovers_when_validation_connection_breaks(tmp_path) -> None:
    """A Jellyfin restart kills the stored upstream token, and validating it
    can fail by having the connection reset mid-body rather than by a clean
    401. That used to escape as a 502 and leave Video hard-down until
    someone cleared the session by hand — with auto-login credentials on file
    the gateway can simply sign in again."""

    class RestartedJellyfin(FakeAdapter):
        def request(self, token, method, path, **kwargs):
            self.requests.append({"token": token, "method": method, "path": path})
            if len(self.requests) == 1:      # validating the pre-restart token
                def broken_body():
                    yield b""
                    raise ChunkedEncodingError("connection reset by peer")

                return UpstreamResponse(status=200, headers={}, body=broken_body())
            return UpstreamResponse(status=200, headers={}, body=b"{}")

    media = RestartedJellyfin()
    app = _app(
        tmp_path,
        {"media": media, "files": FakeAdapter()},
        {"MEDIA_AUTO_LOGIN_USERNAME": "viewer", "MEDIA_AUTO_LOGIN_PASSWORD": "correct horse"},
    )
    client = app.test_client()
    assert client.get("/api/auth/media/session").status_code == 200   # signs in

    response = client.get("/api/auth/media/session")   # validation breaks here

    assert response.status_code == 200
    assert response.json["user"] == {"id": "user-1", "name": "viewer"}
    assert media.logins == [("viewer", "correct horse"), ("viewer", "correct horse")]
