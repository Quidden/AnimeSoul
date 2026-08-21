"""Public Kodik catalogue adapter and YummyAnime-compatible normalizers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx


KODIK_SEARCH_ENDPOINT = "https://kodik-api.com/search"
KODIK_LIST_ENDPOINT = "https://kodik-api.com/list"
OFFLINE_SETTINGS_FILE = "animesoul-offline-settings.json"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnimeSoul/0.2"


class KodikNotConfiguredError(RuntimeError):
    """Raised when the local public Kodik key has not been configured yet."""


def _normalise_url(value: object) -> str:
    text = str(value or "").strip()
    return f"https:{text}" if text.startswith("//") else text


def _normalise_title(value: object) -> str:
    text = str(value or "").casefold().replace("ё", "е")
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).strip()


def _number(value: object) -> int | float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    if not (number == number and abs(number) != float("inf")):
        return None
    return int(number) if number.is_integer() else number


def _first(record: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _stable_negative_id(value: str) -> int:
    """Create a deterministic, JSON/JavaScript-safe fallback catalogue id."""

    digest = int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:12], 16)
    return -(8_000_000_000 + digest % 1_000_000_000)


def kodik_anime_id(release: dict[str, Any]) -> int:
    """Prefer a reversible Shikimori id, then a reversible Kodik media id."""

    shikimori_id = _number(release.get("shikimori_id"))
    if isinstance(shikimori_id, int) and 0 < shikimori_id < 2_000_000_000:
        return -shikimori_id

    kodik_id = str(release.get("id") or "").strip()
    match = re.fullmatch(r"(serial|movie|video)-(\d+)", kodik_id, re.IGNORECASE)
    if match:
        base = {"serial": 4_000_000_000, "movie": 5_000_000_000, "video": 6_000_000_000}[match.group(1).casefold()]
        return -(base + int(match.group(2)))
    return _stable_negative_id(kodik_id or repr(sorted(release.items())))


def kodik_lookup_from_anime_id(anime_id: int) -> dict[str, str] | None:
    """Recover a public Kodik search parameter from a fallback app id."""

    value = abs(int(anime_id))
    if anime_id >= 0:
        return None
    if value < 2_000_000_000:
        return {"shikimori_id": str(value)}
    for base, prefix in (
        (4_000_000_000, "serial"),
        (5_000_000_000, "movie"),
        (6_000_000_000, "video"),
    ):
        if base < value < base + 1_000_000_000:
            return {"id": f"{prefix}-{value - base}"}
    return None


def _genre_rows(value: object) -> list[dict[str, str]]:
    if isinstance(value, str):
        items: list[object] = [item.strip() for item in value.split(",")]
    elif isinstance(value, list):
        items = value
    else:
        return []
    genres: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, dict):
            title = str(_first(item, "title", "name") or "").strip()
            alias = str(_first(item, "alias", "slug") or _normalise_title(title).replace(" ", "-")).strip()
        else:
            title = str(item or "").strip()
            alias = _normalise_title(title).replace(" ", "-")
        if title and not any(row["title"].casefold() == title.casefold() for row in genres):
            genres.append({"title": title, "alias": alias})
    return genres


def _anime_type(release: dict[str, Any], material: dict[str, Any]) -> dict[str, str] | None:
    raw = str(_first(material, "anime_kind", "kind") or release.get("type") or "").casefold()
    aliases = {
        "tv": ("Сериал", "tv"),
        "anime-serial": ("Сериал", "tv"),
        "movie": ("Фильм", "movie"),
        "anime": ("Фильм", "movie"),
        "ova": ("OVA", "ova"),
        "ona": ("ONA", "ona"),
        "special": ("Спешл", "special"),
        "music": ("Клип", "music"),
    }
    if raw in aliases:
        name, alias = aliases[raw]
        return {"name": name, "alias": alias, "shortname": name}
    return None


def _anime_status(material: dict[str, Any]) -> dict[str, str] | None:
    raw = str(_first(material, "anime_status", "all_status", "status") or "").casefold()
    statuses = {
        "ongoing": ("Сейчас выходит", "ongoing"),
        "anons": ("Запланировано", "announce"),
        "announce": ("Запланировано", "announce"),
        "released": ("Вышло", "released"),
        "completed": ("Вышло", "released"),
    }
    if raw in statuses:
        title, alias = statuses[raw]
        return {"title": title, "alias": alias}
    return None


def _rating(material: dict[str, Any]) -> dict[str, int | float]:
    result: dict[str, int | float] = {}
    mappings = (
        ("kp_rating", ("kinopoisk_rating", "kp_rating")),
        ("imdb_rating", ("imdb_rating",)),
        ("shikimori_rating", ("shikimori_rating",)),
    )
    for target, sources in mappings:
        number = _number(_first(material, *sources))
        if number is not None:
            result[target] = number
    average = result.get("shikimori_rating", result.get("kp_rating", result.get("imdb_rating")))
    if average is not None:
        result["average"] = average
    counters = _number(_first(material, "shikimori_votes", "kinopoisk_votes", "imdb_votes"))
    if counters is not None:
        result["counters"] = counters
    return result


def _screenshots(release: dict[str, Any], material: dict[str, Any]) -> list[dict[str, Any]]:
    raw = _first(release, "screenshots") or _first(material, "screenshots", "anime_screenshots")
    if not isinstance(raw, list):
        return []
    result: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if isinstance(item, dict):
            url = _normalise_url(_first(item, "full", "fullsize", "url", "src"))
        else:
            url = _normalise_url(item)
        if url:
            result.append({"id": index + 1, "sizes": {"small": url, "full": url}})
    return result


def kodik_release_to_anime(release: dict[str, Any], anime_id: int | None = None) -> dict[str, Any]:
    """Map one Kodik release/translation to the UI's Anime contract."""

    material_value = release.get("material_data")
    material = material_value if isinstance(material_value, dict) else {}
    title = str(_first(release, "title") or _first(material, "title", "anime_title", "title_ru") or "Kodik").strip()
    poster_url = _normalise_url(_first(material, "anime_poster_url", "poster_url", "poster", "image"))
    genres = _genre_rows(_first(material, "anime_genres", "genres"))
    rating = _rating(material)
    remote_ids = {
        "shikimori_id": _first(release, "shikimori_id") or _first(material, "shikimori_id"),
        "kp_id": _first(release, "kinopoisk_id") or _first(material, "kinopoisk_id", "kp_id"),
        "imdb_id": _first(release, "imdb_id") or _first(material, "imdb_id"),
        "kodik_id": release.get("id"),
    }
    remote_ids = {key: value for key, value in remote_ids.items() if value not in (None, "")}
    result: dict[str, Any] = {
        "anime_id": anime_id if anime_id is not None else kodik_anime_id(release),
        "title": title,
        "original": _first(release, "title_orig") or _first(material, "title_en", "anime_title"),
        "title_en": _first(material, "title_en"),
        "title_ru": _first(material, "title", "title_ru") or title,
        "other_titles": _first(release, "other_title") or _first(material, "other_titles", "other_titles_en", "other_titles_jp"),
        "description": _first(material, "anime_description", "description"),
        "year": _number(_first(release, "year") or _first(material, "year")),
        "poster": {"big": poster_url, "fullsize": poster_url} if poster_url else None,
        "rating": rating or None,
        "genres": genres or None,
        "type": _anime_type(release, material),
        "anime_status": _anime_status(material),
        "remote_ids": remote_ids or None,
        "random_screenshots": _screenshots(release, material) or None,
    }
    return {key: value for key, value in result.items() if value not in (None, "", [], {})}


