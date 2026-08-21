"""Local offline library and Kodik download queue for AnimeSoul.

The service deliberately keeps its catalogue next to the downloaded media.  As
a result, titles, posters and episode records remain available even when the
network (or the upstream catalogue) is unavailable.
"""

from __future__ import annotations

import asyncio
import base64
import ctypes
from ctypes import wintypes
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import ipaddress
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx


INDEX_FILE = ".animesoul-library.json"
SETTINGS_FILE = "animesoul-offline-settings.json"
PRIVATE_KEY_FILE = "animesoul-kodik-private.dpapi"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnimeSoul/0.2"
KODIK_VIDEO_LINKS_ENDPOINT = "https://kodikres.com/api/video-links"
KODIK_SEARCH_ENDPOINT = "https://kodik-api.com/search"
PUBLIC_IP_ENDPOINT = "https://api.ipify.org"


class OfflineLibraryError(RuntimeError):
    """A user-facing offline-library error."""


class DownloadCancelled(Exception):
    """Internal signal used to stop an active transfer without marking it failed."""


def _safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", value).strip(" .")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned[:110].rstrip(" .") or fallback)


def _anime_folder_name(request: dict[str, Any]) -> str:
    anime_id = int(request.get("animeId") or 0)
    title = _safe_name(str(request.get("title") or "Аниме"), f"anime-{anime_id or 'unknown'}")
    return _safe_name(f"{title} [{anime_id}]", f"anime-{anime_id or 'unknown'}")


def _normalise_url(value: str) -> str:
    return f"https:{value}" if value.startswith("//") else value


def _is_kodik_url(value: str) -> bool:
    try:
        host = (urlparse(_normalise_url(value)).hostname or "").casefold()
    except ValueError:
        return False
    allowed_suffixes = (
        "kodik.info",
        "kodik.cc",
        "kodikplayer.com",
        "kodik.biz",
        "kodik.online",
    )
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in allowed_suffixes)


def _private_player_link(value: str) -> str:
    """Return the exact protocol-relative player URL signed for Kodik.

    The private API accepts the player link, rather than a catalogue lookup.
    Its query string is deliberately retained: Kodik embeds use it to select a
    concrete episode inside a season.
    """

    if not _is_kodik_url(value):
        raise OfflineLibraryError("Для загрузки поддерживаются только источники Kodik.")
    parsed = urlparse(_normalise_url(value))
    if not parsed.hostname or not parsed.path:
        raise OfflineLibraryError("Не удалось прочитать ссылку плеера Kodik.")
    host = parsed.hostname.casefold()
    path = parsed.path
    if not re.fullmatch(r"/(?:serial|season|seria|video|movie)/[^/]+/[^/]+/[^/]+/?", path):
        raise OfflineLibraryError("Ссылка Kodik не указывает конкретное видео или сезон.")
    return f"//{host}{path}" + (f"?{parsed.query}" if parsed.query else "")


