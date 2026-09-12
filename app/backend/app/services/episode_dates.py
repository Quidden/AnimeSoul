"""Calendar air dates for individual MyAnimeList episodes via Jikan."""

from __future__ import annotations

import asyncio
from datetime import date
from pathlib import Path
import time
from typing import Any

import httpx

from .http_client import LazyAsyncClient
from .response_cache import PersistentJsonCache, response_cache_path


class EpisodeDatesUnavailable(RuntimeError):
    pass


def episode_air_dates(payload: dict[str, Any]) -> dict[str, str]:
    """Keep date-only values; local time zones must not shift the air day."""
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise EpisodeDatesUnavailable("Некорректный ответ источника дат")
    dates: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        number, aired = row.get("mal_id"), row.get("aired")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1 or not isinstance(aired, str):
            continue
        try:
            dates[str(number)] = date.fromisoformat(aired[:10]).isoformat()
        except ValueError:
            continue
    return dates


class EpisodeDatesGateway:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.cache = PersistentJsonCache(response_cache_path(data_dir), "episode-air-dates")
        self.http = LazyAsyncClient(timeout=httpx.Timeout(8.0), follow_redirects=True)
        self._slot = asyncio.Lock()
        self._next_request = 0.0
        self._retry_at = 0.0
        self._inflight: dict[str, asyncio.Task[dict[str, Any]]] = {}

    async def dates(self, mal_id: int, page: int = 1) -> dict[str, Any]:
        key = f"{mal_id}:{page}"
        cached = await self.cache.get(key)
        if cached and cached.fresh:
            return cached.value
        if key not in self._inflight:
            task = asyncio.create_task(self._load(mal_id, page, key, cached.value if cached else None))
            self._inflight[key] = task
            task.add_done_callback(lambda _task: self._inflight.pop(key, None))
        return await asyncio.shield(self._inflight[key])

    async def _load(self, mal_id: int, page: int, key: str, stale: dict | None) -> dict[str, Any]:
        try:
            async with self._slot:
                if time.monotonic() < self._retry_at:
                    raise EpisodeDatesUnavailable("Источник дат временно недоступен")
                await asyncio.sleep(max(0, self._next_request - time.monotonic()))
                # Jikan permits 60 requests/minute and 3/second across titles.
                self._next_request = time.monotonic() + 1.05
                response = await (await self.http.get()).get(
                    f"https://api.jikan.moe/v4/anime/{mal_id}/episodes", params={"page": page},
                )
                if response.status_code == 404:
                    payload = {"data": []}
                else:
                    response.raise_for_status()
                    payload = response.json()
                if not isinstance(payload, dict):
                    raise EpisodeDatesUnavailable("Некорректный ответ источника дат")
                pagination = payload.get("pagination")
                result = {
                    "dates": episode_air_dates(payload),
                    "hasNextPage": isinstance(pagination, dict) and pagination.get("has_next_page") is True,
                }
        except (httpx.HTTPError, ValueError, EpisodeDatesUnavailable) as error:
            self._retry_at = time.monotonic() + 60
            if stale is not None:
                return stale
            raise EpisodeDatesUnavailable("Дата выхода пока недоступна") from error
        await self.cache.set(key, result, ttl=3600, stale_ttl=180 * 86400)
        return result

    async def close(self) -> None:
        tasks = list(self._inflight.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.http.close()
