"""Resilient catalogue facade combining YummyAnime and Kodik."""

from __future__ import annotations

import asyncio
import copy
import json
import re
from pathlib import Path
from typing import Any

from .kodik import (
    KodikAnimeGateway,
    KodikNotConfiguredError,
    kodik_release_to_anime,
    kodik_releases_to_videos,
)
from .yummy import YummyAnimeGateway


IDENTITY_INDEX_FILE = "animesoul-anime-identities.json"
SourceStates = dict[str, str]


class CatalogueUnavailableError(RuntimeError):
    """Raised when neither upstream can fulfil a catalogue request."""

    def __init__(self, message: str, sources: SourceStates) -> None:
        super().__init__(message)
        self.sources = sources


def is_missing_field(value: object) -> bool:
    return value is None or value == "" or value == [] or value == {}


def merge_missing_fields(primary: Any, fallback: Any) -> Any:
    """Recursively fill only absent/empty primary fields from the fallback."""

    if is_missing_field(primary):
        return copy.deepcopy(fallback)
    if isinstance(primary, dict) and isinstance(fallback, dict):
        merged = copy.deepcopy(primary)
        for key, fallback_value in fallback.items():
            if key in merged:
                merged[key] = merge_missing_fields(merged[key], fallback_value)
            else:
                merged[key] = copy.deepcopy(fallback_value)
        return merged
    return copy.deepcopy(primary)


def _normalise(value: object) -> str:
    text = str(value or "").casefold().replace("ё", "е")
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).strip()


def _normalise_dubbing(value: object) -> str:
    return (
        _normalise(value)
        .replace("озвучка", "")
        .replace("субтитры", "")
        .replace("subtitles", "")
        .strip()
    )


def _translation_kind(data: dict[str, Any]) -> str:
    raw_type = _normalise(data.get("translation_type"))
    raw_title = _normalise(data.get("dubbing"))
    return "subtitles" if "subtit" in raw_type or "субтит" in raw_title or "subtit" in raw_title else "voice"


def _is_kodik_player(value: object) -> bool:
    return "kodik" in _normalise(value)


def _remote_ids(anime: dict[str, Any]) -> dict[str, str]:
    raw = anime.get("remote_ids")
    if not isinstance(raw, dict):
        return {}
    return {
        key: str(value).casefold().strip()
        for key, value in raw.items()
        if value not in (None, "")
    }


def _titles(anime: dict[str, Any]) -> set[str]:
    values: list[object] = [
        anime.get("title"), anime.get("original"), anime.get("title_ru"), anime.get("title_en"),
    ]
    other = anime.get("other_titles")
    if isinstance(other, list):
        values.extend(other)
    elif isinstance(other, str):
        values.extend(re.split(r"\s*(?:/|\||;)\s*", other))
    return {_normalise(value) for value in values if _normalise(value)}


def anime_match_score(left: dict[str, Any], right: dict[str, Any]) -> int:
    left_ids = _remote_ids(left)
    right_ids = _remote_ids(right)
    score = 0
    for key in ("shikimori_id", "kp_id", "imdb_id", "kodik_id"):
        if left_ids.get(key) and left_ids.get(key) == right_ids.get(key):
            score = max(score, 1000)
    common_titles = _titles(left) & _titles(right)
    if common_titles:
        left_year = left.get("year")
        right_year = right.get("year")
        if left_year and right_year and str(left_year) != str(right_year):
            return score
        score = max(score, 500 + (50 if left_year and right_year else 0))
    return score


