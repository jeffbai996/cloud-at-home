from __future__ import annotations

import json
import os
import re
import secrets
import threading
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

import requests
from flask import Flask, Response, jsonify, redirect, request
from requests import RequestException

from .adapters import FileBrowserAdapter, JellyfinAdapter, UpstreamError, UpstreamResponse
from .database import Database
from .preference_store import PreferenceStore
from .proxy import ProxyPolicy
from .paths import normalize_virtual_path, restored_name
from .sessions import Session, SessionStore, TokenVault
from .trash import TrashStore
from .stream_tickets import StreamTicketStore, rewrite_hls_playlist
from .subtitles import normalize_vtt
from .playback import sanitize_playback_info


COOKIE_NAMES = {
    "media": "cloud-home_media_session",
    "files": "cloud-home_files_session",
    "photos": "cloud-home_photos_session",
}
STATE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
MAX_BUFFERED_PROXY_BODY = 2 * 1024 * 1024


def create_app(
    config: Mapping[str, Any] | None = None,
    *,
    adapters: Mapping[str, Any] | None = None,
) -> Flask:
    app = Flask(__name__)
    app.config.update(
        DATABASE_PATH=os.environ.get("CLOUD_HOME_DATABASE_PATH", "./data/cloud-home.db"),
        SECRET_KEY=os.environ.get("CLOUD_HOME_SECRET_KEY", ""),
        COOKIE_SECURE=os.environ.get("CLOUD_HOME_COOKIE_SECURE", "0") == "1",
        JELLYFIN_URL=os.environ.get("JELLYFIN_URL", "http://127.0.0.1:8096"),
        MEDIA_AUTO_LOGIN_USERNAME=os.environ.get("MEDIA_AUTO_LOGIN_USERNAME", ""),
        MEDIA_AUTO_LOGIN_PASSWORD=os.environ.get("MEDIA_AUTO_LOGIN_PASSWORD", ""),
        PHOTOS_AUTO_LOGIN_USERNAME=os.environ.get("PHOTOS_AUTO_LOGIN_USERNAME", ""),
        PHOTOS_AUTO_LOGIN_PASSWORD=os.environ.get("PHOTOS_AUTO_LOGIN_PASSWORD", ""),
        PHOTOS_ROOT=os.environ.get("PHOTOS_ROOT", "photos"),
        FILEBROWSER_URL=os.environ.get("FILEBROWSER_URL", "http://127.0.0.1:8080"),
        EXTRA_SERVICE_LABEL=os.environ.get("CLOUD_HOME_EXTRA_SERVICE_LABEL", ""),
        EXTRA_SERVICE_URL=os.environ.get("CLOUD_HOME_EXTRA_SERVICE_URL", ""),
        MAX_CONTENT_LENGTH=20 * 1024 * 1024 * 1024,
    )
    app.config.update(config or {})
    if not app.config["SECRET_KEY"]:
        raise RuntimeError("CLOUD_HOME_SECRET_KEY is required")

    database = Database(app.config["DATABASE_PATH"])
    vault = TokenVault(app.config["SECRET_KEY"])
    sessions = SessionStore(database, vault)
    preferences = PreferenceStore(database)
    trash = TrashStore(database)
    tickets = StreamTicketStore(database, vault)
    services = dict(adapters or {
        "media": JellyfinAdapter(app.config["JELLYFIN_URL"]),
        "files": FileBrowserAdapter(app.config["FILEBROWSER_URL"]),
        # Same upstream as files; the photos POLICY is the boundary that
        # makes the login-free Photos app read-only and library-scoped.
        "photos": FileBrowserAdapter(app.config["FILEBROWSER_URL"]),
    })
    policies = {
        "media": ProxyPolicy.media(),
        "files": ProxyPolicy.files(),
        "photos": ProxyPolicy.photos(str(app.config["PHOTOS_ROOT"])),
    }
    media_refresh_lock = threading.Lock()
    app.extensions["cloud-at-home"] = {
        "database": database,
        "sessions": sessions,
        "preferences": preferences,
        "trash": trash,
        "tickets": tickets,
        "adapters": services,
    }

    def current_session(service: str) -> Session | None:
        return sessions.get(request.cookies.get(COOKIE_NAMES[service], ""), service)

    def authenticated(service: str):
        session = current_session(service)
        if session is None:
            return None, (jsonify({"error": "authentication required"}), 401)
        if request.method in STATE_METHODS and request.headers.get("X-CSRF-Token") != session.csrf_token:
            return None, (jsonify({"error": "invalid CSRF token"}), 403)
        return session, None

    def session_response(service: str, session: Session) -> Response:
        response = jsonify({
            "authenticated": True,
            "user": {"id": session.user_id, "name": session.username},
            "csrf": session.csrf_token,
        })
        response.set_cookie(
            COOKIE_NAMES[service], session.id, httponly=True,
            secure=bool(app.config["COOKIE_SECURE"]), samesite="Strict",
            max_age=30 * 24 * 60 * 60, path="/",
        )
        return response

    def auto_login_media() -> Response | None:
        username = str(app.config["MEDIA_AUTO_LOGIN_USERNAME"])
        password = str(app.config["MEDIA_AUTO_LOGIN_PASSWORD"])
        if not username or not password:
            return None
        try:
            result = services["media"].login(username, password)
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
        session = sessions.create(
            service="media",
            token=result.token,
            user_id=result.user_id,
            username=result.username,
        )
        return session_response("media", session)

    def auto_login_photos() -> Response | None:
        username = str(app.config["PHOTOS_AUTO_LOGIN_USERNAME"])
        password = str(app.config["PHOTOS_AUTO_LOGIN_PASSWORD"])
        if not username or not password:
            return None
        try:
            result = services["photos"].login(username, password)
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
        session = sessions.create(
            service="photos",
            token=result.token,
            user_id=result.user_id,
            username=result.username,
        )
        return session_response("photos", session)

    def refresh_media_session(failed_session: Session) -> Session | None:
        """Refresh once per stale token while preserving the gateway cookie."""
        username = str(app.config["MEDIA_AUTO_LOGIN_USERNAME"])
        password = str(app.config["MEDIA_AUTO_LOGIN_PASSWORD"])
        if not username or not password:
            return None
        with media_refresh_lock:
            current = sessions.get(failed_session.id, "media")
            if current is None:
                return None
            # Another HLS worker refreshed while this request waited.
            if current.token != failed_session.token:
                return current
            result = services["media"].login(username, password)
            return sessions.update_token(current.id, "media", result.token)

    def drain_upstream(response: UpstreamResponse) -> None:
        if not isinstance(response.body, bytes):
            for _chunk in response.body:
                pass

    def media_request_with_refresh(
        session: Session,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> tuple[UpstreamResponse, Session]:
        response = services["media"].request(session.token, method, path, **kwargs)
        if response.status != 401:
            return response, session
        drain_upstream(response)
        refreshed = refresh_media_session(session)
        if refreshed is None:
            return response, session
        return services["media"].request(refreshed.token, method, path, **kwargs), refreshed

    @app.after_request
    def security_headers(response: Response) -> Response:
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' blob:; "
            "font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self'",
        )
        return response

    @app.get("/healthz")
    def health() -> Response:
        return jsonify({"status": "ok", "services": sorted(services)})

    @app.get("/api/navigation/extra-service")
    def extra_service() -> Response:
        label = str(app.config["EXTRA_SERVICE_LABEL"]).strip()
        destination = str(app.config["EXTRA_SERVICE_URL"]).strip()
        if not label or not destination.startswith("https://"):
            return jsonify({"error": "extra service is not configured"}), 404
        return jsonify({
            "label": label,
            "href": "/api/navigation/extra-service/open",
        })

    @app.get("/api/navigation/extra-service/open")
    def extra_service_navigation() -> Response:
        destination = str(app.config["EXTRA_SERVICE_URL"]).strip()
        if not destination.startswith("https://"):
            return jsonify({"error": "extra service is not configured"}), 503
        return redirect(destination, code=302)

    @app.post("/api/auth/<service>/login")
    def login(service: str) -> Response:
        if service not in services:
            return jsonify({"error": "unknown service"}), 404
        payload = request.get_json(silent=True) or {}
        username = payload.get("username")
        password = payload.get("password")
        if not isinstance(username, str) or not isinstance(password, str) or not username:
            return jsonify({"error": "username and password are required"}), 400
        try:
            result = services[service].login(username, password)
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
        session = sessions.create(
            service=service,
            token=result.token,
            user_id=result.user_id,
            username=result.username,
        )
        return session_response(service, session)

    @app.get("/api/auth/<service>/session")
    def session_status(service: str) -> Response:
        if service not in services:
            return jsonify({"error": "unknown service"}), 404
        session = current_session(service)
        invalidated_cookie = False
        if session is not None and service == "photos":
            try:
                # FileBrowser 2.63 can answer with 500 instead of 401 after a
                # user or token is replaced. Probe the user's virtual root:
                # unlike the configured photos folder, it must exist for every
                # valid FileBrowser session regardless of that user's scope.
                validation = services["photos"].request(
                    session.token, "GET", "api/resources/",
                )
                drain_upstream(validation)
            except (UpstreamError, RequestException) as exc:
                status = exc.status if isinstance(exc, UpstreamError) else 502
                return jsonify({"error": "FileBrowser session validation failed"}), status
            if validation.status >= 400:
                sessions.delete(session.id, "photos")
                session = None
                invalidated_cookie = True
        if session is not None and service == "media" and app.config["MEDIA_AUTO_LOGIN_USERNAME"]:
            try:
                validation = services["media"].request(session.token, "GET", f"Users/{session.user_id}")
                if not isinstance(validation.body, bytes):
                    for _chunk in validation.body:
                        pass
                status = validation.status
            except (UpstreamError, RequestException):
                # Jellyfin restarting does not always reject the old token with
                # a clean 401 — it can accept the connection and then reset it
                # mid-body. Treating that as fatal left Video down until the
                # session row was cleared by hand. Credentials are on file, so
                # an unverifiable session is simply a session to replace; if
                # Jellyfin really is gone, the login below fails and says so.
                status = 401
            if status == 401:
                sessions.delete(session.id, "media")
                session = None
            elif status >= 400:
                return jsonify({"error": "Jellyfin session validation failed"}), status
        if session is None:
            if service == "media":
                response = auto_login_media()
                if response is not None:
                    return response
            if service == "photos":
                response = auto_login_photos()
                if response is not None:
                    return response
            response = jsonify({"authenticated": False})
            response.status_code = 401
            if invalidated_cookie:
                response.delete_cookie(COOKIE_NAMES[service], path="/")
            return response
        return session_response(service, session)

    @app.delete("/api/auth/<service>/session")
    def logout(service: str) -> Response:
        if service not in services:
            return jsonify({"error": "unknown service"}), 404
        session, error = authenticated(service)
        if error:
            return error
        sessions.delete(session.id, service)
        response = jsonify({"ok": True})
        response.delete_cookie(COOKIE_NAMES[service], path="/")
        return response

    @app.route("/api/<service>/proxy/<path:upstream>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def proxy(service: str, upstream: str) -> Response:
        if service not in services:
            return jsonify({"error": "unknown service"}), 404
        session, error = authenticated(service)
        if error:
            return error
        try:
            safe_path = policies[service].validate(request.method, upstream)
            if service == "media" and safe_path.rstrip("/").split("/")[-1].lower() == "playbackinfo":
                # PlaybackInfo contains upstream URLs, access tokens, and local
                # paths. The typed route below returns the browser-safe subset.
                raise ValueError("use the playback endpoint")
            prefix = "api/" if service in {"files", "photos"} else ""
            forwarded_headers = {
                key: value for key, value in request.headers.items()
                if key.lower() in {"content-type", "range", "accept", "if-match", "if-unmodified-since"}
            }
            body = None
            if request.method in STATE_METHODS:
                if request.content_length is not None and request.content_length <= MAX_BUFFERED_PROXY_BODY:
                    body = request.get_data(cache=False)
                else:
                    body = request.stream
                    if request.content_length is not None:
                        forwarded_headers["Content-Length"] = str(request.content_length)
            request_kwargs = {
                "query": request.query_string,
                "headers": forwarded_headers,
                "data": body,
            }
            if service == "media":
                upstream_response, session = media_request_with_refresh(
                    session, request.method, prefix + safe_path, **request_kwargs,
                )
            else:
                upstream_response = services[service].request(
                    session.token, request.method, prefix + safe_path, **request_kwargs,
                )
        except ValueError:
            return jsonify({"error": "upstream request is not allowed"}), 403
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
        # Upstream token expired (FileBrowser JWT ~2h; the gateway can't refresh
        # it — it never kept the password). Without this, the raw 401 leaked to
        # the browser while the gateway cookie stayed valid, so the frontend
        # kept firing the dead token and every request 401'd until a manual
        # logout/login. Invalidate the session + clear the cookie so the client
        # falls back to the login screen cleanly. (Media already does this in
        # session_status; the files proxy never did — that was the bug.)
        if upstream_response.status == 401:
            if not isinstance(upstream_response.body, bytes):
                for _chunk in upstream_response.body:   # drain the stream
                    pass
            sessions.delete(session.id, service)
            response = jsonify({"error": "session expired"})
            response.status_code = 401
            response.delete_cookie(COOKIE_NAMES[service], path="/")
            return response
        return Response(
            upstream_response.body,
            status=upstream_response.status,
            headers=dict(upstream_response.headers),
            direct_passthrough=not isinstance(upstream_response.body, bytes),
        )

    @app.route("/api/preferences/<service>", methods=["GET", "PUT"])
    def user_preferences(service: str) -> Response:
        if service not in services:
            return jsonify({"error": "unknown service"}), 404
        session, error = authenticated(service)
        if error:
            return error
        key = f"{service}:{session.user_id}"
        if request.method == "GET":
            return jsonify(preferences.get(key))
        return jsonify(preferences.put(key, request.get_json(silent=True) or {}))

    @app.post("/api/photos/upload/<path:destination>")
    def upload_photo(destination: str) -> Response:
        session, error = authenticated("files")
        if error:
            return error
        root = str(app.config["PHOTOS_ROOT"]).strip("/")
        clean = destination.strip("/")
        if clean == root or not clean.startswith(f"{root}/"):
            return jsonify({"error": "destination escapes the photo library"}), 400
        try:
            uploaded = services["files"].request(
                session.token, "POST",
                f"api/resources/{quote(clean, safe='/')}?override=false",
                headers={"Content-Type": request.content_type or "application/octet-stream"},
                data=request.stream,
            )
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
        return Response(
            uploaded.body, status=uploaded.status,
            headers=dict(uploaded.headers),
            direct_passthrough=not isinstance(uploaded.body, bytes),
        )

    @app.get("/api/media/subtitles/<item_id>/<source_id>/<int:stream_index>.vtt")
    def media_subtitle(item_id: str, source_id: str, stream_index: int) -> Response:
        session, error = authenticated("media")
        if error:
            return error
        if not all(re.fullmatch(r"[A-Za-z0-9-]{8,64}", value) for value in (item_id, source_id)):
            return jsonify({"error": "invalid subtitle source"}), 400
        try:
            upstream, session = media_request_with_refresh(
                session,
                "GET",
                f"Videos/{item_id}/{source_id}/Subtitles/{stream_index}/Stream.vtt",
            )
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
        raw = upstream.body if isinstance(upstream.body, bytes) else b"".join(upstream.body)
        if upstream.status != 200:
            return Response(raw, status=upstream.status, headers=dict(upstream.headers))
        try:
            body = normalize_vtt(raw)
        except ValueError:
            return jsonify({"error": "invalid subtitle data"}), 502
        return Response(
            body,
            content_type="text/vtt; charset=utf-8",
            headers={"Cache-Control": "private, max-age=300"},
        )

    @app.post("/api/media/items/<item_id>/playback")
    def media_playback_info(item_id: str) -> Response:
        session, error = authenticated("media")
        if error:
            return error
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", item_id):
            return jsonify({"error": "invalid media item"}), 400
        payload = request.get_json(silent=True) or {}
        device_profile = payload.get("DeviceProfile")
        if device_profile is not None and not isinstance(device_profile, dict):
            return jsonify({"error": "invalid device profile"}), 400
        # Direct play/stream are OFF at the gateway too, not just in the client
        # profile: a direct-play response is the whole file as ONE unbounded
        # request, and a paused/slept client pins a waitress worker at the
        # output high-watermark with no timeout. Enough of those exhausted the
        # pool (2026-07-26 outage). HLS keeps every request segment-sized;
        # compatible codecs are remuxed, not transcoded.
        upstream_payload: dict[str, Any] = {
            "UserId": session.user_id,
            "EnableDirectPlay": False,
            "EnableDirectStream": False,
            "EnableTranscoding": True,
            "SubtitleStreamIndex": -1,
        }
        if device_profile is not None:
            upstream_payload["DeviceProfile"] = device_profile
        try:
            upstream, session = media_request_with_refresh(
                session,
                "POST",
                f"Items/{item_id}/PlaybackInfo",
                headers={"Content-Type": "application/json"},
                data=json.dumps(upstream_payload).encode("utf-8"),
            )
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
        raw = upstream.body if isinstance(upstream.body, bytes) else b"".join(upstream.body)
        if upstream.status != 200:
            return jsonify({"error": "Jellyfin playback information is unavailable"}), upstream.status
        try:
            return jsonify(sanitize_playback_info(json.loads(raw)))
        except (TypeError, ValueError, json.JSONDecodeError):
            return jsonify({"error": "invalid Jellyfin playback response"}), 502

    @app.post("/api/media/tickets")
    def media_ticket_create() -> Response:
        session, error = authenticated("media")
        if error:
            return error
        payload = request.get_json(silent=True) or {}
        item_id = payload.get("itemId")
        if not isinstance(item_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{8,64}", item_id):
            return jsonify({"error": "invalid media item"}), 400
        ticket = tickets.create(session_id=session.id, item_id=item_id)
        return jsonify({"ticket": ticket.id, "expiresAt": ticket.expires_at.isoformat()}), 201

    @app.get("/api/media/stream/<ticket_id>/<path:upstream>")
    def media_ticket_stream(ticket_id: str, upstream: str) -> Response:
        match = re.match(r"^(?:Videos|videos)/([^/]+)/", upstream)
        if not match:
            return jsonify({"error": "stream path is not allowed"}), 403
        # Jellyfin formats the same GUID with hyphens in transcoding URLs even
        # when its item APIs and our ticket request use the compact form.
        item_id = match.group(1).replace("-", "")
        ticket = tickets.get(ticket_id, item_id)
        if ticket is None:
            return jsonify({"error": "stream ticket expired or invalid"}), 403
        session = sessions.get(ticket.session_id, "media")
        if session is None:
            return jsonify({"error": "stream ticket session expired"}), 403
        forwarded_headers = {
            key: value for key, value in request.headers.items()
            if key.lower() in {"range", "accept"}
        }

        def fetch_upstream() -> UpstreamResponse:
            safe_path = policies["media"].validate("GET", upstream)
            nonlocal session
            response, session = media_request_with_refresh(
                session, "GET", safe_path,
                query=request.query_string, headers=forwarded_headers,
            )
            return response

        try:
            upstream_response = fetch_upstream()
        except (ValueError, UpstreamError):
            return jsonify({"error": "media stream unavailable"}), 502
        if upstream_response.status == 401:
            drain_upstream(upstream_response)
            return jsonify({"error": "media stream authentication failed"}), 502
        content_type = upstream_response.headers.get("Content-Type", "")
        is_playlist = upstream.endswith(".m3u8") or "mpegurl" in content_type.lower()
        should_buffer = is_playlist or upstream.endswith((".ts", ".m4s"))
        if should_buffer and not isinstance(upstream_response.body, bytes):
            try:
                buffered_body = b"".join(upstream_response.body)
            except RequestException:
                # Do not expose a partial HLS object to the browser. Jellyfin can
                # occasionally close a completed transcode segment a few bytes
                # early; refetch it once while the playback ticket is still live.
                try:
                    upstream_response = fetch_upstream()
                    buffered_body = (
                        upstream_response.body
                        if isinstance(upstream_response.body, bytes)
                        else b"".join(upstream_response.body)
                    )
                except (ValueError, UpstreamError, RequestException):
                    return jsonify({"error": "media stream unavailable"}), 502
            upstream_response.body = buffered_body
        if is_playlist:
            raw = upstream_response.body if isinstance(upstream_response.body, bytes) else b"".join(upstream_response.body)
            rewritten = rewrite_hls_playlist(
                raw.decode("utf-8", errors="replace"),
                upstream_path=upstream,
                public_prefix=f"/api/media/stream/{ticket.id}/",
            )
            headers = dict(upstream_response.headers)
            headers.pop("Content-Length", None)
            return Response(rewritten, status=upstream_response.status, headers=headers)
        return Response(
            upstream_response.body,
            status=upstream_response.status,
            headers=dict(upstream_response.headers),
            direct_passthrough=not isinstance(upstream_response.body, bytes),
        )

    def file_mutation(session: Session, method: str, path: str):
        return services["files"].request(session.token, method, f"api/resources{path}")

    @app.get("/api/files/trash")
    def trash_list() -> Response:
        session, error = authenticated("files")
        if error:
            return error
        for entry in trash.expired(service_user=session.user_id):
            deleted = file_mutation(session, "DELETE", entry.trash_path)
            if deleted.status in {200, 204, 404}:
                trash.remove(entry.id, session.user_id)
        return jsonify([
            {
                "id": entry.id,
                "originalPath": entry.original_path,
                "trashPath": entry.trash_path,
                "size": entry.size,
                "deletedAt": entry.deleted_at.isoformat(),
                "expiresAt": entry.expires_at.isoformat(),
            }
            for entry in trash.list(session.user_id)
        ])

    @app.post("/api/files/trash")
    def trash_create() -> Response:
        session, error = authenticated("files")
        if error:
            return error
        payload = request.get_json(silent=True) or {}
        try:
            source = normalize_virtual_path(payload.get("path", ""))
        except ValueError:
            return jsonify({"error": "invalid path"}), 400
        if source == "/" or source.startswith("/.cloud-at-home-trash"):
            return jsonify({"error": "this path cannot be trashed"}), 400
        entry_id = secrets.token_urlsafe(12)
        name = PurePosixPath(source).name
        destination = f"/.cloud-at-home-trash/{entry_id}/{name}"
        root = file_mutation(session, "POST", "/.cloud-at-home-trash/?override=false")
        if root.status not in {200, 201, 204, 409}:
            return jsonify({"error": "could not create trash root"}), 502
        mkdir = file_mutation(session, "POST", f"/.cloud-at-home-trash/{entry_id}/?override=false")
        if mkdir.status not in {200, 201, 204, 409}:
            return jsonify({"error": "could not create trash container"}), 502
        query = (
            f"?action=rename&destination={quote(destination, safe='')}&override=false&rename=false"
        )
        moved = file_mutation(session, "PATCH", source + query)
        if moved.status not in {200, 201, 204}:
            return jsonify({"error": "FileBrowser refused the trash move"}), moved.status
        entry = trash.add(
            service_user=session.user_id,
            original_path=source,
            trash_path=destination,
            size=int(payload.get("size", 0) or 0),
            entry_id=entry_id,
        )
        return jsonify({"id": entry.id, "expiresAt": entry.expires_at.isoformat()}), 201

    @app.post("/api/files/trash/<entry_id>/restore")
    def trash_restore(entry_id: str) -> Response:
        session, error = authenticated("files")
        if error:
            return error
        entry = trash.get(entry_id, session.user_id)
        if entry is None:
            return jsonify({"error": "trash entry not found"}), 404
        destination = entry.original_path
        existing = file_mutation(session, "GET", destination)
        if existing.status == 200:
            parent = str(PurePosixPath(destination).parent)
            name = restored_name(PurePosixPath(destination).name, datetime.now(timezone.utc))
            destination = normalize_virtual_path(f"{parent}/{name}")
        query = (
            f"?action=rename&destination={quote(destination, safe='')}&override=false&rename=false"
        )
        moved = file_mutation(session, "PATCH", entry.trash_path + query)
        if moved.status not in {200, 201, 204}:
            return jsonify({"error": "FileBrowser refused the restore"}), moved.status
        trash.remove(entry.id, session.user_id)
        return jsonify({"restoredPath": destination})

    @app.delete("/api/files/trash/<entry_id>")
    def trash_delete(entry_id: str) -> Response:
        session, error = authenticated("files")
        if error:
            return error
        entry = trash.get(entry_id, session.user_id)
        if entry is None:
            return jsonify({"error": "trash entry not found"}), 404
        deleted = file_mutation(session, "DELETE", entry.trash_path)
        if deleted.status not in {200, 204, 404}:
            return jsonify({"error": "FileBrowser refused permanent deletion"}), deleted.status
        trash.remove(entry.id, session.user_id)
        return jsonify({"ok": True})

    return app


def main() -> None:
    from waitress import serve

    # 16 threads is headroom, not the fix — the fix is that no request is
    # unbounded anymore (HLS segments only, see media_playback_info).
    serve(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8079")), threads=16)


if __name__ == "__main__":
    main()
