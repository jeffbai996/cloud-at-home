from __future__ import annotations

import os
import secrets
import re
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

from flask import Flask, Response, jsonify, redirect, request

from .adapters import FileBrowserAdapter, JellyfinAdapter, UpstreamError
from .database import Database
from .preference_store import PreferenceStore
from .proxy import ProxyPolicy
from .paths import normalize_virtual_path, restored_name
from .sessions import Session, SessionStore, TokenVault
from .trash import TrashStore
from .stream_tickets import StreamTicketStore, rewrite_hls_playlist


COOKIE_NAMES = {
    "media": "cloud-home_media_session",
    "files": "cloud-home_files_session",
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
    })
    policies = {"media": ProxyPolicy.media(), "files": ProxyPolicy.files()}
    app.extensions["cloud-home"] = {
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
        return jsonify({"label": label, "href": "/api/navigation/extra-service/open"})

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
        if session is not None and service == "media" and app.config["MEDIA_AUTO_LOGIN_USERNAME"]:
            try:
                validation = services["media"].request(session.token, "GET", f"Users/{session.user_id}")
            except UpstreamError as exc:
                return jsonify({"error": str(exc)}), exc.status
            if not isinstance(validation.body, bytes):
                for _chunk in validation.body:
                    pass
            if validation.status == 401:
                sessions.delete(session.id, "media")
                session = None
            elif validation.status >= 400:
                return jsonify({"error": "Jellyfin session validation failed"}), validation.status
        if session is None:
            if service == "media":
                response = auto_login_media()
                if response is not None:
                    return response
            return jsonify({"authenticated": False}), 401
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
            prefix = "api/" if service == "files" else ""
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
            upstream_response = services[service].request(
                session.token,
                request.method,
                prefix + safe_path,
                query=request.query_string,
                headers=forwarded_headers,
                data=body,
            )
        except ValueError:
            return jsonify({"error": "upstream request is not allowed"}), 403
        except UpstreamError as exc:
            return jsonify({"error": str(exc)}), exc.status
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

    @app.post("/api/media/tickets")
    def media_ticket_create() -> Response:
        session, error = authenticated("media")
        if error:
            return error
        payload = request.get_json(silent=True) or {}
        item_id = payload.get("itemId")
        if not isinstance(item_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{8,64}", item_id):
            return jsonify({"error": "invalid media item"}), 400
        ticket = tickets.create(token=session.token, item_id=item_id)
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
        try:
            safe_path = policies["media"].validate("GET", upstream)
            forwarded_headers = {
                key: value for key, value in request.headers.items()
                if key.lower() in {"range", "accept"}
            }
            upstream_response = services["media"].request(
                ticket.token,
                "GET",
                safe_path,
                query=request.query_string,
                headers=forwarded_headers,
            )
        except (ValueError, UpstreamError):
            return jsonify({"error": "media stream unavailable"}), 502
        content_type = upstream_response.headers.get("Content-Type", "")
        if upstream.endswith(".m3u8") or "mpegurl" in content_type.lower():
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
        if source == "/" or source.startswith("/.cloud-home-trash"):
            return jsonify({"error": "this path cannot be trashed"}), 400
        entry_id = secrets.token_urlsafe(12)
        name = PurePosixPath(source).name
        destination = f"/.cloud-home-trash/{entry_id}/{name}"
        root = file_mutation(session, "POST", "/.cloud-home-trash/?override=false")
        if root.status not in {200, 201, 204, 409}:
            return jsonify({"error": "could not create trash root"}), 502
        mkdir = file_mutation(session, "POST", f"/.cloud-home-trash/{entry_id}/?override=false")
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

    serve(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8079")), threads=8)


if __name__ == "__main__":
    main()
