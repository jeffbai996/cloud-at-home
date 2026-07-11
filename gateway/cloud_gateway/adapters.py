from __future__ import annotations

import base64
import json
import uuid
from dataclasses import dataclass
from typing import Iterable, Mapping

import requests


@dataclass(frozen=True)
class AuthResult:
    token: str
    user_id: str
    username: str


@dataclass
class UpstreamResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes | Iterable[bytes]


class UpstreamError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def filebrowser_identity(token: str, fallback_username: str) -> tuple[str, str]:
    try:
        encoded = token.split(".")[1]
        decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        user = json.loads(decoded).get("user", {})
        user_id = str(user["id"])
        username = str(user["username"])
        if not user_id or not username:
            raise ValueError("missing user identity")
        return user_id, username
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return fallback_username, fallback_username


class ServiceAdapter:
    def __init__(self, base_url: str, timeout: tuple[int, int] = (5, 120)):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def login(self, username: str, password: str) -> AuthResult:
        raise NotImplementedError

    def auth_headers(self, token: str) -> dict[str, str]:
        raise NotImplementedError

    def request(
        self,
        token: str,
        method: str,
        path: str,
        *,
        query: bytes = b"",
        headers: Mapping[str, str] | None = None,
        data=None,
    ) -> UpstreamResponse:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if query:
            url += "?" + query.decode("latin-1")
        outgoing = self.auth_headers(token)
        outgoing.update(headers or {})
        try:
            response = requests.request(
                method, url, headers=outgoing, data=data, stream=True, timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise UpstreamError("upstream service unavailable") from exc
        safe_headers = {
            key: value for key, value in response.headers.items()
            if key.lower() in {
                "content-type", "content-length", "content-range", "accept-ranges",
                "content-disposition", "cache-control", "etag", "last-modified", "location",
            }
        }
        return UpstreamResponse(
            response.status_code,
            safe_headers,
            response.iter_content(chunk_size=256 * 1024),
        )


class JellyfinAdapter(ServiceAdapter):
    client_header = (
        'MediaBrowser Client="Cloud at Home", Device="Web", '
        'DeviceId="cloud-at-home-web", Version="0.1.0"'
    )

    def login(self, username: str, password: str) -> AuthResult:
        login_header = (
            'MediaBrowser Client="Cloud at Home", Device="Web", '
            f'DeviceId="cloud-at-home-web-{uuid.uuid4().hex}", Version="0.1.0"'
        )
        try:
            response = requests.post(
                f"{self.base_url}/Users/AuthenticateByName",
                json={"Username": username, "Pw": password},
                headers={"X-Emby-Authorization": login_header},
                timeout=self.timeout[0],
            )
        except requests.RequestException as exc:
            raise UpstreamError("Jellyfin is unavailable") from exc
        if response.status_code != 200:
            raise UpstreamError("Jellyfin login failed", 401)
        payload = response.json()
        return AuthResult(payload["AccessToken"], str(payload["User"]["Id"]), payload["User"]["Name"])

    def auth_headers(self, token: str) -> dict[str, str]:
        return {"X-Emby-Token": token, "X-Emby-Authorization": self.client_header}


class FileBrowserAdapter(ServiceAdapter):
    def login(self, username: str, password: str) -> AuthResult:
        try:
            response = requests.post(
                f"{self.base_url}/api/login",
                json={"username": username, "password": password},
                timeout=self.timeout[0],
            )
        except requests.RequestException as exc:
            raise UpstreamError("FileBrowser is unavailable") from exc
        if response.status_code != 200:
            raise UpstreamError("FileBrowser login failed", 401)
        token = response.text.strip()
        user_id, authenticated_username = filebrowser_identity(token, username)
        return AuthResult(token, user_id, authenticated_username)

    def auth_headers(self, token: str) -> dict[str, str]:
        return {"X-Auth": token}
