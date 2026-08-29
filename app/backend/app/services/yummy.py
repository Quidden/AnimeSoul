"""Typed gateway to the public YummyAnime API."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
import re
import time
import unicodedata
from typing import Any

import httpx

from .response_cache import CacheRecord, PersistentJsonCache, response_cache_path


_ENGLISH_KEYS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,."
_RUSSIAN_KEYS = "ёйцукенгшщзхъфывапролджэячсмитьбю"
_KEYBOARD_TRANSLATION = str.maketrans(
    _ENGLISH_KEYS + _ENGLISH_KEYS.upper() + _RUSSIAN_KEYS + _RUSSIAN_KEYS.upper(),
    _RUSSIAN_KEYS + _RUSSIAN_KEYS.upper() + _ENGLISH_KEYS + _ENGLISH_KEYS.upper(),
)
_CYRILLIC_TRANSLITERATION = {
    "а": "a", "б": "b", "в": "v", "г": "g", "ґ": "g", "д": "d",
    "е": "e", "ё": "e", "є": "ye", "ж": "zh", "з": "z", "и": "i",
    "і": "i", "ї": "yi", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh",
    "щ": "shch", "ы": "y", "э": "e", "ю": "yu", "я": "ya",
    "ъ": "", "ь": "",
}

# Keep these common community names aligned with the frontend search aliases.
_SEARCH_ALIASES: dict[str, tuple[str, ...]] = {
    "aot": ("attack on titan", "shingeki no kyojin", "атака титанов"),
    "аот": ("attack on titan", "shingeki no kyojin", "атака титанов"),
    "bnha": ("boku no hero academia", "my hero academia", "моя геройская академия"),
    "бнха": ("boku no hero academia", "my hero academia", "моя геройская академия"),
    "mha": ("my hero academia", "boku no hero academia", "моя геройская академия"),
    "мга": ("моя геройская академия", "my hero academia"),
    "kny": ("kimetsu no yaiba", "demon slayer", "клинок рассекающий демонов"),
    "крд": ("клинок рассекающий демонов", "kimetsu no yaiba", "demon slayer"),
    "sao": ("sword art online", "мастера меча онлайн"),
    "сао": ("sword art online", "мастера меча онлайн"),
    "fma": ("fullmetal alchemist", "стальной алхимик"),
    "fmab": ("fullmetal alchemist brotherhood", "стальной алхимик"),
    "фма": ("fullmetal alchemist", "стальной алхимик"),
    "jjba": ("jojo bizarre adventure", "невероятные приключения джоджо"),
    "джджба": ("jojo bizarre adventure", "невероятные приключения джоджо"),
    "ван пис": ("one piece",),
    "ванпис": ("one piece",),
    "ре зеро": ("re zero", "re:zero", "жизнь в альтернативном мире с нуля"),
    "резеро": ("re zero", "re:zero", "жизнь в альтернативном мире с нуля"),
    "магичка": ("магическая битва", "jujutsu kaisen"),
    "др стоун": ("dr stone", "doctor stone"),
    "доктор стоун": ("dr stone", "doctor stone"),
}


def normalize_search_text(value: str) -> str:
    """Create a stable comparison form without losing non-Latin titles."""

    decomposed = unicodedata.normalize("NFKD", value.casefold().replace("ё", "е"))
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", re.sub(r"[^\w]+", " ", without_marks, flags=re.UNICODE)).strip()


def swap_keyboard_layout(value: str) -> str:
    """Swap characters between standard English and Russian keyboard layouts."""

    return value.translate(_KEYBOARD_TRANSLATION)


def transliterate_cyrillic(value: str) -> str:
    """Produce a conservative Cyrillic-to-Latin title spelling."""

    return "".join(_CYRILLIC_TRANSLITERATION.get(char, char) for char in value.casefold())


def anime_search_queries(value: str, maximum: int = 4) -> list[str]:
    """Expand one user query into bounded API searches, ordered by confidence."""

    variants: list[str] = []
    seen: set[str] = set()

    def add(candidate: str) -> None:
        candidate = re.sub(r"\s+", " ", candidate).strip()
        key = candidate.casefold()
        if candidate and key not in seen and len(variants) < maximum:
            variants.append(candidate)
            seen.add(key)

    raw = re.sub(r"\s+", " ", value).strip()
    normalized = normalize_search_text(raw)
    direct_aliases = _SEARCH_ALIASES.get(normalized)
    if direct_aliases:
        for alias in direct_aliases:
            add(alias)
        add(raw)
        return variants

    add(raw)
    corrected_layout = normalize_search_text(swap_keyboard_layout(normalized))
    corrected_aliases = _SEARCH_ALIASES.get(corrected_layout)
    if corrected_aliases:
        for alias in corrected_aliases:
            add(alias)
    else:
        add(corrected_layout)

    transliterated = normalize_search_text(transliterate_cyrillic(normalized))
    transliterated_aliases = _SEARCH_ALIASES.get(transliterated)
    if transliterated_aliases:
        for alias in transliterated_aliases:
            add(alias)
    else:
        add(transliterated)

    return variants


class YummyAnimeGateway:
    """Hide upstream URL, headers, normalization and timeout policy."""

    base_url = "https://api.yani.tv"

    def __init__(self, token: str, data_dir: Path | None = None) -> None:
        self.token = token
        self._search_cache: dict[
            tuple[str, int, int], tuple[float, list[dict[str, Any]]]
        ] = {}
        self._search_inflight: dict[
            tuple[str, int, int], asyncio.Task[list[dict[str, Any]]]
        ] = {}
        self._request_inflight: dict[str, asyncio.Task[Any]] = {}
        self._request_slots = asyncio.Semaphore(8)
        self._response_cache = PersistentJsonCache(
            response_cache_path(data_dir),
            "yummy",
        )
        self._client: httpx.AsyncClient | None = None
        self._client_lock = asyncio.Lock()

    @property
    def headers(self) -> dict[str, str]:
        return {"X-Application": self.token, "Lang": "ru", "Accept": "application/json"}

    async def request(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        refresh: bool = False,
    ) -> Any:
        if not self.token:
            raise RuntimeError("YummyAnime token is not configured")
        key = self._cache_key(path, params)
        cached = await self._response_cache.get(key)
        if cached and cached.fresh and not refresh:
            return cached.value

        existing = self._request_inflight.get(key)
        if existing:
            return await asyncio.shield(existing)

        task = asyncio.create_task(self._request_and_cache(key, path, params, cached))
        self._request_inflight[key] = task

        def release(completed: asyncio.Task[Any]) -> None:
            if self._request_inflight.get(key) is completed:
                self._request_inflight.pop(key, None)

        task.add_done_callback(release)
        return await asyncio.shield(task)

    async def _request_and_cache(
        self,
        key: str,
        path: str,
        params: dict[str, Any] | None,
        cached: CacheRecord | None,
    ) -> Any:
        try:
            async with self._request_slots:
                value = await self._request(await self._http_client(), path, params)
        except Exception:
            # A stale public response is a better reserve than an empty player
            # while both upstreams are experiencing a short outage.
            if cached is not None:
                return cached.value
            raise
        ttl, stale_ttl = self._cache_policy(path)
        await self._response_cache.set(key, value, ttl=ttl, stale_ttl=stale_ttl)
        return value

    async def _http_client(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        async with self._client_lock:
            if self._client is None:
                self._client = httpx.AsyncClient(
                    timeout=httpx.Timeout(10.0, read=20.0),
                    follow_redirects=True,
                    headers={"Accept": "application/json"},
                    limits=httpx.Limits(
                        max_connections=12,
                        max_keepalive_connections=8,
                        keepalive_expiry=30.0,
                    ),
                )
        return self._client

    async def close(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()

    async def clear_cache(self) -> None:
        self._search_cache.clear()
        await self._response_cache.clear()

    def _cache_key(self, path: str, params: dict[str, Any] | None = None) -> str:
        token_key = hashlib.sha256(self.token.encode("utf-8")).hexdigest()[:12]
        encoded = json.dumps(params or {}, ensure_ascii=False, sort_keys=True, default=str)
        return f"{token_key}:{path}:{encoded}"

    @staticmethod
    def _cache_policy(path: str) -> tuple[float, float]:
        if path.endswith("/videos"):
            return 20 * 60, 24 * 60 * 60
        if path == "/anime/schedule":
            return 5 * 60, 6 * 60 * 60
        if path.endswith("/trailers"):
            return 12 * 60 * 60, 7 * 24 * 60 * 60
        if re.fullmatch(r"/anime/[^/]+", path):
            return 12 * 60 * 60, 7 * 24 * 60 * 60
        return 5 * 60, 24 * 60 * 60

    async def _request(
        self,
        client: httpx.AsyncClient,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        response = await client.get(f"{self.base_url}{path}", params=params, headers=self.headers)
        response.raise_for_status()
        return self._normalize(response.json().get("response"))

    async def search(
        self,
        query: str,
        limit: int,
        offset: int = 0,
        *,
        refresh: bool = False,
    ) -> list[dict[str, Any]]:
        """Search API aliases, layout corrections and community title variants."""

        key = (normalize_search_text(query), limit, offset)
        now = time.monotonic()
        cached = self._search_cache.get(key)
        if cached and cached[0] > now and not refresh:
            return cached[1]

        persistent_key = self._cache_key(
            "/anime/expanded-search",
            {"q": key[0], "limit": limit, "offset": offset},
        )
        persistent = await self._response_cache.get(persistent_key)
        if persistent and persistent.fresh and not refresh:
            anime = [item for item in persistent.value if isinstance(item, dict)]
            self._search_cache[key] = (now + 5 * 60, anime)
            return anime

        existing = self._search_inflight.get(key)
        if existing:
            return await existing

        task = asyncio.create_task(self._search_uncached(query, limit, offset))
        self._search_inflight[key] = task
        try:
            try:
                anime = await asyncio.shield(task)
            except Exception:
                if persistent is None:
                    raise
                anime = [item for item in persistent.value if isinstance(item, dict)]
            self._search_cache[key] = (now + 5 * 60, anime)
            await self._response_cache.set(
                persistent_key,
                anime,
                ttl=5 * 60,
                stale_ttl=24 * 60 * 60,
            )
            self._trim_search_cache(now)
            return anime
        finally:
            self._search_inflight.pop(key, None)

    async def _search_uncached(
        self,
        query: str,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        """Return the first useful variant instead of waiting for every fallback."""

        queries = anime_search_queries(query)
        first_error: BaseException | None = None
        client = await self._http_client()
        tasks = [
            asyncio.create_task(self._request(
                client,
                "/anime",
                {"limit": limit, "offset": offset, "q": item},
            ))
            for item in queries
        ]
        try:
            for completed in asyncio.as_completed(tasks):
                try:
                    page = await completed
                except Exception as error:  # Keep trying independent variants.
                    first_error = first_error or error
                    continue
                if isinstance(page, list) and page:
                    return [anime for anime in page if isinstance(anime, dict)][:limit]
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

        if first_error:
            raise first_error
        return []

    def _trim_search_cache(self, now: float) -> None:
        for key, (expires_at, _) in tuple(self._search_cache.items()):
            if expires_at <= now:
                self._search_cache.pop(key, None)
        while len(self._search_cache) > 128:
            self._search_cache.pop(next(iter(self._search_cache)))

    def _normalize(self, value: Any) -> Any:
        """Convert protocol-relative media URLs recursively."""

        if isinstance(value, str) and value.startswith("//"):
            return f"https:{value}"
        if isinstance(value, list):
            return [self._normalize(item) for item in value]
        if isinstance(value, dict):
            return {key: self._normalize(item) for key, item in value.items()}
        return value