def _kodik_signature(link: str, ip: str, deadline: str, private_key: str) -> str:
    message = f"{link}:{ip}:{deadline}".encode("utf-8")
    return hmac.new(private_key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _select_kodik_source(links: object, requested_quality: int) -> tuple[str, int]:
    """Select one direct source from the documented private API response."""

    if not isinstance(links, dict):
        raise OfflineLibraryError("Kodik не предоставил доступные качества видео.")
    available = sorted(
        (int(quality) for quality in links if str(quality).isdigit()),
        reverse=True,
    )
    selected = next((quality for quality in available if quality <= requested_quality), None)
    if selected is None and available:
        selected = available[-1]
    if selected is None:
        raise OfflineLibraryError("Kodik не предоставил качества для этой серии.")
    variants = links.get(str(selected), links.get(selected))
    if isinstance(variants, str):
        source = variants
    elif isinstance(variants, list):
        source = next(
            (
                _source_value(item)
                for item in variants
                if isinstance(item, dict)
                and isinstance(_source_value(item), str)
            ),
            None,
        )
    elif isinstance(variants, dict):
        source = _source_value(variants)
    else:
        source = None
    if not isinstance(source, str) or not source.strip():
        raise OfflineLibraryError("Kodik не передал прямую ссылку на выбранное качество.")
    return _normalise_url(source.strip()), selected


def _source_value(value: dict[object, object]) -> object:
    """Read a direct source regardless of the API field's casing.

    Kodik's private API currently uses ``Src``/``Type`` while some older
    examples use lowercase names.  JSON keys are case-sensitive, so normalise
    them at this boundary rather than making the download flow depend on one
    spelling.
    """

    for key, item in value.items():
        if isinstance(key, str) and key.casefold() in {"src", "url", "link"}:
            return item
    return None


def _normalise_kodik_sources(links: object) -> list[dict[str, Any]]:
    """Expose every direct quality returned by Kodik in one stable shape."""

    if not isinstance(links, dict):
        return []
    result: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for raw_quality, raw_variants in links.items():
        try:
            quality = int(raw_quality)
        except (TypeError, ValueError):
            continue
        variants = raw_variants if isinstance(raw_variants, list) else [raw_variants]
        for variant in variants:
            if isinstance(variant, str):
                source = variant
                source_type = "hls" if ".m3u8" in variant.split("?", 1)[0] else "video"
            elif isinstance(variant, dict):
                source = _source_value(variant)
                source_type = next(
                    (
                        str(item).casefold()
                        for key, item in variant.items()
                        if isinstance(key, str) and key.casefold() in {"type", "format", "mime"}
                    ),
                    "",
                )
            else:
                continue
            if not isinstance(source, str) or not source.strip():
                continue
            source = _normalise_url(source.strip())
            identity = (quality, source)
            if identity in seen:
                continue
            seen.add(identity)
            result.append(
                {
                    "quality": quality,
                    "src": source,
                    "type": source_type or ("hls" if ".m3u8" in source.split("?", 1)[0] else "video"),
                }
            )
    return sorted(result, key=lambda item: int(item["quality"]), reverse=True)


def _normalise_kodik_subtitles(value: object) -> list[dict[str, Any]]:
    """Accept current and legacy subtitle shapes used by the private API."""

    result: list[dict[str, Any]] = []
    seen: set[str] = set()

    def visit(candidate: object, fallback_label: str = "") -> None:
        if isinstance(candidate, str):
            source = candidate.strip()
            if not source.startswith(("//", "https://", "http://")):
                return
            source = _normalise_url(source)
            if source in seen:
                return
            seen.add(source)
            label = fallback_label.strip() or f"Субтитры {len(result) + 1}"
            result.append({"src": source, "label": label, "language": fallback_label.strip() or "und"})
            return
        if isinstance(candidate, list):
            for item in candidate:
                visit(item, fallback_label)
            return
        if not isinstance(candidate, dict):
            return
        source = _source_value(candidate)
        if isinstance(source, str):
            label = next(
                (
                    str(item).strip()
                    for key, item in candidate.items()
                    if isinstance(key, str)
                    and key.casefold() in {"label", "title", "name", "language", "lang", "srclang"}
                    and str(item).strip()
                ),
                fallback_label.strip() or f"Субтитры {len(result) + 1}",
            )
            language = next(
                (
                    str(item).strip()
                    for key, item in candidate.items()
                    if isinstance(key, str)
                    and key.casefold() in {"language", "lang", "srclang", "locale"}
                    and str(item).strip()
                ),
                fallback_label.strip() or "und",
            )
            normalized = _normalise_url(source.strip())
            if normalized and normalized not in seen:
                seen.add(normalized)
                result.append(
                    {
                        "src": normalized,
                        "label": label,
                        "language": language,
                        "default": bool(candidate.get("default", candidate.get("Default", False))),
                    }
                )
            return
        for key, item in candidate.items():
            visit(item, str(key))

    visit(value)
    return result


def _normalise_kodik_skips(payload: dict[str, Any]) -> dict[str, dict[str, float]]:
    """Read opening/ending markers without depending on one API field casing."""

    raw = next(
        (
            value
            for key, value in payload.items()
            if isinstance(key, str) and key.casefold().replace("_", "") in {"skips", "skipsegments", "segments"}
        ),
        None,
    )
    result: dict[str, dict[str, float]] = {}

    def segment(kind: object, value: object) -> None:
        normalized_kind = str(kind or "").casefold().replace("_", "").replace("-", "")
        target = "opening" if normalized_kind in {"opening", "op", "intro"} else "ending" if normalized_kind in {"ending", "ed", "outro", "credits"} else ""
        if not target:
            return
        start: object = None
        end: object = None
        length: object = None
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            start, end = value[0], value[1]
        elif isinstance(value, dict):
            lowered = {str(key).casefold().replace("_", ""): item for key, item in value.items()}
            start = lowered.get("start", lowered.get("time", lowered.get("from")))
            end = lowered.get("end", lowered.get("to"))
            length = lowered.get("length", lowered.get("duration"))
        try:
            start_number = float(start)
            length_number = float(length) if length is not None else float(end) - start_number
        except (TypeError, ValueError):
            return
        if start_number < 0 or length_number <= 0:
            return
        result[target] = {"time": start_number, "length": length_number}

    if isinstance(raw, dict):
        for key, value in raw.items():
            segment(key, value)
        generic = next(
            (value for key, value in raw.items() if str(key).casefold() in {"skip", "markers"}),
            None,
        )
        if isinstance(generic, list):
            ranges = [item for item in generic if isinstance(item, (list, tuple, dict))]
            if ranges:
                first = ranges[0]
                if isinstance(first, dict):
                    lowered = {str(key).casefold(): item for key, item in first.items()}
                    explicit = lowered.get("type", lowered.get("kind", lowered.get("name")))
                    segment(explicit or "opening", first)
                else:
                    segment("opening", first)
            if len(ranges) > 1:
                last = ranges[-1]
                if isinstance(last, dict):
                    lowered = {str(key).casefold(): item for key, item in last.items()}
                    explicit = lowered.get("type", lowered.get("kind", lowered.get("name")))
                    segment(explicit or "ending", last)
                else:
                    segment("ending", last)
    elif isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            lowered = {str(key).casefold(): item_value for key, item_value in item.items()}
            segment(lowered.get("type", lowered.get("kind", lowered.get("name"))), item)
    return result


def _normalise_dubbing(value: object) -> str:
    """Make catalogue and application dubbing labels comparable."""

    text = str(value or "").casefold().replace("озвучка", "")
    return re.sub(r"[^\w]+", "", text)


def _normalise_title(value: object) -> str:
    text = str(value or "").casefold().replace("ё", "е")
    return re.sub(r"[^\w]+", "", text).strip()


def _episode_link_from_results(
    results: object,
    season: object,
    episode: object,
    translation_id: object = None,
    dubbing: object = None,
    title: object = None,
    original_title: object = None,
) -> str | None:
    """Pick the exact episode link returned by Kodik's public catalogue.

    ``with_episodes_data=true`` adds an episode object with a concrete
    ``/seria/...`` link.  That link, unlike a season or serial embed, is what
    the private API expects when it signs a direct download URL.
    """

    if not isinstance(results, list):
        return None
    wanted_season = str(season or "").strip()
    wanted_episode = str(episode or "").strip()
    if not wanted_season or not wanted_episode:
        return None
    wanted_translation = str(translation_id).strip() if translation_id is not None else ""
    wanted_dubbing = _normalise_dubbing(dubbing)
    wanted_titles = {_normalise_title(item) for item in (title, original_title)} - {""}
    matches: list[tuple[int, int, str]] = []

    for index, result in enumerate(results):
        if not isinstance(result, dict):
            continue
        seasons = result.get("seasons")
        if not isinstance(seasons, dict):
            continue

        translation = result.get("translation")
        if not isinstance(translation, dict):
            translation = {}
        result_translation = str(
            translation.get("id", result.get("translation_id", result.get("translationId", "")))
        ).strip()
        result_dubbing = _normalise_dubbing(
            translation.get("title", result.get("translation_title", result.get("dubbing", "")))
        )
        material = result.get("material_data")
        if not isinstance(material, dict):
            material = {}
        result_titles = {
            _normalise_title(item)
            for item in (
                result.get("title"),
                result.get("title_orig"),
                material.get("title"),
                material.get("title_en"),
            )
        } - {""}
        for result_season, season_data in seasons.items():
            if not isinstance(season_data, dict):
                continue
            episodes = season_data.get("episodes")
            if not isinstance(episodes, dict):
                continue
            episode_data = next((value for key, value in episodes.items() if str(key) == wanted_episode), None)
            if isinstance(episode_data, str):
                link = episode_data
            elif isinstance(episode_data, dict):
                link = episode_data.get("link")
            else:
                link = None
            if not isinstance(link, str) or not link.strip():
                continue

            score = 25 if str(result_season) == wanted_season else 0
            if wanted_titles and result_titles:
                if wanted_titles & result_titles:
                    score += 200
                elif any(
                    wanted in result_title or result_title in wanted
                    for wanted in wanted_titles
                    for result_title in result_titles
                ):
                    score += 60
            if wanted_translation and result_translation == wanted_translation:
                score += 100
            if wanted_dubbing and result_dubbing:
                if wanted_dubbing == result_dubbing:
                    score += 80
                elif wanted_dubbing in result_dubbing or result_dubbing in wanted_dubbing:
                    score += 40
            matches.append((score, -index, link.strip()))

    return max(matches)[2] if matches else None


def _search_identifier_name(source_id_type: object) -> str | None:
    """Map the app's stable catalogue id to Kodik's documented search key."""

    kind = str(source_id_type or "").casefold().strip()
    return {
        "shikimori": "shikimori_id",
        "kinopoisk": "kinopoisk_id",
        "imdb": "imdb_id",
        "kodik": "id",
    }.get(kind)


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _dpapi_protect(value: str) -> str:
    """Encrypt a local secret with the current Windows account's DPAPI key."""

    if os.name != "nt":
        raise OfflineLibraryError("Защищённое хранение приватного ключа Kodik доступно только в Windows.")
    raw = value.encode("utf-8")
    source_buffer = ctypes.create_string_buffer(raw)
    source = _DataBlob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
    destination = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptProtectData(
        ctypes.byref(source),
        "AnimeSoul Kodik private API",
        None,
        None,
        None,
        0,
        ctypes.byref(destination),
    ):
        raise OfflineLibraryError("Windows не смог защитить приватный ключ Kodik.")
    try:
        return base64.b64encode(ctypes.string_at(destination.pbData, destination.cbData)).decode("ascii")
    finally:
        kernel32.LocalFree(destination.pbData)


def _dpapi_unprotect(value: str) -> str:
    if os.name != "nt":
        raise OfflineLibraryError("Защищённое хранение приватного ключа Kodik доступно только в Windows.")
    try:
        raw = base64.b64decode(value.encode("ascii"), validate=True)
    except (UnicodeEncodeError, ValueError) as error:
        raise OfflineLibraryError("Не удалось прочитать защищённый приватный ключ Kodik.") from error
    source_buffer = ctypes.create_string_buffer(raw)
    source = _DataBlob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
    destination = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptUnprotectData(
        ctypes.byref(source),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(destination),
    ):
        raise OfflineLibraryError("Windows не смог расшифровать приватный ключ Kodik для текущего пользователя.")
    try:
        return ctypes.string_at(destination.pbData, destination.cbData).decode("utf-8")
    except UnicodeDecodeError as error:
        raise OfflineLibraryError("Защищённый приватный ключ Kodik имеет неверный формат.") from error
    finally:
        kernel32.LocalFree(destination.pbData)


class KodikSourceResolver:
    """Resolve a Kodik player link through the account's private API."""

    def __init__(self) -> None:
        self._public_ip: str | None = None
        self._public_ip_expires_at = 0.0

    async def resolve_private_api(
        self,
        embed_url: str,
        quality: int,
        public_key: str,
        private_key: str,
        *,
        source_id: object = None,
        source_id_type: object = None,
        season: object = None,
        episode: object = None,
        translation_id: object = None,
        dubbing: object = None,
        source_title: object = None,
        source_original_title: object = None,
    ) -> tuple[str, int]:
        payload = await self._request_private_payload(
            embed_url,
            public_key,
            private_key,
            source_id=source_id,
            source_id_type=source_id_type,
            season=season,
            episode=episode,
            translation_id=translation_id,
            dubbing=dubbing,
            source_title=source_title,
            source_original_title=source_original_title,
        )
        requested_quality = max(144, min(int(quality or 720), 2160))
        return _select_kodik_source(payload.get("links"), requested_quality)

    async def resolve_playback_api(
        self,
        embed_url: str,
        public_key: str,
        private_key: str,
        *,
        source_id: object = None,
        source_id_type: object = None,
        season: object = None,
        episode: object = None,
        translation_id: object = None,
        dubbing: object = None,
        source_title: object = None,
        source_original_title: object = None,
    ) -> dict[str, Any]:
        payload = await self._request_private_payload(
            embed_url,
            public_key,
            private_key,
            source_id=source_id,
            source_id_type=source_id_type,
            season=season,
            episode=episode,
            translation_id=translation_id,
            dubbing=dubbing,
            source_title=source_title,
            source_original_title=source_original_title,
        )
        subtitle_values = [
            value
            for key, value in payload.items()
            if isinstance(key, str) and key.casefold() in {"subtitles", "subtitle", "tracks"}
        ]
        links = payload.get("links")
        if isinstance(links, dict):
            for variants in links.values():
                for variant in (variants if isinstance(variants, list) else [variants]):
                    if not isinstance(variant, dict):
                        continue
                    subtitle_values.extend(
                        value
                        for key, value in variant.items()
                        if isinstance(key, str) and key.casefold() in {"subtitles", "subtitle", "tracks"}
                    )
        return {
            "sources": _normalise_kodik_sources(payload.get("links")),
            "subtitles": _normalise_kodik_subtitles(subtitle_values),
            "skips": _normalise_kodik_skips(payload),
        }

    async def _request_private_payload(
        self,
        embed_url: str,
        public_key: str,
        private_key: str,
        *,
        source_id: object = None,
        source_id_type: object = None,
        season: object = None,
        episode: object = None,
        translation_id: object = None,
        dubbing: object = None,
        source_title: object = None,
        source_original_title: object = None,
    ) -> dict[str, Any]:
        """Request a signed direct URL from Kodik's documented private API.

        Only the local backend receives the private key.  The browser gets
        neither the key nor the signature.
        """

        try:
            raw_link = _private_player_link(embed_url)
        except OfflineLibraryError:
            raw_link = None
        ip = await self._current_public_ipv4()
        deadline = (datetime.now(UTC) + timedelta(hours=6)).strftime("%Y%m%d%H")
        response: httpx.Response | None = None
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(25.0, read=45.0),
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT},
            ) as client:
                # A serial/season embed is meant for an iframe and may be
                # rejected by /api/video-links.  Kodik's documented catalogue
                # endpoint can return the exact /seria link for this selection.
                official_link = await self._official_episode_link(
                    client,
                    public_key,
                    source_id,
                    source_id_type,
                    season,
                    episode,
                    translation_id,
                    dubbing,
                    source_title,
                    source_original_title,
                )
                candidate_links = [item for item in (official_link, raw_link) if item]
                if raw_link:
                    bare_link = raw_link.split("?", 1)[0]
                    if bare_link != raw_link:
                        candidate_links.append(bare_link)
                candidate_links = list(dict.fromkeys(candidate_links))
                if not candidate_links:
                    raise OfflineLibraryError("Не удалось определить ссылку Kodik для выбранной серии.")
                for candidate in candidate_links:
                    params = {
                        "link": candidate,
                        "p": public_key,
                        "ip": ip,
                        "d": deadline,
                        "s": _kodik_signature(candidate, ip, deadline, private_key),
                        "auto_proxy": "true",
                        "skip_segments": "true",
                    }
                    response = await client.get(KODIK_VIDEO_LINKS_ENDPOINT, params=params)
                    if response.is_success:
                        break
                    # A malformed player link can be corrected by dropping a
                    # player-only query string. Auth and permission responses
                    # cannot, so avoid sending an unnecessary second request.
                    if response.status_code not in {400, 422}:
                        break
        except httpx.HTTPError as error:
            raise OfflineLibraryError("Не удалось подключиться к приватному API Kodik.") from error
        if response is None:
            raise OfflineLibraryError("Не удалось получить ответ от приватного API Kodik.")
        if not response.is_success:
            raise OfflineLibraryError(self._rejection_message(response))
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise OfflineLibraryError("Приватное API Kodik вернуло некорректный ответ.") from error
        if not isinstance(payload, dict):
            raise OfflineLibraryError("Приватное API Kodik вернуло ответ неверного формата.")
        if payload.get("error"):
            raise OfflineLibraryError("Kodik не выдал прямую ссылку на выбранную серию.")
        return payload

    @staticmethod
    async def _official_episode_link(
        client: httpx.AsyncClient,
        public_key: str,
        source_id: object,
        source_id_type: object,
        season: object,
        episode: object,
        translation_id: object,
        dubbing: object,
        source_title: object,
        source_original_title: object,
    ) -> str | None:
        """Look up a concrete episode link via Kodik's public catalogue API.

        Failure here deliberately falls back to the original embed URL.  This
        keeps the previous YummyAnime/Kodik embed behaviour as a reserve while
        preferring the supported per-episode API route whenever the app has a
        Shikimori or Kinopoisk id.
        """

        identifier_name = _search_identifier_name(source_id_type)
        identifier = str(source_id or "").strip()
        title = str(source_title or "").strip()
        original_title = str(source_original_title or "").strip()
        if season is None or episode is None:
            return None
        lookups: list[tuple[str, str]] = []
        if identifier_name and identifier:
            lookups.append((identifier_name, identifier))
        # YummyAnime does not provide remote ids for every franchise entry.
        # Kodik documents title search as a supported alternative, so use it
        # as a reliable fallback instead of signing a broad serial iframe.
        if title:
            lookups.append(("title", title))
        if not lookups:
            return None
        for parameter, value in dict.fromkeys(lookups):
            params = {
                "token": public_key,
                parameter: value,
                "with_episodes_data": "true",
            }
            try:
                response = await client.post(KODIK_SEARCH_ENDPOINT, params=params)
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict):
                continue
            candidate = _episode_link_from_results(
                payload.get("results"),
                season,
                episode,
                translation_id,
                dubbing,
                title,
                original_title,
            )
            if not candidate:
                continue
            try:
                return _private_player_link(candidate)
            except OfflineLibraryError:
                continue
        return None

    @staticmethod
    def _rejection_message(response: httpx.Response) -> str:
        """Translate safe Kodik rejection hints without exposing a request URL."""

        details = response.text.casefold()
        if "ip" in details or "ipv4" in details:
            return (
                "Kodik отклонил IP в подписи. Отключите VPN/прокси либо подключитесь через IPv4 "
                "и повторите загрузку."
            )
        if "sign" in details or "signature" in details:
            return "Kodik отклонил подпись. Проверьте, что публичный и приватный ключи — одна пара из профиля Kodik."
        if "link" in details or "url" in details:
            return "Kodik не принял ссылку плеера для этой серии. Выберите серию заново и повторите загрузку."
        if response.status_code in {401, 403}:
            return "Kodik не подтвердил доступ к приватному API. Проверьте ключи и права аккаунта Kodik."
        return f"Kodik отклонил запрос прямой ссылки (HTTP {response.status_code})."

    async def _current_public_ipv4(self) -> str:
        if self._public_ip and time.monotonic() < self._public_ip_expires_at:
            return self._public_ip
        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": USER_AGENT}) as client:
                response = await client.get(PUBLIC_IP_ENDPOINT)
                response.raise_for_status()
            address = str(ipaddress.ip_address(response.text.strip()))
        except (httpx.HTTPError, ValueError) as error:
            raise OfflineLibraryError(
                "Не удалось определить публичный IPv4 для подписи Kodik. Проверьте подключение и повторите попытку."
            ) from error
        if ":" in address:
            raise OfflineLibraryError("Kodik требует публичный IPv4 для выдачи прямой ссылки.")
        self._public_ip = address
        self._public_ip_expires_at = time.monotonic() + 300
        return address

