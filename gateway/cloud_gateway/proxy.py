from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import unquote


@dataclass(frozen=True)
class ProxyPolicy:
    methods: frozenset[str]
    prefixes: tuple[str, ...]
    denied_pairs: frozenset[tuple[str, str]] = frozenset()

    @classmethod
    def files(cls) -> "ProxyPolicy":
        return cls(
            frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"}),
            (
                "resources", "raw", "search", "shares", "share", "users",
                "settings", "profile", "tus", "commands", "usage",
            ),
        )

    @classmethod
    def media(cls) -> "ProxyPolicy":
        return cls(
            frozenset({"GET", "POST"}),
            (
                "Users/", "Items", "Shows/", "Movies/", "Search/", "Sessions/Playing",
                "PlaybackInfo", "Videos/", "videos/", "Audio/", "audio/", "MediaSegments/", "Artists/",
                "Genres/", "Persons/", "Images/", "System/Info/Public",
            ),
            frozenset({("POST", "System/Shutdown"), ("POST", "System/Restart")}),
        )

    def validate(self, method: str, path: str) -> str:
        method = method.upper()
        normalized = path.replace("\\", "/").lstrip("/")
        decoded = unquote(normalized)
        if method not in self.methods or "\x00" in decoded:
            raise ValueError("request is not allowed")
        if any(part in {".", ".."} for part in decoded.split("/")):
            raise ValueError("request is not allowed")
        if not any(decoded == prefix.rstrip("/") or decoded.startswith(prefix) for prefix in self.prefixes):
            raise ValueError("request is not allowed")
        if (method, decoded) in self.denied_pairs:
            raise ValueError("request is not allowed")
        if method == "DELETE" and decoded.startswith("Users/"):
            raise ValueError("request is not allowed")
        return normalized
