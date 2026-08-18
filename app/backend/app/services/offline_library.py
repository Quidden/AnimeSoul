"""Local offline library and Kodik download queue for AnimeSoul.

The service deliberately keeps its catalogue next to the downloaded media.  As
a result, titles, posters and episode records remain available even when the
network (or the upstream catalogue) is unavailable.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx


INDEX_FILE = ".animesoul-library.json"
SETTINGS_FILE = "animesoul-offline-settings.json"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnimeSoul/0.2"


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


def _json_from_script(value: str, variable: str) -> dict[str, Any]:
    assignment = re.search(rf"\b{re.escape(variable)}\b\s*=", value)
    if not assignment:
        raise OfflineLibraryError("Плеер Kodik не передал параметры ссылки.")
    start = value.find("{", assignment.end())
    if start < 0:
        raise OfflineLibraryError("Плеер Kodik не передал параметры ссылки.")
    depth = 0
    quote: str | None = None
    escaped = False
    end = -1
    for index, character in enumerate(value[start:], start):
        if quote:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character in {"'", '"'}:
            quote = character
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end < 0:
        raise OfflineLibraryError("Плеер Kodik передал неполные параметры ссылки.")
    try:
        parsed = json.loads(value[start:end])
    except json.JSONDecodeError as error:
        raise OfflineLibraryError("Не удалось прочитать параметры плеера Kodik.") from error
    if not isinstance(parsed, dict):
        raise OfflineLibraryError("Параметры плеера Kodik имеют неверный формат.")
    return parsed


def _base64_text(value: str) -> str | None:
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.b64decode(padded).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def _rotate_letters(value: str, shift: int) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    result: list[str] = []
    for character in value:
        upper = character.upper()
        if upper not in alphabet:
            result.append(character)
            continue
        replacement = alphabet[(alphabet.index(upper) + shift) % len(alphabet)]
        result.append(replacement.lower() if character.islower() else replacement)
    return "".join(result)


def _decode_kodik_source(value: str) -> str:
    if "mp4:hls:manifest" in value or value.startswith(("https://", "http://", "//")):
        return _normalise_url(value)
    for shift in range(26):
        decoded = _base64_text(_rotate_letters(value, shift))
        if decoded and "mp4:hls:manifest" in decoded:
            return decoded
    raise OfflineLibraryError("Kodik вернул неподдерживаемый формат ссылки.")


def _kodik_media_id(embed_url: str) -> str:
    """Convert a Kodik player URL into the documented ``serial-123`` ID."""

    if not _is_kodik_url(embed_url):
        raise OfflineLibraryError("Для загрузки поддерживаются только источники Kodik.")
    parts = [part for part in urlparse(_normalise_url(embed_url)).path.split("/") if part]
    for index, part in enumerate(parts[:-1]):
        if part not in {"serial", "video", "movie"}:
            continue
        media_id = parts[index + 1]
        if media_id.isdigit():
            return f"{'serial' if part == 'serial' else 'movie'}-{media_id}"
    raise OfflineLibraryError("Не удалось определить идентификатор видео Kodik для API.")


def _source_reference(
    embed_url: str,
    catalog_id: object = None,
    catalog_id_type: object = None,
) -> tuple[str, str]:
    """Choose a documented Kodik lookup reference for an embed.

    Modern ``/season/<id>`` embeds carry a player-session id, not Kodik's
    public ``serial-<id>`` identifier.  YummyAnime supplies a stable external
    id (normally Shikimori), which is the correct lookup key for those embeds.
    Older ``/serial`` and movie embeds remain usable without that extra id.
    """

    if isinstance(catalog_id, (str, int)) and str(catalog_id).strip():
        kind = str(catalog_id_type or "shikimori").strip().lower()
        if kind in {
            "shikimori",
            "kinopoisk",
            "imdb",
            "mdl",
            "kodik",
            "worldart_animation",
            "worldart_cinema",
        }:
            return str(catalog_id).strip(), kind
    return _kodik_media_id(embed_url), "kodik"


def _normalise_dubbing(value: object) -> str:
    text = str(value or "").casefold().replace("ё", "е")
    text = re.sub(r"\b(?:озвучка|дубляж|voice|dub)\b", " ", text)
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).strip()


def _episode_number(value: object) -> int:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError) as error:
        raise OfflineLibraryError("Kodik API поддерживает загрузку только серий с числовым номером.") from error
    if number < 0:
        raise OfflineLibraryError("Номер серии для Kodik API не может быть отрицательным.")
    return number


class KodikSourceResolver:
    """Resolve a selected Kodik embed through the API-compatible route.

    The player endpoint itself may refuse requests made outside the embed, so
    downloads use the API-compatible resolver and then remux its HLS playlist
    into a local MP4 file.
    """

    async def resolve_via_api(
        self,
        embed_url: str,
        quality: int,
        episode: object,
        translation_id: object,
        token: str = "",
        catalog_id: object = None,
        catalog_id_type: object = None,
        dubbing: object = None,
    ) -> tuple[str, int]:
        """Use the public Kodik API path to request a quality-specific file.

        ``anime-parsers-ru`` wraps Kodik's public ``get-player`` route and
        returns the CDN directory described by that API.  When the user has
        not supplied a local override token, it uses the same automatic public
        token discovery as the referenced Kodik downloader.  It is run in a
        worker thread because the package uses synchronous HTTP requests.
        """

        media_id, media_id_type = _source_reference(embed_url, catalog_id, catalog_id_type)
        episode_number = _episode_number(episode)
        selected_translation = str(translation_id or "0")
        selected_quality = max(144, min(int(quality or 720), 2160))
        try:
            base_url, max_quality = await asyncio.to_thread(
                self._api_link,
                token,
                media_id,
                media_id_type,
                episode_number,
                selected_translation,
                dubbing,
            )
        except OfflineLibraryError:
            raise
        except Exception as error:
            raise OfflineLibraryError(
                "Kodik API не смог предоставить прямую ссылку. Проверьте API-токен, "
                "выбранную озвучку и доступность серии."
            ) from error
        actual_quality = min(selected_quality, int(max_quality))
        if actual_quality < 144:
            raise OfflineLibraryError("Kodik API не сообщил доступное качество для этой серии.")
        # Kodik exposes the selected rendition as an HLS manifest.  Saving
        # that text response as `.mp4` was the previous broken behaviour;
        # `_stream_to_file` now lets ffmpeg remux the segments into MP4.
        return (
            f"{_normalise_url(str(base_url).rstrip('/') + '/')}{actual_quality}.mp4:hls:manifest.m3u8",
            actual_quality,
        )

    @staticmethod
    def _api_link(
        token: str,
        media_id: str,
        media_id_type: str,
        episode_number: int,
        translation_id: str,
        dubbing: object = None,
    ) -> tuple[str, int]:
        try:
            from anime_parsers_ru import KodikParser
        except ImportError as error:
            raise OfflineLibraryError("Не установлена поддержка Kodik API. Перезапустите AnimeSoul.") from error
        parser = KodikParser(token=token or None, validate_token=bool(token))
        if translation_id == "0":
            translation_id = KodikSourceResolver._matching_translation_id(
                parser,
                media_id,
                media_id_type,
                dubbing,
            )
        base_url, max_quality, _skips = parser.get_link(
            id=media_id,
            id_type=media_id_type,
            seria_num=episode_number,
            translation_id=translation_id,
        )
        return str(base_url), int(max_quality)

    @staticmethod
    def _matching_translation_id(
        parser: Any,
        media_id: str,
        media_id_type: str,
        dubbing: object,
    ) -> str:
        """Find the Kodik translation matching YummyAnime's displayed dub.

        Yummy's ``player_id`` identifies the provider, not the translation.
        If it has no real ``translation_id``, the public search response gives
        us translation names and ids for the stable external catalog id.
        """

        target = _normalise_dubbing(dubbing)
        field_by_type = {
            "shikimori": "shikimori_id",
            "kinopoisk": "kinopoisk_id",
            "imdb": "imdb_id",
            "mdl": "mdl_id",
            "worldart_animation": "worldart_animation_id",
            "worldart_cinema": "worldart_cinema_id",
        }
        field = field_by_type.get(media_id_type)
        if not target or not field:
            return "0"
        try:
            response = parser.api_request("search", {field: media_id})
        except Exception:
            return "0"
        rows = response.get("results", []) if isinstance(response, dict) else []
        exact: str | None = None
        partial: str | None = None
        for row in rows:
            if not isinstance(row, dict):
                continue
            translation = row.get("translation")
            if not isinstance(translation, dict):
                continue
            candidate_id = translation.get("id")
            candidate = _normalise_dubbing(translation.get("title"))
            if not isinstance(candidate_id, (str, int)) or not candidate:
                continue
            if candidate == target:
                exact = str(candidate_id)
                break
            if candidate in target or target in candidate:
                partial = partial or str(candidate_id)
        return exact or partial or "0"

    async def resolve(self, embed_url: str, quality: int) -> tuple[str, int]:
        if not _is_kodik_url(embed_url):
            raise OfflineLibraryError("Для загрузки поддерживаются только источники Kodik.")
        embed_url = _normalise_url(embed_url)
        headers = {"User-Agent": USER_AGENT, "Referer": embed_url}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(35.0, read=70.0),
            follow_redirects=True,
            headers=headers,
        ) as client:
            page_response = await client.get(embed_url)
            page_response.raise_for_status()
            page = page_response.text
            params = _json_from_script(page, "urlParams")
            video_type = self._script_value(page, "type")
            video_hash = self._script_value(page, "hash")
            video_id = self._script_value(page, "id")
            endpoint = await self._player_endpoint(client, embed_url, page)
            payload = {
                "hash": video_hash,
                "id": video_id,
                "type": video_type,
                "d": str(params.get("d", "")),
                "d_sign": str(params.get("d_sign", "")),
                "pd": str(params.get("pd", "")),
                "pd_sign": str(params.get("pd_sign", "")),
                "ref": "",
                "ref_sign": str(params.get("ref_sign", "")),
                "bad_user": "true",
                "cdn_is_working": "true",
            }
            if not all(payload[key] for key in ("hash", "id", "type", "d", "d_sign", "pd", "pd_sign", "ref_sign")):
                raise OfflineLibraryError("В плеере Kodik отсутствуют подписанные параметры видео.")
            response = await client.post(urljoin(embed_url, endpoint), data=payload)
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                if endpoint == "/ftor" and response.status_code >= 400:
                    raise OfflineLibraryError(
                        "Kodik не разрешил получить видеопоток для офлайн-сохранения. "
                        "Это ограничение источника, а не ошибка выбранного качества. "
                        "Серию можно смотреть в плеере; для скачивания нужен источник, "
                        "который предоставляет разрешённую прямую ссылку на файл."
                    ) from error
                raise
            try:
                data = response.json()
            except json.JSONDecodeError as error:
                raise OfflineLibraryError("Kodik вернул некорректный ответ на запрос видео.") from error
        links = data.get("links") if isinstance(data, dict) else None
        if not isinstance(links, dict):
            raise OfflineLibraryError("Kodik не предоставил доступные качества видео.")
        available = sorted((int(item) for item in links if str(item).isdigit()), reverse=True)
        selected = next((item for item in available if item <= quality), available[-1] if available else None)
        if selected is None:
            raise OfflineLibraryError("Kodik не предоставил качества для этой серии.")
        sources = links.get(str(selected))
        source = sources[0].get("src") if isinstance(sources, list) and sources and isinstance(sources[0], dict) else None
        if not isinstance(source, str):
            raise OfflineLibraryError("Kodik не передал ссылку на выбранное качество.")
        resolved = _decode_kodik_source(source)
        return resolved.replace(":hls:manifest.m3u8", ""), selected

    @staticmethod
    def _script_value(page: str, name: str) -> str:
        match = re.search(
            rf"(?:\.|\b(?:var|let|const)\s+){re.escape(name)}\s*=\s*['\"]([^'\"]+)['\"]",
            page,
        )
        if not match:
            raise OfflineLibraryError(f"В плеере Kodik не найден параметр {name}.")
        return match.group(1)

    async def _player_endpoint(
        self,
        client: httpx.AsyncClient,
        embed_url: str,
        page: str,
    ) -> str:
        sources = re.findall(r"<script[^>]+src=[\"']([^\"']+)[\"']", page, re.I)
        for source in sources:
            script_url = urljoin(embed_url, source)
            if not _is_kodik_url(script_url):
                continue
            script_response = await client.get(script_url)
            if script_response.status_code >= 400:
                continue
            endpoint = self._endpoint_from_script(script_response.text)
            if endpoint:
                return endpoint
        raise OfflineLibraryError("Не удалось найти служебный запрос плеера Kodik.")

    @staticmethod
    def _endpoint_from_script(script: str) -> str | None:
        direct = re.search(r"\burl\s*:\s*['\"](/[^'\"]*(?:video|player)[^'\"]*)['\"]", script, re.I)
        if direct:
            return direct.group(1)
        # Current Kodik builds keep the video endpoint in an `atob()` call.
        # In August 2026 that value is `/ftor`, so the old search for a URL
        # containing "video" or "player" never found it.
        for encoded in re.findall(r"\burl\s*:\s*atob\(\s*['\"]([A-Za-z0-9+/=_-]+)['\"]\s*\)", script, re.I):
            decoded = _base64_text(encoded)
            if decoded and re.fullmatch(r"/[A-Za-z0-9_./-]+", decoded):
                return decoded
        ajax_at = script.find("$.ajax")
        cache_at = script.find("cache:!1", ajax_at)
        if ajax_at >= 0 and cache_at > ajax_at:
            legacy = script[ajax_at + 30 : cache_at - 3].strip(" '\"")
            decoded = _base64_text(legacy)
            if decoded and decoded.startswith("/"):
                return decoded
        for candidate in re.findall(r"[\"']([A-Za-z0-9+/=_-]{20,})[\"']", script):
            decoded = _base64_text(candidate)
            if decoded and decoded.startswith("/") and "video" in decoded:
                return decoded
        return None


class OfflineLibraryService:
    """Persistent offline catalogue plus a single safe background queue."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.settings_file = data_dir / SETTINGS_FILE
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
            "kodikApiTokenConfigured": bool(str(payload.get("kodikApiToken") or "").strip()),
        }

    async def set_directory(self, value: str) -> dict[str, str | bool]:
        return await self.update_settings(value)

    async def update_settings(
        self,
        value: str,
        kodik_api_token: str | None = None,
        clear_kodik_api_token: bool = False,
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
            if kodik_api_token is not None and kodik_api_token.strip():
                payload["kodikApiToken"] = kodik_api_token.strip()
            elif clear_kodik_api_token:
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
        token = await self._kodik_api_token()
        source, actual_quality = await self.resolver.resolve_via_api(
            str(episode.get("iframeUrl") or ""),
            quality,
            episode.get("originEpisode") or episode.get("episode"),
            episode.get("translationId"),
            token,
            episode.get("sourceId"),
            episode.get("sourceIdType"),
            episode.get("dubbing"),
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
        if source.endswith(":hls:manifest.m3u8"):
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

    async def _kodik_api_token(self) -> str:
        payload = await self._settings_payload()
        token = payload.get("kodikApiToken")
        return token.strip() if isinstance(token, str) else ""

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
