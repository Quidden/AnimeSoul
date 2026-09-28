"""Optional, cached title metadata from Shikimori's public API."""
import asyncio
import time

import httpx

_cache: dict[int, tuple[float, dict]] = {}
_lock = asyncio.Lock()
_last_request = 0.0


async def anime_details(anime_id: int) -> dict:
    global _last_request
    async with _lock:
        cached = _cache.get(anime_id)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        # Stay below the public API's per-second request limit.
        await asyncio.sleep(max(0, 1 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=True, headers={"User-Agent": "AnimeSoul"}) as client:
                response = await client.get(f"https://shikimori.one/api/animes/{anime_id}")
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict):
                    raise ValueError("Invalid anime metadata")
        except (httpx.HTTPError, ValueError):
            # Metadata must never prevent playback, including offline playback.
            return cached[1] if cached else {}
        if len(_cache) >= 256:
            _cache.pop(next(iter(_cache)))
        _cache[anime_id] = (time.monotonic() + 3600, data)
        return data
