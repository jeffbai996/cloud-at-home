from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote


def _matches_family(path: str, prefix: str) -> bool:
    """Match an API family without allowing lookalike prefixes."""
    family = prefix.rstrip("/")
    return path == family or path.startswith(f"{family}/")


@dataclass(frozen=True)
class ProxyPolicy:
    methods: frozenset[str]
    prefixes: tuple[str, ...]
    denied_pairs: frozenset[tuple[str, str]] = frozenset()
    delete_prefixes: tuple[str, ...] | None = None
    # Families that are a pure read surface regardless of what the policy's
    # method set otherwise allows (previews: cache-backed derived images).
    get_only_prefixes: tuple[str, ...] = ()

    @classmethod
    def files(cls) -> "ProxyPolicy":
        return cls(
            frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"}),
            (
                "resources", "raw", "search", "shares", "share", "users",
                "settings", "profile", "tus", "commands", "usage",
                "preview",
            ),
            get_only_prefixes=("preview",),
        )

    @classmethod
    def photos(cls, root: str = "photos") -> "ProxyPolicy":
        """Read-only, confined to the photo library folder.

        Photos signs in with the same Drive credentials the Files app uses —
        an account with the run of the Drive — so this policy is the whole
        boundary between a photo wall and the rest of it: GET, and only
        under `root`. Writes (import, upload) deliberately do not come
        through here; they go through the `files` service, which has its own
        session and its own CSRF.
        """
        clean = root.strip("/")
        return cls(
            frozenset({"GET"}),
            (
                f"resources/{clean}",
                f"raw/{clean}",
                f"preview/thumb/{clean}",
                f"preview/big/{clean}",
            ),
        )

    @classmethod
    def media(cls) -> "ProxyPolicy":
        return cls(
            frozenset({"GET", "POST", "DELETE"}),
            (
                "Users/", "Items", "Shows/", "Movies/", "Search/", "Sessions/Playing",
                "PlaybackInfo", "Videos/", "videos/", "Audio/", "audio/", "MediaSegments/", "Artists/",
                "Genres/", "Persons/", "Images/", "UserPlayedItems/", "System/Info/Public",
            ),
            frozenset({("POST", "System/Shutdown"), ("POST", "System/Restart")}),
            ("UserPlayedItems/",),
        )

    def validate(self, method: str, path: str) -> str:
        method = method.upper()
        normalized = path.replace("\\", "/").lstrip("/")
        if method not in self.methods or "\x00" in normalized:
            raise ValueError("request is not allowed")
        if any(part in {".", ".."} for part in normalized.split("/")):
            raise ValueError("request is not allowed")
        if not any(_matches_family(normalized, prefix) for prefix in self.prefixes):
            raise ValueError("request is not allowed")
        if (method, normalized) in self.denied_pairs:
            raise ValueError("request is not allowed")
        if method != "GET" and any(
            _matches_family(normalized, prefix) for prefix in self.get_only_prefixes
        ):
            raise ValueError("request is not allowed")
        if method == "DELETE" and self.delete_prefixes is not None and not any(
            _matches_family(normalized, prefix) for prefix in self.delete_prefixes
        ):
            raise ValueError("request is not allowed")
        if method == "DELETE" and _matches_family(normalized, "Users"):
            raise ValueError("request is not allowed")
        # Flask route variables are already URL-decoded. Re-encode the path
        # before composing the upstream URL so literal %, ?, and # characters
        # remain filename data rather than becoming a second URL parse layer.
        return quote(normalized, safe="/-._~")