class OfflineLibraryService:
    """Persistent offline catalogue plus a single safe background queue."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.settings_file = data_dir / SETTINGS_FILE
        self.private_key_file = data_dir / PRIVATE_KEY_FILE
        self._settings_lock = asyncio.Lock()
        self._index_lock = asyncio.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._cancelled: set[str] = set()
        self._worker: asyncio.Task[None] | None = None
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queue_lock = asyncio.Lock()
        self.resolver = KodikSourceResolver()

    async def settings(self) -> dict[str, str | bool]:
        directory = await self._directory()
        payload = await self._settings_payload()
        return {
            "directory": str(directory),
            "kodikPublicKeyConfigured": bool(str(payload.get("kodikPublicKey") or "").strip()),
            "kodikPrivateKeyConfigured": self.private_key_file.is_file() and self.private_key_file.stat().st_size > 0,
        }

    async def playback_source(self, request: dict[str, Any]) -> dict[str, Any]:
        """Resolve a direct online stream while keeping account secrets local."""

        public_key, private_key = await self._kodik_private_credentials()
        result = await self.resolver.resolve_playback_api(
            str(request.get("iframeUrl") or ""),
            public_key,
            private_key,
            source_id=request.get("sourceId"),
            source_id_type=request.get("sourceIdType"),
            season=request.get("season"),
            episode=request.get("originEpisode") or request.get("episode"),
            translation_id=request.get("translationId"),
            dubbing=request.get("dubbing"),
            source_title=request.get("sourceTitle"),
            source_original_title=request.get("sourceOriginalTitle"),
        )
        if not result.get("sources"):
            raise OfflineLibraryError("Kodik не предоставил прямую ссылку для выбранной серии.")
        return result

    async def set_directory(self, value: str) -> dict[str, str | bool]:
        return await self.update_settings(value)

    async def update_settings(
        self,
        value: str,
        kodik_public_key: str | None = None,
        kodik_private_key: str | None = None,
        clear_kodik_public_key: bool = False,
        clear_kodik_private_key: bool = False,
    ) -> dict[str, str | bool]:
        if any(job["status"] in {"queued", "downloading"} for job in self._jobs.values()):
            raise OfflineLibraryError("Дождитесь окончания или отмените текущую загрузку перед сменой папки.")
        raw = Path(value.strip()).expanduser()
        if not value.strip():
            raise OfflineLibraryError("Укажите папку для офлайн-библиотеки.")
        directory = raw if raw.is_absolute() else (self.data_dir / raw)
        directory = directory.resolve()
        await asyncio.to_thread(directory.mkdir, parents=True, exist_ok=True)
        async with self._settings_lock:
            await asyncio.to_thread(self.data_dir.mkdir, parents=True, exist_ok=True)
            payload = await self._settings_payload_unlocked()
            payload["directory"] = str(directory)
            if kodik_public_key is not None and kodik_public_key.strip():
                payload["kodikPublicKey"] = kodik_public_key.strip()
            elif clear_kodik_public_key:
                payload.pop("kodikPublicKey", None)
            if kodik_private_key is not None and kodik_private_key.strip():
                protected = await asyncio.to_thread(_dpapi_protect, kodik_private_key.strip())
                await self._write_private_key_unlocked(protected)
            elif clear_kodik_private_key:
                await asyncio.to_thread(self._remove_private_key_file)
            # The obsolete public-token integration must never become an
            # implicit fallback after a user has moved to the official API.
            payload.pop("kodikApiToken", None)
            await self._write_json(self.settings_file, payload)
        await self._ensure_index(directory)
        return await self.settings()

    async def library(self) -> dict[str, Any]:
        directory = await self._directory()
        index = await self._read_index(directory)
        episodes = [item for item in index.get("episodes", []) if self._existing_episode(directory, item)]
        if len(episodes) != len(index.get("episodes", [])):
            index["episodes"] = episodes
            await self._save_index(directory, index)
        anime: dict[int, dict[str, Any]] = {}
        for entry in episodes:
            anime_id = int(entry["animeId"])
            target = anime.setdefault(anime_id, {
                "animeId": anime_id,
                "title": entry["title"],
                "year": entry.get("year"),
                "poster": entry.get("poster"),
                "episodes": [],
            })
            target["episodes"].append(self._public_episode(entry))
        for item in anime.values():
            item["episodes"].sort(key=lambda entry: (entry["season"], self._episode_sort_key(entry["episode"]), entry["dubbing"], entry["quality"]))
            if item.get("poster"):
                item["posterUrl"] = f"/api/downloads/posters/{item['animeId']}"
        return {
            "directory": str(directory),
            "anime": sorted(anime.values(), key=lambda item: item["title"].casefold()),
            "jobs": self.jobs(),
        }

    def jobs(self) -> list[dict[str, Any]]:
        return sorted((dict(job) for job in self._jobs.values()), key=lambda item: item["createdAt"], reverse=True)

    async def enqueue(self, request: dict[str, Any]) -> dict[str, Any]:
        directory = await self._directory()
        # Fail before creating a visible queue item when the official Kodik
        # credentials are missing or cannot be read on this Windows account.
        await self._kodik_private_credentials()
        episodes = request.get("episodes")
        if not isinstance(episodes, list) or not episodes:
            raise OfflineLibraryError("Не выбраны серии для загрузки.")
        invalid = [episode for episode in episodes if not isinstance(episode, dict) or not _is_kodik_url(str(episode.get("iframeUrl") or ""))]
        if invalid:
            raise OfflineLibraryError("Для загрузки доступны только серии с источником Kodik.")
        job_id = uuid.uuid4().hex
        job = {
            "id": job_id,
            "status": "queued",
            "title": str(request.get("title") or "Аниме"),
            "quality": int(request.get("quality") or 720),
            "total": len(episodes),
            "completed": 0,
            "progress": 0,
            "current": "",
            "error": "",
            "createdAt": int(time.time() * 1000),
        }
        self._jobs[job_id] = job
        async with self._queue_lock:
            await self._queue.put({"jobId": job_id, "directory": directory, "request": request})
            if self._worker is None or self._worker.done():
                self._worker = asyncio.create_task(self._work_queue())
        return dict(job)

    async def cancel(self, job_id: str) -> None:
        if job_id not in self._jobs:
            raise KeyError(job_id)
        self._cancelled.add(job_id)
        job = self._jobs[job_id]
        if job["status"] == "queued":
            job["status"] = "cancelled"

    async def delete_episode(self, episode_id: str) -> None:
        directory = await self._directory()
        index = await self._read_index(directory)
        episode = next((item for item in index["episodes"] if item.get("id") == episode_id), None)
        if episode is None:
            raise KeyError(episode_id)
        await self._remove_entry_files(directory, episode)
        index["episodes"] = [item for item in index["episodes"] if item.get("id") != episode_id]
        await self._remove_orphaned_posters(directory, [episode], index["episodes"])
        await self._save_index(directory, index)

    async def delete_anime(self, anime_id: int) -> int:
        directory = await self._directory()
        index = await self._read_index(directory)
        selected = [item for item in index["episodes"] if int(item.get("animeId", -1)) == anime_id]
        if not selected:
            raise KeyError(anime_id)
        for episode in selected:
            await self._remove_entry_files(directory, episode)
        index["episodes"] = [item for item in index["episodes"] if int(item.get("animeId", -1)) != anime_id]
        await self._remove_orphaned_posters(directory, selected, index["episodes"])
        await self._save_index(directory, index)
        return len(selected)

    async def media_path(self, episode_id: str, kind: str = "media") -> Path:
        directory = await self._directory()
        index = await self._read_index(directory)
        entry = next((item for item in index["episodes"] if item.get("id") == episode_id), None)
        if entry is None:
            raise KeyError(episode_id)
        relative = entry.get("file") if kind == "media" else entry.get("preview")
        if not isinstance(relative, str):
            raise KeyError(episode_id)
        path = self._path_within(directory, relative)
        if not path.is_file():
            raise KeyError(episode_id)
        return path

    async def poster_path(self, anime_id: int) -> Path:
        directory = await self._directory()
        index = await self._read_index(directory)
        entry = next((item for item in index["episodes"] if int(item.get("animeId", -1)) == anime_id and item.get("poster")), None)
        if entry is None:
            raise KeyError(anime_id)
        path = self._path_within(directory, str(entry["poster"]))
        if not path.is_file():
            raise KeyError(anime_id)
        return path

    async def _work_queue(self) -> None:
        while True:
            item = await self._queue.get()
            job_id = item["jobId"]
            job = self._jobs.get(job_id)
            if not job or job_id in self._cancelled:
                if job:
                    job["status"] = "cancelled"
                self._queue.task_done()
                async with self._queue_lock:
                    if self._queue.empty():
                        self._worker = None
                        return
                continue
            job["status"] = "downloading"
            try:
                await self._download_job(item)
                if job_id in self._cancelled:
                    job["status"] = "cancelled"
                else:
                    job["status"] = "completed"
                    job["progress"] = 1
            except DownloadCancelled:
                job["status"] = "cancelled"
            except Exception as error:  # Keep the queue usable after one broken episode.
                job["status"] = "error"
                job["error"] = str(error) or "Не удалось скачать выбранные серии."
            finally:
                self._queue.task_done()
                self._trim_jobs()
            async with self._queue_lock:
                if self._queue.empty():
                    self._worker = None
                    return

    async def _download_job(self, item: dict[str, Any]) -> None:
        job_id = str(item["jobId"])
        job = self._jobs[job_id]
        directory: Path = item["directory"]
        request: dict[str, Any] = item["request"]
        await self._ensure_index(directory)
        await self._download_artwork(directory, request, "poster")
        episodes = request["episodes"]
        for position, episode in enumerate(episodes, start=1):
            if job_id in self._cancelled:
                raise DownloadCancelled
            if not isinstance(episode, dict):
                raise OfflineLibraryError("Очередь содержит неверно описанную серию.")
            label = f"Серия {episode.get('episode', position)}"
            job["current"] = label
            await self._download_episode(directory, request, episode, job, position - 1, job_id)
            job["completed"] = position
            job["progress"] = position / len(episodes)

    async def _download_episode(
        self,
        directory: Path,
        request: dict[str, Any],
        episode: dict[str, Any],
        job: dict[str, Any],
        done_before: int,
        job_id: str,
    ) -> None:
        quality = int(request.get("quality") or 720)
        public_key, private_key = await self._kodik_private_credentials()
        source, actual_quality = await self.resolver.resolve_private_api(
            str(episode.get("iframeUrl") or ""),
            quality,
            public_key,
            private_key,
            source_id=episode.get("sourceId"),
            source_id_type=episode.get("sourceIdType"),
            season=episode.get("season"),
            episode=episode.get("originEpisode") or episode.get("episode"),
            translation_id=episode.get("translationId"),
            dubbing=episode.get("dubbing"),
            source_title=episode.get("sourceTitle") or request.get("title"),
            source_original_title=episode.get("sourceOriginalTitle"),
        )
        anime_id = int(request["animeId"])
        season = int(episode.get("season") or 1)
        number = str(episode.get("episode") or "0")
        dubbing = str(episode.get("dubbing") or "Неизвестно")
        episode_id = hashlib.sha256(f"{anime_id}|{season}|{number}|{dubbing}|{actual_quality}".encode()).hexdigest()[:24]
        index = await self._read_index(directory)
        if any(item.get("id") == episode_id and self._existing_episode(directory, item) for item in index["episodes"]):
            return
        anime_folder = _anime_folder_name(request)
        season_folder = f"Сезон {season:02d}"
        base_name = _safe_name(f"{anime_folder} — {number} — {dubbing} — {actual_quality}p", episode_id)
        relative = str(Path(anime_folder) / season_folder / f"{base_name}.mp4")
        target = self._path_within(directory, relative)
        await asyncio.to_thread(target.parent.mkdir, parents=True, exist_ok=True)
        partial = target.with_suffix(".part.mp4")
        try:
            await self._stream_to_file(
                source,
                partial,
                job,
                done_before,
                int(job["total"]),
                job_id,
                float(episode.get("duration") or 0),
            )
            await asyncio.to_thread(partial.replace, target)
        except Exception:
            if partial.exists():
                await asyncio.to_thread(partial.unlink)
            raise
        preview = await self._download_episode_preview(directory, request, episode, anime_folder, season_folder, episode_id)
        poster = await self._poster_relative(directory, request, anime_folder)
        record = {
            "id": episode_id,
            "animeId": anime_id,
            "title": str(request.get("title") or "Аниме"),
            "year": request.get("year"),
            "season": season,
            "episode": number,
            "originAnimeId": episode.get("originAnimeId"),
            "originEpisode": str(episode.get("originEpisode") or number),
            "dubbing": dubbing,
            "translationId": episode.get("translationId"),
            "quality": actual_quality,
            "duration": episode.get("duration"),
            "file": relative,
            "poster": poster,
            "preview": preview,
            "downloadedAt": int(time.time() * 1000),
        }
        index["episodes"] = [item for item in index["episodes"] if item.get("id") != episode_id] + [record]
        await self._save_index(directory, index)

    async def _stream_to_file(
        self,
        source: str,
        target: Path,
        job: dict[str, Any],
        done_before: int,
        total: int,
        job_id: str,
        duration: float = 0,
    ) -> None:
        if source.endswith(":hls:manifest.m3u8") or ".m3u8" in source.split("?", 1)[0]:
            await self._stream_hls_to_file(source, target, job, done_before, total, job_id, duration)
            return
        headers = {"User-Agent": USER_AGENT, "Referer": "https://kodik.info/"}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(35.0, read=120.0),
            follow_redirects=True,
            headers=headers,
        ) as client:
            async with client.stream("GET", source) as response:
                response.raise_for_status()
                content_length = int(response.headers.get("content-length", "0") or 0)
                written = 0
                with target.open("wb") as file:
                    async for chunk in response.aiter_bytes(512 * 1024):
                        if job_id in self._cancelled:
                            raise DownloadCancelled
                        file.write(chunk)
                        written += len(chunk)
                        if content_length:
                            episode_progress = written / content_length
                            job["progress"] = min(.99, (done_before + episode_progress) / total)

    async def _stream_hls_to_file(
        self,
        source: str,
        target: Path,
        job: dict[str, Any],
        done_before: int,
        total: int,
        job_id: str,
        duration: float,
    ) -> None:
        """Remux a Kodik HLS playlist into a seekable MP4 using bundled ffmpeg."""

        try:
            executable = await asyncio.to_thread(self._ffmpeg_executable)
        except (ImportError, OSError) as error:
            raise OfflineLibraryError("Не удалось подготовить ffmpeg для сборки видео.") from error
        process = await asyncio.create_subprocess_exec(
            executable,
            "-y",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            source,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            str(target),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # ``readline`` returns an empty byte string once ffmpeg closes stdout.
        # Do not spin on that state: wait for the child and collect its exit
        # status so both successful jobs and errors settle deterministically.
        while True:
            if job_id in self._cancelled:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=3)
                except TimeoutError:
                    process.kill()
                    await process.wait()
                raise DownloadCancelled
            try:
                line = await asyncio.wait_for(process.stdout.readline(), timeout=.25)
            except TimeoutError:
                if process.returncode is not None:
                    break
                continue
            if not line:
                await process.wait()
                break
            key, _, raw_value = line.decode("utf-8", "replace").strip().partition("=")
            if key not in {"out_time_ms", "out_time_us"} or duration <= 0:
                continue
            try:
                seconds = int(raw_value) / 1_000_000
            except ValueError:
                continue
            episode_progress = min(.99, max(0, seconds / duration))
            job["progress"] = max(job["progress"], (done_before + episode_progress) / total)
        return_code = await process.wait()
        error_text = (await process.stderr.read()).decode("utf-8", "replace").strip()
        if return_code != 0:
            details = error_text.splitlines()[-1] if error_text else "ffmpeg завершился с ошибкой."
            raise OfflineLibraryError(f"Не удалось собрать видеопоток Kodik: {details[:280]}")

    @staticmethod
    def _ffmpeg_executable() -> str:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()

    async def _download_artwork(self, directory: Path, request: dict[str, Any], kind: str) -> None:
        url = request.get(f"{kind}Url")
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            return
        anime_folder = _anime_folder_name(request)
        suffix = ".jpg" if kind == "poster" else ".bin"
        relative = str(Path(anime_folder) / f"{kind}{suffix}")
        target = self._path_within(directory, relative)
        if target.is_file():
            return
        await asyncio.to_thread(target.parent.mkdir, parents=True, exist_ok=True)
        try:
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
                response = await client.get(url)
                response.raise_for_status()
            await asyncio.to_thread(target.write_bytes, response.content)
        except httpx.HTTPError:
            return

    async def _download_episode_preview(
        self,
        directory: Path,
        request: dict[str, Any],
        episode: dict[str, Any],
        anime_folder: str,
        season_folder: str,
        episode_id: str,
    ) -> str | None:
        url = episode.get("previewUrl")
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            return None
        relative = str(Path(anime_folder) / season_folder / f"{episode_id}.jpg")
        target = self._path_within(directory, relative)
        if target.is_file():
            return relative
        try:
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
                response = await client.get(url)
                response.raise_for_status()
            await asyncio.to_thread(target.parent.mkdir, parents=True, exist_ok=True)
            await asyncio.to_thread(target.write_bytes, response.content)
            return relative
        except httpx.HTTPError:
            return None

    async def _poster_relative(self, directory: Path, request: dict[str, Any], anime_folder: str) -> str | None:
        candidate = self._path_within(directory, str(Path(anime_folder) / "poster.jpg"))
        return str(Path(anime_folder) / "poster.jpg") if candidate.is_file() else None

    async def _directory(self) -> Path:
        async with self._settings_lock:
            payload = await self._settings_payload_unlocked()
            configured = payload.get("directory")
            if isinstance(configured, str) and configured.strip():
                directory = Path(configured)
            else:
                directory = self.data_dir / "downloads"
            directory = directory.resolve()
            await asyncio.to_thread(directory.mkdir, parents=True, exist_ok=True)
        await self._ensure_index(directory)
        return directory

    async def _settings_payload(self) -> dict[str, Any]:
        async with self._settings_lock:
            return await self._settings_payload_unlocked()

    async def _settings_payload_unlocked(self) -> dict[str, Any]:
        if not self.settings_file.is_file():
            return {}
        try:
            payload = json.loads(await asyncio.to_thread(self.settings_file.read_text, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return dict(payload) if isinstance(payload, dict) else {}

    async def _kodik_private_credentials(self) -> tuple[str, str]:
        payload = await self._settings_payload()
        public_key = str(payload.get("kodikPublicKey") or "").strip()
        if not public_key or not self.private_key_file.is_file():
            raise OfflineLibraryError(
                "Добавьте публичный и приватный ключи Kodik в настройках офлайн-библиотеки."
            )
        try:
            protected = await asyncio.to_thread(self.private_key_file.read_text, encoding="utf-8")
            private_key = await asyncio.to_thread(_dpapi_unprotect, protected.strip())
        except OSError as error:
            raise OfflineLibraryError("Не удалось прочитать защищённый приватный ключ Kodik.") from error
        if not private_key.strip():
            raise OfflineLibraryError("Приватный ключ Kodik не задан.")
        return public_key, private_key.strip()

    async def _write_private_key_unlocked(self, protected: str) -> None:
        temporary = self.private_key_file.with_suffix(self.private_key_file.suffix + ".tmp")
        await asyncio.to_thread(temporary.write_text, protected + "\n", encoding="utf-8")
        await asyncio.to_thread(temporary.replace, self.private_key_file)

    def _remove_private_key_file(self) -> None:
        if self.private_key_file.exists():
            self.private_key_file.unlink()

    async def _ensure_index(self, directory: Path) -> None:
        index_file = directory / INDEX_FILE
        if not index_file.is_file():
            await self._write_json(index_file, {"version": 1, "episodes": []})

    async def _read_index(self, directory: Path) -> dict[str, Any]:
        async with self._index_lock:
            await self._ensure_index(directory)
            try:
                data = json.loads(await asyncio.to_thread((directory / INDEX_FILE).read_text, encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {"version": 1, "episodes": []}
            if not isinstance(data, dict) or not isinstance(data.get("episodes"), list):
                return {"version": 1, "episodes": []}
            return data

    async def _save_index(self, directory: Path, index: dict[str, Any]) -> None:
        async with self._index_lock:
            await self._write_json(directory / INDEX_FILE, index)

    async def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        await asyncio.to_thread(temporary.write_text, serialized, encoding="utf-8")
        await asyncio.to_thread(temporary.replace, path)

    def _path_within(self, directory: Path, relative: str) -> Path:
        candidate = (directory / relative).resolve()
        try:
            candidate.relative_to(directory)
        except ValueError as error:
            raise OfflineLibraryError("Недопустимый путь в офлайн-библиотеке.") from error
        return candidate

    def _existing_episode(self, directory: Path, entry: dict[str, Any]) -> bool:
        relative = entry.get("file")
        return isinstance(relative, str) and self._path_within(directory, relative).is_file()

    async def _remove_entry_files(self, directory: Path, entry: dict[str, Any]) -> None:
        for key in ("file", "preview"):
            relative = entry.get(key)
            if not isinstance(relative, str):
                continue
            path = self._path_within(directory, relative)
            if path.is_file():
                await asyncio.to_thread(path.unlink)
                await self._remove_empty_parents(directory, path.parent)

    async def _remove_orphaned_posters(
        self,
        directory: Path,
        removed: list[dict[str, Any]],
        remaining: list[dict[str, Any]],
    ) -> None:
        retained = {item.get("poster") for item in remaining if isinstance(item.get("poster"), str)}
        posters = {item.get("poster") for item in removed if isinstance(item.get("poster"), str)}
        for relative in posters - retained:
            path = self._path_within(directory, str(relative))
            if path.is_file():
                await asyncio.to_thread(path.unlink)
                await self._remove_empty_parents(directory, path.parent)

    async def _remove_empty_parents(self, directory: Path, start: Path) -> None:
        current = start
        while current != directory:
            try:
                await asyncio.to_thread(current.rmdir)
            except OSError:
                return
            current = current.parent

    @staticmethod
    def _public_episode(entry: dict[str, Any]) -> dict[str, Any]:
        result = {key: entry.get(key) for key in (
            "id", "animeId", "season", "episode", "originAnimeId", "originEpisode",
            "dubbing", "translationId", "quality", "duration", "downloadedAt",
        )}
        result["mediaUrl"] = f"/api/downloads/media/{entry['id']}"
        if entry.get("preview"):
            result["previewUrl"] = f"/api/downloads/previews/{entry['id']}"
        return result

    @staticmethod
    def _episode_sort_key(value: str) -> tuple[int, str]:
        try:
            return (0, f"{float(value):012.4f}")
        except ValueError:
            return (1, value)

    def _trim_jobs(self) -> None:
        if len(self._jobs) <= 40:
            return
        finished = [item for item in self._jobs.values() if item["status"] in {"completed", "cancelled", "error"}]
        for item in sorted(finished, key=lambda value: value["createdAt"])[: max(0, len(self._jobs) - 40)]:
            self._jobs.pop(item["id"], None)
            self._cancelled.discard(item["id"])
