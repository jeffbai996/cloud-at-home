from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from .database import Database
from .preferences import DEFAULT_PREFERENCES, merge_preferences


class PreferenceStore:
    def __init__(self, database: Database):
        self.database = database

    def get(self, service_user: str) -> dict[str, Any]:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT value_json FROM preferences WHERE service_user = ?",
                (service_user,),
            ).fetchone()
        if not row:
            return merge_preferences(DEFAULT_PREFERENCES)
        try:
            return merge_preferences(json.loads(row["value_json"]))
        except (TypeError, ValueError):
            return merge_preferences(DEFAULT_PREFERENCES)

    def put(self, service_user: str, candidate: object) -> dict[str, Any]:
        value = merge_preferences(candidate)
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO preferences(service_user, value_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(service_user) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at
                """,
                (
                    service_user,
                    json.dumps(value, separators=(",", ":")),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        return value