def _timestamp(value: object) -> int | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def _video_id(*values: object) -> int:
    text = "|".join(str(item or "") for item in values)
    return -(int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16) % 2_000_000_000 + 1)


def kodik_releases_to_videos(releases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten Kodik translations and episode data into the existing Video model."""

    videos: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for release in releases:
        translation_value = release.get("translation")
        translation = translation_value if isinstance(translation_value, dict) else {}
        dubbing = str(_first(translation, "title", "name") or "Kodik").strip()
        translation_id = _first(translation, "id") or _first(release, "translation_id")
        translation_type = _first(translation, "type") or _first(release, "translation_type")
        material_value = release.get("material_data")
        material = material_value if isinstance(material_value, dict) else {}
        duration_minutes = _number(_first(material, "duration"))
        duration = round(float(duration_minutes) * 60) if duration_minutes else None
        date = _timestamp(_first(release, "updated_at", "created_at"))

        rows: list[tuple[str, object]] = []
        seasons = release.get("seasons")
        if isinstance(seasons, dict):
            for season_data in seasons.values():
                if not isinstance(season_data, dict):
                    continue
                episodes = season_data.get("episodes")
                if isinstance(episodes, dict):
                    rows.extend((str(number), episode) for number, episode in episodes.items())
        if not rows and release.get("link"):
            rows.append(("1", {"link": release.get("link")}))

        for number, episode_value in rows:
            if isinstance(episode_value, dict):
                link = _normalise_url(_first(episode_value, "link", "url"))
            else:
                link = _normalise_url(episode_value)
            if not link:
                continue
            identity = (number, _normalise_title(dubbing), link.split("?", 1)[0])
            if identity in seen:
                continue
            seen.add(identity)
            video: dict[str, Any] = {
                "video_id": _video_id(release.get("id"), translation_id, number, link),
                "iframe_url": link,
                "number": number,
                "date": date,
                "duration": duration,
                "data": {
                    "dubbing": dubbing,
                    "player": "Kodik",
                    "player_id": "kodik",
                    "translation_id": translation_id,
                    "translation_type": translation_type,
                },
            }
            video["data"] = {key: value for key, value in video["data"].items() if value is not None}
            videos.append({key: value for key, value in video.items() if value is not None})
    return videos


class KodikAnimeGateway:
    """Call the configured public Kodik catalogue API without exposing its key."""

    def __init__(self, data_dir: Path) -> None:
        self.settings_file = data_dir / OFFLINE_SETTINGS_FILE
        self._request_slots = asyncio.Semaphore(6)

    async def public_key(self) -> str:
        try:
            text = await asyncio.to_thread(self.settings_file.read_text, encoding="utf-8")
            payload = json.loads(text)
        except (OSError, json.JSONDecodeError):
            payload = {}
        key = str(payload.get("kodikPublicKey") or "").strip() if isinstance(payload, dict) else ""
        if not key:
            raise KodikNotConfiguredError("Публичный ключ Kodik не настроен")
        return key

    async def request(self, endpoint: str, params: dict[str, object]) -> dict[str, Any]:
        key = await self.public_key()
        request_params = {"token": key, **params}
        async with self._request_slots:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, read=25.0),
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            ) as client:
                response = await client.post(endpoint, params=request_params)
                response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("Kodik returned a non-object response")
        if payload.get("error"):
            raise RuntimeError(str(payload["error"]))
        return payload

    async def ping(self) -> None:
        await self.request(KODIK_SEARCH_ENDPOINT, {"title": "Naruto", "limit": 1})

    async def catalogue(self, query: str, limit: int, offset: int = 0) -> list[dict[str, Any]]:
        requested = min(100, max(1, offset + limit))
        params: dict[str, object] = {
            "limit": requested,
            "types": "anime,anime-serial",
            "with_material_data": "true",
        }
        endpoint = KODIK_SEARCH_ENDPOINT if query.strip() else KODIK_LIST_ENDPOINT
        if query.strip():
            params["title"] = query.strip()
        else:
            params.update({"sort": "updated_at", "order": "desc"})
        payload = await self.request(endpoint, params)
        results = payload.get("results")
        rows = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
        return rows[offset:offset + limit]

    async def find_for_anime(
        self,
        anime: dict[str, Any] | None,
        *,
        anime_id: int | None = None,
        with_episodes: bool = False,
    ) -> list[dict[str, Any]]:
        lookups: list[dict[str, str]] = []
        remote = anime.get("remote_ids") if isinstance(anime, dict) else None
        remote_ids = remote if isinstance(remote, dict) else {}
        for field, source in (
            ("shikimori_id", "shikimori_id"),
            ("kinopoisk_id", "kp_id"),
            ("imdb_id", "imdb_id"),
            ("id", "kodik_id"),
        ):
            value = str(remote_ids.get(source) or "").strip()
            if value:
                lookups.append({field: value})
        if anime_id is not None:
            decoded = kodik_lookup_from_anime_id(anime_id)
            if decoded:
                lookups.append(decoded)
        if isinstance(anime, dict):
            for field in ("title", "original", "title_en"):
                value = str(anime.get(field) or "").strip()
                if value:
                    lookups.append({"title" if field == "title" else "title_orig": value})
        if not lookups:
            return []

        common: dict[str, object] = {
            "limit": 100 if with_episodes else 20,
            "types": "anime,anime-serial",
            "with_material_data": "true",
        }
        if with_episodes:
            common["with_episodes_data"] = "true"
        first_error: BaseException | None = None
        for lookup in lookups:
            try:
                payload = await self.request(KODIK_SEARCH_ENDPOINT, {**common, **lookup})
            except KodikNotConfiguredError:
                raise
            except Exception as error:
                first_error = first_error or error
                continue
            results = payload.get("results")
            rows = [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []
            if rows:
                return rows
        if first_error:
            raise first_error
        return []