def _collapse_anime(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for anime in rows:
        match = next((item for item in result if anime_match_score(item, anime) >= 500), None)
        if match is None:
            result.append(copy.deepcopy(anime))
        else:
            replacement = merge_missing_fields(match, anime)
            match.clear()
            match.update(replacement)
    return result


def merge_catalogues(
    yummy_rows: list[dict[str, Any]],
    kodik_rows: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """Keep Yummy ids/order, enrich matches, then use Kodik-only reserve rows."""

    available = [copy.deepcopy(item) for item in _collapse_anime(kodik_rows)]
    result: list[dict[str, Any]] = []
    for yummy in yummy_rows:
        best_index = -1
        best_score = 0
        for index, kodik in enumerate(available):
            score = anime_match_score(yummy, kodik)
            if score > best_score:
                best_score = score
                best_index = index
        if best_index >= 0 and best_score >= 500:
            result.append(merge_missing_fields(yummy, available.pop(best_index)))
        else:
            result.append(copy.deepcopy(yummy))
    if len(result) < limit:
        result.extend(available[:limit - len(result)])
    return result[:limit]


def merge_videos(
    yummy_rows: list[dict[str, Any]],
    kodik_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fill incomplete Yummy Kodik rows and append missing translations/episodes."""

    result = [copy.deepcopy(item) for item in yummy_rows]
    for fallback in kodik_rows:
        fallback_data = fallback.get("data") if isinstance(fallback.get("data"), dict) else {}
        fallback_key = (
            str(fallback.get("number") or ""),
            _normalise_dubbing(fallback_data.get("dubbing")),
            _translation_kind(fallback_data),
        )
        match_index = -1
        for index, primary in enumerate(result):
            primary_data = primary.get("data") if isinstance(primary.get("data"), dict) else {}
            primary_key = (
                str(primary.get("number") or ""),
                _normalise_dubbing(primary_data.get("dubbing")),
                _translation_kind(primary_data),
            )
            if primary_key == fallback_key and (
                _is_kodik_player(primary_data.get("player"))
                or is_missing_field(primary.get("iframe_url"))
            ):
                match_index = index
                break
        if match_index >= 0:
            merged = merge_missing_fields(result[match_index], fallback)
            fallback_link = fallback.get("iframe_url")
            if _is_kodik_player(merged.get("data", {}).get("player")) and not is_missing_field(fallback_link):
                # The public Kodik catalogue gives an exact per-episode
                # /seria link and translation id. Prefer it over Yummy's
                # broad /season iframe so the private API cannot resolve a
                # different season for another voice.
                merged["iframe_url"] = copy.deepcopy(fallback_link)
            result[match_index] = merged
        else:
            result.append(copy.deepcopy(fallback))
    return result


class AnimeIdentityRegistry:
    """Persist the minimum metadata needed to resolve a Yummy id via Kodik."""

    def __init__(self, data_dir: Path) -> None:
        self.path = data_dir / IDENTITY_INDEX_FILE
        self._lock = asyncio.Lock()
        self._loaded = False
        self._rows: dict[str, dict[str, Any]] = {}

    async def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        async with self._lock:
            if self._loaded:
                return
            try:
                text = await asyncio.to_thread(self.path.read_text, encoding="utf-8")
                payload = json.loads(text)
            except (OSError, json.JSONDecodeError):
                payload = {}
            if isinstance(payload, dict):
                self._rows = {
                    str(key): value for key, value in payload.items() if isinstance(value, dict)
                }
            self._loaded = True

    async def get(self, anime_id: int) -> dict[str, Any] | None:
        await self._ensure_loaded()
        row = self._rows.get(str(anime_id))
        return copy.deepcopy(row) if row else None

    async def remember(self, anime: list[dict[str, Any]]) -> None:
        if not anime:
            return
        await self._ensure_loaded()
        changed = False
        async with self._lock:
            for item in anime:
                anime_id = item.get("anime_id")
                if not isinstance(anime_id, int):
                    continue
                identity = {
                    key: copy.deepcopy(item[key])
                    for key in ("anime_id", "title", "original", "title_en", "title_ru", "year", "remote_ids")
                    if key in item and not is_missing_field(item[key])
                }
                key = str(anime_id)
                merged = merge_missing_fields(self._rows.get(key, {}), identity)
                if merged != self._rows.get(key):
                    self._rows[key] = merged
                    changed = True
            if not changed:
                return
            await asyncio.to_thread(self.path.parent.mkdir, parents=True, exist_ok=True)
            temporary = self.path.with_suffix(self.path.suffix + ".tmp")
            payload = json.dumps(self._rows, ensure_ascii=False, indent=2)
            await asyncio.to_thread(temporary.write_text, payload + "\n", encoding="utf-8")
            await asyncio.to_thread(temporary.replace, self.path)


def _source_state(value: object) -> str:
    if isinstance(value, KodikNotConfiguredError):
        return "unconfigured"
    return "error" if isinstance(value, BaseException) else "ok"


class HybridCatalogueService:
    """Serve the current UI contract while either upstream remains usable."""

    def __init__(
        self,
        yummy: YummyAnimeGateway,
        kodik: KodikAnimeGateway,
        data_dir: Path,
    ) -> None:
        self.yummy = yummy
        self.kodik = kodik
        self.registry = AnimeIdentityRegistry(data_dir)

    async def catalogue(
        self,
        query: str,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], SourceStates]:
        yummy_call = (
            self.yummy.search(query, limit=limit, offset=offset)
            if query.strip()
            else self.yummy.request("/anime", {"limit": limit, "offset": offset})
        )
        yummy_result, kodik_result = await asyncio.gather(
            yummy_call,
            self.kodik.catalogue(query, limit=limit, offset=offset),
            return_exceptions=True,
        )
        sources = {"yummy": _source_state(yummy_result), "kodik": _source_state(kodik_result)}
        if isinstance(yummy_result, BaseException) and isinstance(kodik_result, BaseException):
            raise CatalogueUnavailableError("Каталоги YummyAnime и Kodik временно недоступны", sources)

        yummy_rows = [item for item in yummy_result if isinstance(item, dict)] if isinstance(yummy_result, list) else []
        releases = [item for item in kodik_result if isinstance(item, dict)] if isinstance(kodik_result, list) else []
        kodik_rows = [kodik_release_to_anime(item) for item in releases]
        anime = merge_catalogues(yummy_rows, kodik_rows, limit)
        await self.registry.remember(anime)
        return anime, sources

    async def details(self, ids: list[str]) -> tuple[list[dict[str, Any]], SourceStates]:
        yummy_results = await asyncio.gather(
            *(self.yummy.request(f"/anime/{item}") for item in ids),
            return_exceptions=True,
        )
        yummy_ok = any(isinstance(item, dict) for item in yummy_results)
        yummy_failed = any(isinstance(item, BaseException) for item in yummy_results)
        contexts: list[dict[str, Any] | None] = []
        numeric_ids: list[int | None] = []
        for raw_id, result in zip(ids, yummy_results):
            try:
                numeric_id = int(raw_id)
            except ValueError:
                numeric_id = None
            numeric_ids.append(numeric_id)
            if isinstance(result, dict):
                contexts.append(result)
            elif numeric_id is not None:
                contexts.append(await self.registry.get(numeric_id))
            else:
                contexts.append(None)

        kodik_results = await asyncio.gather(
            *(
                self.kodik.find_for_anime(context, anime_id=anime_id)
                for context, anime_id in zip(contexts, numeric_ids)
            ),
            return_exceptions=True,
        )
        sources = {
            "yummy": "error" if yummy_failed and not yummy_ok else "ok",
            "kodik": next(
                (_source_state(item) for item in kodik_results if isinstance(item, BaseException)),
                "ok",
            ),
        }
        anime: list[dict[str, Any]] = []
        for numeric_id, yummy_result, kodik_result in zip(numeric_ids, yummy_results, kodik_results):
            primary = yummy_result if isinstance(yummy_result, dict) else None
            releases = kodik_result if isinstance(kodik_result, list) else []
            kodik_cards = _collapse_anime([kodik_release_to_anime(item) for item in releases if isinstance(item, dict)])
            fallback = kodik_cards[0] if kodik_cards else None
            if primary and fallback:
                anime.append(merge_missing_fields(primary, fallback))
            elif primary:
                anime.append(copy.deepcopy(primary))
            elif fallback:
                card = copy.deepcopy(fallback)
                if numeric_id is not None:
                    card["anime_id"] = numeric_id
                anime.append(card)
        if not anime and sources["yummy"] == "error" and sources["kodik"] in {"error", "unconfigured"}:
            raise CatalogueUnavailableError("Не удалось загрузить данны аниме из YummyAnime и Kodik", sources)
        await self.registry.remember(anime)
        return anime, sources

    async def videos(self, anime_id: int) -> tuple[dict[str, Any], SourceStates]:
        # Catalogue/details calls persist enough identity metadata to start the
        # Kodik lookup immediately. Previously it waited for both YummyAnime
        # requests first, so the two upstream timeout windows accumulated and
        # made an anime page appear frozen. Keep the sequential fallback only
        # for a truly unknown id.
        yummy_details_task = asyncio.create_task(self.yummy.request(f"/anime/{anime_id}"))
        yummy_videos_task = asyncio.create_task(self.yummy.request(f"/anime/{anime_id}/videos"))
        context = await self.registry.get(anime_id)
        if context:
            kodik_task = asyncio.create_task(
                self.kodik.find_for_anime(context, anime_id=anime_id, with_episodes=True)
            )
            yummy_details, yummy_videos, kodik_value = await asyncio.gather(
                yummy_details_task,
                yummy_videos_task,
                kodik_task,
                return_exceptions=True,
            )
        else:
            yummy_details, yummy_videos = await asyncio.gather(
                yummy_details_task,
                yummy_videos_task,
                return_exceptions=True,
            )
            context = yummy_details if isinstance(yummy_details, dict) else None
            kodik_result = await asyncio.gather(
                self.kodik.find_for_anime(context, anime_id=anime_id, with_episodes=True),
                return_exceptions=True,
            )
            kodik_value = kodik_result[0]
        sources = {
            "yummy": "error" if isinstance(yummy_details, BaseException) or isinstance(yummy_videos, BaseException) else "ok",
            "kodik": _source_state(kodik_value),
        }
        yummy_video_rows = [item for item in yummy_videos if isinstance(item, dict)] if isinstance(yummy_videos, list) else []
        releases = [item for item in kodik_value if isinstance(item, dict)] if isinstance(kodik_value, list) else []
        kodik_video_rows = kodik_releases_to_videos(releases)
        videos = merge_videos(yummy_video_rows, kodik_video_rows)

        kodik_cards = _collapse_anime([kodik_release_to_anime(item, anime_id=anime_id) for item in releases])
        kodik_anime = kodik_cards[0] if kodik_cards else None
        if isinstance(yummy_details, dict) and kodik_anime:
            anime = merge_missing_fields(yummy_details, kodik_anime)
        elif isinstance(yummy_details, dict):
            anime = copy.deepcopy(yummy_details)
        elif kodik_anime:
            anime = kodik_anime
        elif context:
            anime = context
        else:
            anime = None
        if not videos and sources["yummy"] == "error" and sources["kodik"] in {"error", "unconfigured"}:
            raise CatalogueUnavailableError("Серии недоступны в YummyAnime и Kodik", sources)
        if anime:
            await self.registry.remember([anime])
        return {"anime": anime or {}, "videos": videos}, sources
