"""Small persistent JSON cache shared by desktop and Android runtimes.

The cache deliberately uses only Python's standard library.  AnimeSoul ships
the same backend through Chaquopy on Android, where adding a native Redis or
database dependency would make the local runtime considerably heavier.
"""

from __future__ import annotations

import asyncio
from contextlib import closing
from dataclasses import dataclass
import json
from pathlib import Path
import sqlite3
import time
from typing import Any


CACHE_FILE = "animesoul-response-cache.sqlite3"


@dataclass(frozen=True, slots=True)
class CacheRecord:
    """A decoded cache value and whether its normal TTL is still valid."""

    value: Any
    fresh: bool


@dataclass(frozen=True, slots=True)
class _StoredRecord:
    value: Any
    expires_at: float
    stale_until: float


class PersistentJsonCache:
    """Bounded SQLite-backed cache with a process-local hot layer.

    `database=None` is useful for isolated gateway tests: callers keep the
    exact same cache semantics without writing outside their temporary scope.
    """

    def __init__(
        self,
        database: Path | None,
        namespace: str,
        *,
        max_entries: int = 1500,
    ) -> None:
        self.database = database
        self.namespace = namespace
        self.max_entries = max(50, max_entries)
        self._memory: dict[str, _StoredRecord] = {}
        self._lock = asyncio.Lock()
        self._ready = False
        self._writes = 0

    async def get(self, key: str) -> CacheRecord | None:
        """Return fresh or stale data; fully expired data is treated as absent."""

        namespaced = self._key(key)
        now = time.time()
        memory = self._memory.get(namespaced)
        if memory:
            if memory.stale_until > now:
                return CacheRecord(memory.value, memory.expires_at > now)
            self._memory.pop(namespaced, None)

        if self.database is None:
            return None
        await self._ensure_ready()
        row = await asyncio.to_thread(self._read, namespaced)
        if row is None:
            return None
        value, expires_at, stale_until = row
        if stale_until <= now:
            await asyncio.to_thread(self._delete, namespaced)
            return None
        try:
            decoded = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            await asyncio.to_thread(self._delete, namespaced)
            return None
        record = _StoredRecord(decoded, expires_at, stale_until)
        self._memory[namespaced] = record
        return CacheRecord(record.value, record.expires_at > now)

    async def set(
        self,
        key: str,
        value: Any,
        *,
        ttl: float,
        stale_ttl: float,
    ) -> None:
        """Store JSON-compatible data and retain it for stale-if-error use."""

        now = time.time()
        expires_at = now + max(1.0, ttl)
        stale_until = expires_at + max(0.0, stale_ttl)
        namespaced = self._key(key)
        self._memory[namespaced] = _StoredRecord(value, expires_at, stale_until)
        self._trim_memory(now)
        if self.database is None:
            return
        await self._ensure_ready()
        try:
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            return
        await asyncio.to_thread(
            self._write,
            namespaced,
            encoded,
            expires_at,
            stale_until,
            now,
        )
        self._writes += 1
        if self._writes % 32 == 0:
            await asyncio.to_thread(self._trim_database, now)

    async def clear(self) -> None:
        """Drop this namespace without affecting other provider caches."""

        prefix = f"{self.namespace}:"
        for key in tuple(self._memory):
            if key.startswith(prefix):
                self._memory.pop(key, None)
        if self.database is None:
            return
        await self._ensure_ready()
        await asyncio.to_thread(self._clear_namespace, prefix)

    def _key(self, key: str) -> str:
        return f"{self.namespace}:{key}"

    def _trim_memory(self, now: float) -> None:
        for key, record in tuple(self._memory.items()):
            if record.stale_until <= now:
                self._memory.pop(key, None)
        while len(self._memory) > min(self.max_entries, 256):
            self._memory.pop(next(iter(self._memory)))

    async def _ensure_ready(self) -> None:
        if self._ready or self.database is None:
            return
        async with self._lock:
            if self._ready:
                return
            await asyncio.to_thread(self._initialize)
            self._ready = True

    def _connect(self) -> sqlite3.Connection:
        if self.database is None:  # pragma: no cover - guarded by callers.
            raise RuntimeError("Persistent cache has no database path")
        connection = sqlite3.connect(self.database, timeout=3.0)
        connection.execute("PRAGMA busy_timeout = 3000")
        return connection

    def _initialize(self) -> None:
        assert self.database is not None
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS response_cache (
                        cache_key TEXT PRIMARY KEY,
                        payload TEXT NOT NULL,
                        expires_at REAL NOT NULL,
                        stale_until REAL NOT NULL,
                        updated_at REAL NOT NULL
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS response_cache_stale_idx "
                    "ON response_cache(stale_until)"
                )

    def _read(self, key: str) -> tuple[str, float, float] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT payload, expires_at, stale_until FROM response_cache WHERE cache_key = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None
        return str(row[0]), float(row[1]), float(row[2])

    def _write(
        self,
        key: str,
        payload: str,
        expires_at: float,
        stale_until: float,
        updated_at: float,
    ) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO response_cache(cache_key, payload, expires_at, stale_until, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(cache_key) DO UPDATE SET
                        payload = excluded.payload,
                        expires_at = excluded.expires_at,
                        stale_until = excluded.stale_until,
                        updated_at = excluded.updated_at
                    """,
                    (key, payload, expires_at, stale_until, updated_at),
                )

    def _delete(self, key: str) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("DELETE FROM response_cache WHERE cache_key = ?", (key,))

    def _clear_namespace(self, prefix: str) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "DELETE FROM response_cache WHERE cache_key LIKE ?",
                    (f"{prefix}%",),
                )

    def _trim_database(self, now: float) -> None:
        prefix = f"{self.namespace}:%"
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "DELETE FROM response_cache WHERE cache_key LIKE ? AND stale_until <= ?",
                    (prefix, now),
                )
                count = int(connection.execute(
                    "SELECT COUNT(*) FROM response_cache WHERE cache_key LIKE ?",
                    (prefix,),
                ).fetchone()[0])
                overflow = count - self.max_entries
                if overflow > 0:
                    connection.execute(
                        """
                        DELETE FROM response_cache WHERE cache_key IN (
                            SELECT cache_key FROM response_cache
                            WHERE cache_key LIKE ? ORDER BY updated_at ASC LIMIT ?
                        )
                        """,
                        (prefix, overflow),
                    )


def response_cache_path(data_dir: Path | None) -> Path | None:
    return data_dir / CACHE_FILE if data_dir is not None else None
