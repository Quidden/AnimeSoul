"""Persistent anonymous community ratings for online AnimeSoul deployments."""

from __future__ import annotations

import asyncio
import json
import math
import sqlite3
import time
from pathlib import Path
from typing import Any


class CommunityRatingStore:
    """Store one replaceable rating tree per anonymous voter and anime."""

    def __init__(self, data_dir: Path) -> None:
        self.file = data_dir / "community-ratings.sqlite3"
        self._lock = asyncio.Lock()

    async def replace(
        self,
        voter_id: str,
        anime_id: int,
        title: str,
        anime: float | None,
        seasons: dict[str, float],
        episodes: dict[str, float],
    ) -> None:
        async with self._lock:
            await asyncio.to_thread(
                self._replace_sync,
                voter_id,
                anime_id,
                title,
                anime,
                seasons,
                episodes,
            )

    async def aggregate(self, anime_ids: list[int]) -> dict[str, dict[str, Any]]:
        if not anime_ids:
            return {}
        async with self._lock:
            return await asyncio.to_thread(self._aggregate_sync, anime_ids)

    async def list_anime_ids(self, limit: int, offset: int) -> list[int]:
        async with self._lock:
            return await asyncio.to_thread(self._list_anime_ids_sync, limit, offset)

    def _connect(self) -> sqlite3.Connection:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.file, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS community_ratings (
                voter_id TEXT NOT NULL,
                anime_id INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                anime_score REAL,
                seasons_json TEXT NOT NULL DEFAULT '{}',
                episodes_json TEXT NOT NULL DEFAULT '{}',
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (voter_id, anime_id)
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS community_ratings_anime ON community_ratings(anime_id)"
        )
        connection.commit()
        return connection

    def _replace_sync(
        self,
        voter_id: str,
        anime_id: int,
        title: str,
        anime: float | None,
        seasons: dict[str, float],
        episodes: dict[str, float],
    ) -> None:
        connection = self._connect()
        try:
            if anime is None and not seasons and not episodes:
                connection.execute(
                    "DELETE FROM community_ratings WHERE voter_id = ? AND anime_id = ?",
                    (voter_id, anime_id),
                )
                connection.commit()
                return
            connection.execute(
                """
                INSERT INTO community_ratings (
                    voter_id, anime_id, title, anime_score,
                    seasons_json, episodes_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(voter_id, anime_id) DO UPDATE SET
                    title = excluded.title,
                    anime_score = excluded.anime_score,
                    seasons_json = excluded.seasons_json,
                    episodes_json = excluded.episodes_json,
                    updated_at = excluded.updated_at
                """,
                (
                    voter_id,
                    anime_id,
                    title,
                    anime,
                    json.dumps(seasons, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(episodes, ensure_ascii=False, separators=(",", ":")),
                    int(time.time() * 1000),
                ),
            )
            connection.commit()
        finally:
            connection.close()

    def _aggregate_sync(self, anime_ids: list[int]) -> dict[str, dict[str, Any]]:
        unique_ids = list(dict.fromkeys(anime_ids))
        placeholders = ",".join("?" for _ in unique_ids)
        connection = self._connect()
        try:
            rows = connection.execute(
                f"""
                SELECT voter_id, anime_id, title, anime_score,
                       seasons_json, episodes_json, updated_at
                FROM community_ratings
                WHERE anime_id IN ({placeholders})
                ORDER BY updated_at DESC
                """,
                unique_ids,
            ).fetchall()
        finally:
            connection.close()

        buckets: dict[int, dict[str, Any]] = {
            anime_id: {
                "animeId": anime_id,
                "title": "",
                "anime": [],
                "seasons": {},
                "episodes": {},
                "updatedAt": 0,
            }
            for anime_id in unique_ids
        }
        for row in rows:
            bucket = buckets[int(row["anime_id"])]
            if not bucket["title"] and row["title"]:
                bucket["title"] = row["title"]
            bucket["updatedAt"] = max(bucket["updatedAt"], int(row["updated_at"]))
            if row["anime_score"] is not None:
                bucket["anime"].append(float(row["anime_score"]))
            self._collect_scores(bucket["seasons"], row["seasons_json"])
            self._collect_scores(bucket["episodes"], row["episodes_json"])

        result: dict[str, dict[str, Any]] = {}
        for anime_id, bucket in buckets.items():
            if not bucket["anime"] and not bucket["seasons"] and not bucket["episodes"]:
                continue
            result[str(anime_id)] = {
                "animeId": anime_id,
                "title": bucket["title"],
                "anime": self._score_summary(bucket["anime"]),
                "seasons": {
                    key: self._score_summary(values)
                    for key, values in bucket["seasons"].items()
                },
                "episodes": {
                    key: self._score_summary(values)
                    for key, values in bucket["episodes"].items()
                },
                "updatedAt": bucket["updatedAt"],
            }
        return result

    def _list_anime_ids_sync(self, limit: int, offset: int) -> list[int]:
        connection = self._connect()
        try:
            rows = connection.execute(
                """
                SELECT anime_id, MAX(updated_at) AS latest
                FROM community_ratings
                GROUP BY anime_id
                ORDER BY latest DESC, anime_id ASC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
        finally:
            connection.close()
        return [int(row["anime_id"]) for row in rows]

    @staticmethod
    def _collect_scores(target: dict[str, list[float]], raw: str) -> None:
        try:
            values = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return
        if not isinstance(values, dict):
            return
        for key, value in values.items():
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(float(value))
            ):
                target.setdefault(str(key), []).append(float(value))

    @staticmethod
    def _score_summary(values: list[float]) -> dict[str, float | int] | None:
        if not values:
            return None
        return {
            "average": round(sum(values) / len(values), 4),
            "count": len(values),
        }
