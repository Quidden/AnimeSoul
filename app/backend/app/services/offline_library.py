"""Local offline library and Kodik download queue for AnimeSoul.

The service deliberately keeps its catalogue next to the downloaded media.  As
a result, titles, posters and episode records remain available even when the
network (or the upstream catalogue) is unavailable.
"""

from __future__ import annotations

import asyncio
import base64
import copy
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from .kodik_helpers import (
    CredentialVerificationUnavailable as CredentialVerificationUnavailable,
    OfflineLibraryError as OfflineLibraryError,
    _episode_link_from_results as _episode_link_from_results,
    _first_kodik_player_link as _first_kodik_player_link,
    _is_kodik_url as _is_kodik_url,
    _kodik_player_candidates as _kodik_player_candidates,
    _kodik_signature as _kodik_signature,
    _normalise_dubbing as _normalise_dubbing,
    _normalise_kodik_skips as _normalise_kodik_skips,
    _normalise_kodik_sources as _normalise_kodik_sources,
    _normalise_kodik_subtitles as _normalise_kodik_subtitles,
    _normalise_title as _normalise_title,
    _normalise_url as _normalise_url,
    _private_player_link as _private_player_link,
    _sanitize_skip_segments as _sanitize_skip_segments,
    _search_identifier_name as _search_identifier_name,
    _select_kodik_source as _select_kodik_source,
    _source_value as _source_value,
)
from .kodik_resolver import KodikSourceResolver as KodikSourceResolver
from .kodik_resolver import USER_AGENT as USER_AGENT


INDEX_FILE = ".animesoul-library.json"
SETTINGS_FILE = "animesoul-offline-settings.json"
PRIVATE_KEY_FILE = "animesoul-kodik-private.dpapi"


def _is_android_runtime() -> bool:
    """Return whether the service is running inside the bundled Android app."""

    return os.getenv("ANIMESOUL_MOBILE", "").casefold() == "android"


def _is_hls_source(value: str) -> bool:
    path = urlparse(value).path.casefold()
    return value.endswith(":hls:manifest.m3u8") or path.endswith(".m3u8")


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


def _download_episode_key(
    anime_id: int,
    episode: dict[str, Any],
    quality: int,
) -> str:
    """Return a stable identity used to keep queued selections duplicate-free."""

    return "|".join((
        str(anime_id),
        str(int(episode.get("season") or 1)),
        str(episode.get("episode") or "").strip(),
        str(episode.get("dubbing") or "").strip().casefold(),
        str(int(quality)),
    ))


def _android_video_record(item: dict[str, Any]) -> dict[str, Any] | None:
    """Rebuild one library row from AnimeSoul's public MediaStore layout."""

    relative_path = str(item.get("relativePath") or "").replace("\\", "/").strip("/")
    display_name = str(item.get("displayName") or "").strip()
    external_path = str(item.get("path") or "").strip()
    content_uri = str(item.get("uri") or "").strip()
    parts = [part for part in relative_path.split("/") if part]
    try:
        root_index = next(index for index, part in enumerate(parts) if part.casefold() == "animesoul")
        anime_folder = parts[root_index + 1]
        season_folder = parts[root_index + 2]
    except (StopIteration, IndexError):
        return None

    anime_match = re.fullmatch(r"(.+?) \[(\d+)]", anime_folder)
    season_match = re.fullmatch(r"Сезон\s+(\d+)", season_folder, re.IGNORECASE)
    prefix = f"{anime_folder} — "
    if not anime_match or not season_match or not display_name.startswith(prefix):
        return None
    try:
        number, dubbing, quality_label = display_name[len(prefix):].rsplit(" — ", 2)
    except ValueError:
        return None
    quality_match = re.fullmatch(r"(\d+)p\.mp4", quality_label, re.IGNORECASE)
    if not quality_match or not number.strip() or not dubbing.strip() or not external_path or not content_uri:
        return None

    anime_id = int(anime_match.group(2))
    season = int(season_match.group(1))
    quality = int(quality_match.group(1))
    number = number.strip()
    dubbing = dubbing.strip()
    episode_id = hashlib.sha256(
        f"{anime_id}|{season}|{number}|{dubbing}|{quality}".encode()
    ).hexdigest()[:24]
    downloaded_at = int(item.get("dateModified") or 0) * 1000
    return {
        "id": episode_id,
        "animeId": anime_id,
        "title": anime_match.group(1).strip(),
        "year": None,
        "season": season,
        "seasonLabel": f"Сезон {season}",
        "episode": number,
        "originAnimeId": anime_id,
        "originEpisode": number,
        "dubbing": dubbing,
        "translationId": None,
        "quality": quality,
        "duration": None,
        "file": str(Path(anime_folder) / season_folder / display_name),
        "poster": None,
        "preview": None,
        "mediaType": "video/mp4",
        "skips": {},
        "downloadedAt": downloaded_at or int(time.time() * 1000),
        "contentUri": content_uri,
        "externalPath": external_path,
        "sizeBytes": max(0, int(item.get("sizeBytes") or 0)),
        "recovered": True,
    }


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _dpapi_protect(value: str) -> str:
    """Encrypt a local secret with the current Windows account's DPAPI key."""

    if _is_android_runtime():
        # Android's per-application data directory is protected by the OS
        # sandbox and is removed on uninstall. The marker prevents this
        # representation from ever being mistaken for a Windows DPAPI blob.
        return "android-sandbox:" + base64.b64encode(value.encode("utf-8")).decode("ascii")
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
    if _is_android_runtime():
        marker = "android-sandbox:"
        if not value.startswith(marker):
            raise OfflineLibraryError("Приватный ключ Kodik сохранён в несовместимом формате.")
        try:
            return base64.b64decode(value[len(marker):].encode("ascii"), validate=True).decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError, ValueError) as error:
            raise OfflineLibraryError("Не удалось прочитать приватный ключ Kodik.") from error
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
        self._active_downloads: dict[str, asyncio.Task[None]] = {}
        self._active_processes: dict[str, asyncio.subprocess.Process] = {}
        self._worker: asyncio.Task[None] | None = None
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queue_lock = asyncio.Lock()
        self._network_type = "unknown"
        self._network_changed = asyncio.Event()
        self._network_changed.set()
        # Android HLS playback requests a new local segment every few seconds.
        # Resolving every segment used to reread both settings and the complete
        # library index from flash. Keep only already-validated paths in memory;
        # index commits and directory changes invalidate them atomically.
        self._directory_cache: Path | None = None
        self._media_path_cache: dict[tuple[str, str], Path] = {}
        self._asset_directory_cache: dict[str, Path] = {}
        self._library_cache: tuple[float, dict[str, Any]] | None = None
        self._library_cache_lock = asyncio.Lock()
        self.resolver = KodikSourceResolver()

    async def settings(self) -> dict[str, str | bool]:
        directory = await self._directory()
        payload = await self._settings_payload()
        return {
            "directory": str(directory),
            "allowMobileDownloads": bool(payload.get("allowMobileDownloads", False)),
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
        allow_mobile_downloads: bool | None = None,
    ) -> dict[str, str | bool]:
        raw = Path(value.strip()).expanduser()
        if not value.strip():
            raise OfflineLibraryError("Укажите папку для офлайн-библиотеки.")
        directory = raw if raw.is_absolute() else (self.data_dir / raw)
        directory = directory.resolve()
        current_directory = await self._directory()
        if directory != current_directory and any(
            job["status"] in {"queued", "downloading", "paused"} for job in self._jobs.values()
        ):
            raise OfflineLibraryError("Дождитесь окончания или отмените текущую загрузку перед сменой папки.")
        await asyncio.to_thread(directory.mkdir, parents=True, exist_ok=True)
        async with self._settings_lock:
            await asyncio.to_thread(self.data_dir.mkdir, parents=True, exist_ok=True)
            payload = await self._settings_payload_unlocked()
            payload["directory"] = str(directory)
            if allow_mobile_downloads is not None:
                payload["allowMobileDownloads"] = bool(allow_mobile_downloads)
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
        self._directory_cache = directory
        self._invalidate_playback_path_cache()
        self._network_changed.set()
        return await self.settings()

    async def set_network_type(self, value: str) -> dict[str, str]:
        """Update Android connectivity without trusting WebView timers."""

        network_type = value.casefold().strip()
        if network_type not in {"wifi", "mobile", "ethernet", "vpn", "none", "unknown"}:
            network_type = "unknown"
        self._network_type = network_type
        self._network_changed.set()
        return {"type": network_type}

    async def library(self) -> dict[str, Any]:
        now = time.monotonic()
        cached = self._library_cache
        if cached and now - cached[0] < 15:
            return {**copy.deepcopy(cached[1]), "jobs": self.jobs()}

        async with self._library_cache_lock:
            cached = self._library_cache
            if cached and time.monotonic() - cached[0] < 15:
                return {**copy.deepcopy(cached[1]), "jobs": self.jobs()}
            snapshot = await self._library_snapshot()
            self._library_cache = (time.monotonic(), snapshot)
            return {**copy.deepcopy(snapshot), "jobs": self.jobs()}

    async def anime(self, anime_id: int) -> dict[str, Any] | None:
        """Return one downloaded title without building the full library view.

        Opening the watch page is latency-sensitive. It only needs to know
        whether this title has local episodes, so avoid the recursive storage
        accounting and disk-usage lookup used by the downloads screen.
        """

        cached = self._library_cache
        if cached:
            item = next(
                (entry for entry in cached[1].get("anime", []) if entry.get("animeId") == anime_id),
                None,
            )
            # Index writes invalidate the cache, so a cached miss is also an
            # authoritative answer for the current process.
            return copy.deepcopy(item) if item else None

        directory = await self._directory()
        index = await self._read_index(directory)
        matching = [
            entry for entry in index.get("episodes", [])
            if entry.get("animeId") == anime_id
        ]
        sizes_changed = False
        for entry in matching:
            stored_size = entry.get("sizeBytes")
            if isinstance(stored_size, (int, float)) and stored_size >= 0:
                continue
            entry["sizeBytes"] = await asyncio.to_thread(self._entry_storage_size, directory, entry)
            sizes_changed = True
        if sizes_changed:
            await self._save_index(directory, index)
        grouped = self._group_public_anime(matching)
        return grouped[0] if grouped else None

    async def _library_snapshot(self) -> dict[str, Any]:
        """Build the filesystem-backed part of the offline library once.

        Player and downloads screens poll job state frequently. File existence,
        recursive HLS sizes and disk usage do not need to be recomputed for
        every poll; index commits invalidate this snapshot immediately.
        """

        directory = await self._directory()
        index = await self._read_index(directory)
        episodes = [item for item in index.get("episodes", []) if self._existing_episode(directory, item)]
        if len(episodes) != len(index.get("episodes", [])):
            index["episodes"] = episodes
            await self._save_index(directory, index)
        sizes_changed = False
        for entry in episodes:
            # Downloads persist their measured size at commit time. Trust that
            # value during ordinary reads instead of recursively scanning all
            # HLS assets every time the library screen/player opens. Legacy
            # rows without a size are measured once and written back below.
            stored_size = entry.get("sizeBytes")
            if isinstance(stored_size, (int, float)) and stored_size >= 0:
                continue
            measured = await asyncio.to_thread(self._entry_storage_size, directory, entry)
            entry["sizeBytes"] = measured
            sizes_changed = True
        if sizes_changed:
            index["episodes"] = episodes
            await self._save_index(directory, index)
        public_anime = self._group_public_anime(episodes)
        storage_path = self._storage_volume_path(directory, episodes)
        storage = await asyncio.to_thread(shutil.disk_usage, storage_path)
        return {
            "directory": str(directory),
            "storage": {
                "totalBytes": storage.total,
                "usedBytes": storage.used,
                "freeBytes": storage.free,
                "libraryBytes": sum(int(entry.get("sizeBytes") or 0) for entry in episodes),
            },
            "anime": public_anime,
        }

    async def verify_kodik_credentials(
        self,
        kodik_public_key: str | None = None,
        kodik_private_key: str | None = None,
    ) -> dict[str, Any]:
        """Verify submitted values and any stored partner needed by a pair."""

        submitted_public = str(kodik_public_key or "").strip()
        submitted_private = str(kodik_private_key or "").strip()
        settings_payload = await self._settings_payload()
        stored_public = str(settings_payload.get("kodikPublicKey") or "").strip()
        active_public = submitted_public or stored_public
        active_private = submitted_private
        checks: list[dict[str, str]] = []

        if submitted_public and not submitted_private and self.private_key_file.is_file():
            try:
                protected = await asyncio.to_thread(self.private_key_file.read_text, encoding="utf-8")
                active_private = (await asyncio.to_thread(_dpapi_unprotect, protected.strip())).strip()
            except (OSError, OfflineLibraryError) as error:
                checks.append({
                    "field": "kodikPrivateKey",
                    "label": "Kodik Private key",
                    "status": "pending",
                    "detail": f"Сохранённый Private key не удалось прочитать: {error}",
                })

        if not active_public:
            if submitted_private:
                checks.append({
                    "field": "kodikPrivateKey",
                    "label": "Kodik Private key",
                    "status": "pending",
                    "detail": "Сначала укажите Public key: Private key проверяется только как часть пары.",
                })
            return {"canSave": False, "checks": checks}

        public_payload: dict[str, Any] | None = None
        try:
            public_payload = await self.resolver.verify_public_key(active_public)
            checks.append({
                "field": "kodikPublicKey",
                "label": "Kodik Public key",
                "status": "valid",
                "detail": (
                    "Kodik API принял ключ и вернул каталог."
                    if submitted_public
                    else "Ранее сохранённый Public key работает и используется для проверки пары."
                ),
            })
        except CredentialVerificationUnavailable as error:
            checks.append({
                "field": "kodikPublicKey", "label": "Kodik Public key",
                "status": "pending", "detail": str(error),
            })
        except OfflineLibraryError as error:
            checks.append({
                "field": "kodikPublicKey", "label": "Kodik Public key",
                "status": "invalid", "detail": str(error),
            })

        if active_private and public_payload is not None:
            try:
                await self.resolver.verify_private_key(active_public, active_private, public_payload)
                checks.append({
                    "field": "kodikPrivateKey",
                    "label": "Kodik Private key",
                    "status": "valid",
                    "detail": (
                        "Подпись принята, приватный API вернул прямую видеоссылку."
                        if submitted_private
                        else "Ранее сохранённый Private key образует рабочую пару с новым Public key."
                    ),
                })
            except CredentialVerificationUnavailable as error:
                checks.append({
                    "field": "kodikPrivateKey", "label": "Kodik Private key",
                    "status": "pending", "detail": str(error),
                })
            except OfflineLibraryError as error:
                checks.append({
                    "field": "kodikPrivateKey", "label": "Kodik Private key",
                    "status": "invalid", "detail": str(error),
                })
        elif submitted_private and public_payload is None:
            checks.append({
                "field": "kodikPrivateKey",
                "label": "Kodik Private key",
                "status": "pending",
                "detail": "Private key не проверен, потому что Public key не был подтверждён.",
            })

        return {
            "canSave": bool(checks) and all(check["status"] == "valid" for check in checks),
            "checks": checks,
        }

    def _group_public_anime(self, episodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
            item["sizeBytes"] = sum(int(entry.get("sizeBytes") or 0) for entry in item["episodes"])
        return sorted(anime.values(), key=lambda item: item["title"].casefold())

    def jobs(self) -> list[dict[str, Any]]:
        jobs = sorted(
            (copy.deepcopy(job) for job in self._jobs.values()),
            key=lambda item: item["createdAt"],
            reverse=True,
        )
        queued = sorted(
            (job for job in jobs if job.get("status") == "queued"),
            key=lambda item: item["createdAt"],
        )
        positions = {str(job["id"]): index for index, job in enumerate(queued, start=1)}
        for job in jobs:
            job["queuePosition"] = positions.get(str(job["id"]))
            job.pop("episodeKeys", None)
        return jobs

    async def download_availability(self, request: dict[str, Any]) -> dict[str, Any]:
        """Check every selected episode without silently lowering quality.

        A queue used to accept e.g. 1080p and later choose the nearest lower
        rendition.  The picker needs an exact, per-episode answer instead, so
        this preflight returns all problems in one response before downloading.
        """

        public_key, private_key = await self._kodik_private_credentials()
        episodes = request.get("episodes")
        if not isinstance(episodes, list) or not episodes:
            raise OfflineLibraryError("Не выбраны серии для проверки.")
        quality = max(144, min(int(request.get("quality") or 720), 2160))
        request_slots = asyncio.Semaphore(4)

        async def inspect(episode: object) -> dict[str, Any] | None:
            if not isinstance(episode, dict):
                return {
                    "season": 1,
                    "episode": "?",
                    "dubbing": "",
                    "kind": "source",
                    "availableQualities": [],
                    "message": "Серия описана неверно.",
                }
            season = int(episode.get("season") or 1)
            number = str(episode.get("episode") or "?")
            dubbing = str(episode.get("dubbing") or "Неизвестная озвучка")
            group_label = str(episode.get("seasonLabel") or f"Сезон {season}").strip()
            label = f"{group_label}, серия {number}"
            if not _is_kodik_url(str(episode.get("iframeUrl") or "")):
                return {
                    "season": season,
                    "episode": number,
                    "dubbing": dubbing,
                    "kind": "dubbing",
                    "availableQualities": [],
                    "message": f"{label}: озвучка «{dubbing}» недоступна в Kodik.",
                }
            try:
                async with request_slots:
                    result = await self.resolver.resolve_playback_api(
                        str(episode.get("iframeUrl") or ""),
                        public_key,
                        private_key,
                        source_id=episode.get("sourceId"),
                        source_id_type=episode.get("sourceIdType"),
                        season=season,
                        episode=episode.get("originEpisode") or number,
                        translation_id=episode.get("translationId"),
                        dubbing=dubbing,
                        source_title=episode.get("sourceTitle") or request.get("title"),
                        source_original_title=episode.get("sourceOriginalTitle"),
                    )
            except OfflineLibraryError as error:
                return {
                    "season": season,
                    "episode": number,
                    "dubbing": dubbing,
                    "kind": "dubbing",
                    "availableQualities": [],
                    "message": f"{label}: озвучка «{dubbing}» недоступна — {error}",
                }
            available = sorted({
                int(source.get("quality") or 0)
                for source in result.get("sources", [])
                if isinstance(source, dict) and int(source.get("quality") or 0) > 0
            })
            if quality in available:
                return None
            alternatives = ", ".join(f"{value}p" for value in available) or "других качеств нет"
            return {
                "season": season,
                "episode": number,
                "dubbing": dubbing,
                "kind": "quality",
                "requestedQuality": quality,
                "availableQualities": available,
                "message": f"{label}: нет {quality}p в озвучке «{dubbing}» (есть: {alternatives}).",
            }

        issues = [
            issue
            for issue in await asyncio.gather(*(inspect(episode) for episode in episodes))
            if issue is not None
        ]
        return {"available": not issues, "issues": issues}

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
        anime_id = int(request.get("animeId") or 0)
        quality = int(request.get("quality") or 720)
        index = await self._read_index(directory)
        occupied = {
            _download_episode_key(int(entry.get("animeId") or 0), entry, int(entry.get("quality") or 0))
            for entry in index.get("episodes", [])
            if isinstance(entry, dict) and self._existing_episode(directory, entry)
        }
        for active_job in self._jobs.values():
            if active_job.get("status") in {"queued", "downloading", "paused"}:
                occupied.update(str(key) for key in active_job.get("episodeKeys", []))
        unique_episodes: list[dict[str, Any]] = []
        episode_keys: list[str] = []
        for episode in episodes:
            key = _download_episode_key(anime_id, episode, quality)
            if key in occupied:
                continue
            occupied.add(key)
            episode_keys.append(key)
            unique_episodes.append(episode)
        if not unique_episodes:
            raise OfflineLibraryError("Все выбранные серии уже скачаны или добавлены в очередь в этом качестве.")
        request = {**request, "episodes": unique_episodes}
        job_id = uuid.uuid4().hex
        job = {
            "id": job_id,
            "animeId": anime_id,
            "status": "queued",
            "title": str(request.get("title") or "Аниме"),
            "quality": quality,
            "total": len(unique_episodes),
            "completed": 0,
            "progress": 0,
            "current": "",
            "error": "",
            "pauseReason": "",
            "createdAt": int(time.time() * 1000),
            "items": [
                {
                    "season": int(episode.get("season") or 1),
                    "episode": str(episode.get("episode") or ""),
                    "dubbing": str(episode.get("dubbing") or ""),
                    **(
                        {"seasonLabel": str(episode["seasonLabel"])}
                        if episode.get("seasonLabel")
                        else {}
                    ),
                }
                for episode in unique_episodes
            ],
            "episodeKeys": episode_keys,
        }
        self._jobs[job_id] = job
        async with self._queue_lock:
            await self._queue.put({"jobId": job_id, "directory": directory, "request": request})
            if self._worker is None or self._worker.done():
                self._worker = asyncio.create_task(self._work_queue())
        return next(item for item in self.jobs() if item["id"] == job_id)

    async def cancel(self, job_id: str) -> None:
        if job_id not in self._jobs:
            raise KeyError(job_id)
        self._cancelled.add(job_id)
        job = self._jobs[job_id]
        if job["status"] == "queued":
            job["status"] = "cancelled"
        active = self._active_downloads.get(job_id)
        process = self._active_processes.get(job_id)
        if process is not None and process.returncode is None:
            process.terminate()
            waiter = asyncio.create_task(process.wait())
            waiter.add_done_callback(lambda _task: self._active_processes.pop(job_id, None))
        if active is not None and not active.done():
            active.cancel()

    async def delete_episode(self, episode_id: str) -> None:
        await self.delete_episodes([episode_id])

    async def delete_episodes(self, episode_ids: list[str]) -> int:
        directory = await self._directory()
        index = await self._read_index(directory)
        selected_ids = {str(value) for value in episode_ids if str(value).strip()}
        selected = [item for item in index["episodes"] if str(item.get("id")) in selected_ids]
        if not selected:
            raise KeyError(next(iter(selected_ids), ""))
        for episode in selected:
            await self._remove_entry_files(directory, episode)
        index["episodes"] = [item for item in index["episodes"] if str(item.get("id")) not in selected_ids]
        await self._remove_orphaned_posters(directory, selected, index["episodes"])
        await self._save_index(directory, index)
        return len(selected)

    async def scan_existing(self) -> dict[str, int]:
        """Restore Android MediaStore videos into a fresh private index."""

        if not _is_android_runtime():
            raise OfflineLibraryError("Сканирование общей папки доступно только в Android-приложении.")
        try:
            from java import jclass  # type: ignore[import-not-found]

            native = jclass("com.animesoul.mobile.NativeDownloadSupport")
            raw = await asyncio.to_thread(native.scanPublishedVideos)
            discovered = json.loads(str(raw or "[]"))
        except Exception as error:
            message = str(error).casefold()
            if "permission" in message or "securityexception" in message:
                raise OfflineLibraryError(
                    "Разрешите AnimeSoul доступ к видео и повторите сканирование."
                ) from error
            raise OfflineLibraryError("Не удалось просканировать Movies/AnimeSoul.") from error
        if not isinstance(discovered, list):
            raise OfflineLibraryError("Android вернул некорректный список видео.")

        directory = await self._directory()
        index = await self._read_index(directory)
        existing = {str(item.get("id")) for item in index.get("episodes", [])}
        recovered: list[dict[str, Any]] = []
        ignored = 0
        for item in discovered:
            record = _android_video_record(item) if isinstance(item, dict) else None
            if record is None:
                ignored += 1
                continue
            try:
                path = self._validated_android_external_path(str(record["externalPath"]))
            except OfflineLibraryError:
                ignored += 1
                continue
            if not path.is_file():
                ignored += 1
                continue
            if str(record["id"]) not in existing:
                recovered.append(record)
                existing.add(str(record["id"]))
        if recovered:
            index["episodes"] = [*index.get("episodes", []), *recovered]
            await self._save_index(directory, index)
        return {
            "scanned": len(discovered),
            "imported": len(recovered),
            "existing": len(discovered) - len(recovered) - ignored,
            "ignored": ignored,
        }

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
        cache_key = (episode_id, kind)
        cached = self._media_path_cache.get(cache_key)
        if cached is not None and cached.is_file():
            return cached
        self._media_path_cache.pop(cache_key, None)
        directory = await self._directory()
        index = await self._read_index(directory)
        entry = next((item for item in index["episodes"] if item.get("id") == episode_id), None)
        if entry is None:
            raise KeyError(episode_id)
        if kind == "media" and isinstance(entry.get("externalPath"), str):
            path = self._validated_android_external_path(str(entry["externalPath"]))
            if not path.is_file():
                raise KeyError(episode_id)
            self._media_path_cache[cache_key] = path
            return path
        relative = entry.get("file") if kind == "media" else entry.get("preview")
        if not isinstance(relative, str):
            raise KeyError(episode_id)
        path = self._path_within(directory, relative)
        if not path.is_file():
            raise KeyError(episode_id)
        self._media_path_cache[cache_key] = path
        return path

    async def asset_path(self, episode_id: str, asset_name: str) -> Path:
        """Resolve one file belonging to an Android offline HLS package."""

        if not re.fullmatch(r"asset-\d{5}\.[A-Za-z0-9]{1,8}", asset_name):
            raise KeyError(episode_id)
        cached_directory = self._asset_directory_cache.get(episode_id)
        if cached_directory is not None:
            cached_path = cached_directory / asset_name
            if cached_path.is_file():
                return cached_path
            self._asset_directory_cache.pop(episode_id, None)
        directory = await self._directory()
        index = await self._read_index(directory)
        entry = next((item for item in index["episodes"] if item.get("id") == episode_id), None)
        if entry is None:
            raise KeyError(episode_id)
        asset_directory = self._path_within(
            directory,
            str(Path(str(entry["file"])).parent / f".{episode_id}.assets"),
        )
        path = asset_directory / asset_name
        if not path.is_file():
            raise KeyError(episode_id)
        self._asset_directory_cache[episode_id] = asset_directory
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
                active = asyncio.create_task(self._download_job(item))
                self._active_downloads[job_id] = active
                await active
                if job_id in self._cancelled:
                    job["status"] = "cancelled"
                else:
                    job["status"] = "completed"
                    job["progress"] = 1
            except (DownloadCancelled, asyncio.CancelledError):
                job["status"] = "cancelled"
            except Exception as error:  # Keep the queue usable after one broken episode.
                job["status"] = "error"
                job["error"] = str(error) or "Не удалось скачать выбранные серии."
            finally:
                self._active_downloads.pop(job_id, None)
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
        await self._wait_for_network(job, job_id)
        await self._ensure_index(directory)
        await self._download_artwork(directory, request, "poster")
        episodes = request["episodes"]
        for position, episode in enumerate(episodes, start=1):
            await self._wait_for_network(job, job_id)
            if job_id in self._cancelled:
                raise DownloadCancelled
            if not isinstance(episode, dict):
                raise OfflineLibraryError("Очередь содержит неверно описанную серию.")
            group_label = str(episode.get("seasonLabel") or f"Сезон {episode.get('season', 1)}").strip()
            label = f"{group_label} · серия {episode.get('episode', position)}"
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
        resolved = await self.resolver.resolve_private_api(
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
        # Tests and third-party resolvers written for older AnimeSoul builds
        # may still return the original two-item tuple.
        source, actual_quality = resolved[:2]
        skips = _sanitize_skip_segments(
            resolved[2] if len(resolved) > 2 and isinstance(resolved[2], dict) else {},
            episode.get("duration"),
        )
        anime_id = int(request["animeId"])
        season = int(episode.get("season") or 1)
        number = str(episode.get("episode") or "0")
        dubbing = str(episode.get("dubbing") or "Неизвестно")
        if actual_quality != quality:
            group_label = str(episode.get("seasonLabel") or f"Сезон {season}").strip()
            raise OfflineLibraryError(
                f"{group_label}, серия {number}: качество {quality}p недоступно "
                f"для озвучки «{dubbing}» (Kodik вернул {actual_quality}p)."
            )
        episode_id = hashlib.sha256(f"{anime_id}|{season}|{number}|{dubbing}|{actual_quality}".encode()).hexdigest()[:24]
        index = await self._read_index(directory)
        if any(item.get("id") == episode_id and self._existing_episode(directory, item) for item in index["episodes"]):
            return
        anime_folder = _anime_folder_name(request)
        season_folder = f"Сезон {season:02d}"
        base_name = _safe_name(f"{anime_folder} — {number} — {dubbing} — {actual_quality}p", episode_id)
        extension = ".mp4"
        relative = str(Path(anime_folder) / season_folder / f"{base_name}{extension}")
        target = self._path_within(directory, relative)
        await asyncio.to_thread(target.parent.mkdir, parents=True, exist_ok=True)
        partial = target.with_suffix(f".part{extension}")
        asset_directory = target.parent / f".{episode_id}.assets"
        preview_candidate = target.parent / f"{episode_id}.jpg"
        preview_existed = preview_candidate.is_file()
        preview: str | None = None
        external_uri: str | None = None
        external_path: str | None = None
        committed = False
        try:
            await self._stream_to_file(
                source,
                partial,
                job,
                done_before,
                int(job["total"]),
                job_id,
                float(episode.get("duration") or 0),
                episode_id,
            )
            await asyncio.to_thread(partial.replace, target)
            preview = await self._download_episode_preview(
                directory,
                request,
                episode,
                anime_folder,
                season_folder,
                episode_id,
            )
            poster = await self._poster_relative(directory, request, anime_folder)
            if _is_android_runtime():
                published = await asyncio.to_thread(
                    self._publish_android_video,
                    target,
                    anime_folder,
                    season_folder,
                    target.name,
                )
                external_uri = str(published.get("uri") or "") or None
                external_path = str(published.get("path") or "") or None
                if not external_uri or not external_path:
                    raise OfflineLibraryError("Android не вернул путь к сохранённому MP4.")
                await asyncio.to_thread(target.unlink)
            record = {
                "id": episode_id,
                "animeId": anime_id,
                "title": str(request.get("title") or "Аниме"),
                "year": request.get("year"),
                "season": season,
                "seasonLabel": str(episode.get("seasonLabel") or "").strip() or f"Сезон {season}",
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
                "mediaType": "video/mp4",
                "skips": skips,
                "downloadedAt": int(time.time() * 1000),
            }
            if external_uri and external_path:
                record["contentUri"] = external_uri
                record["externalPath"] = external_path
            record["sizeBytes"] = await asyncio.to_thread(self._entry_storage_size, directory, record)
            index["episodes"] = [item for item in index["episodes"] if item.get("id") != episode_id] + [record]

            # Once the media file has its final name, cancellation must not
            # interrupt the atomic index commit halfway through. Await the
            # shielded task before propagating cancellation so the file and
            # catalogue can never disagree.
            index_commit = asyncio.create_task(self._save_index(directory, index))
            try:
                await asyncio.shield(index_commit)
            except asyncio.CancelledError:
                await index_commit
                committed = True
                raise
            committed = True
        except (Exception, asyncio.CancelledError):
            if partial.exists():
                await asyncio.to_thread(partial.unlink)
            if not committed:
                if target.exists():
                    await asyncio.to_thread(target.unlink)
                if external_uri:
                    await asyncio.to_thread(self._delete_android_content, external_uri)
                if not preview_existed and preview_candidate.exists():
                    await asyncio.to_thread(preview_candidate.unlink)
                if asset_directory.exists():
                    await asyncio.to_thread(shutil.rmtree, asset_directory, True)
            raise

    async def _stream_to_file(
        self,
        source: str,
        target: Path,
        job: dict[str, Any],
        done_before: int,
        total: int,
        job_id: str,
        duration: float = 0,
        episode_id: str = "",
    ) -> None:
        if _is_hls_source(source):
            await self._stream_hls_to_file(
                source,
                target,
                job,
                done_before,
                total,
                job_id,
                duration,
                episode_id,
            )
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
                        await self._wait_for_network(job, job_id)
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
        episode_id: str = "",
    ) -> None:
        """Remux a Kodik HLS playlist into a seekable MP4 using bundled ffmpeg."""

        if _is_android_runtime():
            await self._remux_android_hls_to_mp4(
                source, target, job, done_before, total, job_id, duration,
            )
            return

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
        self._active_processes[job_id] = process
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
                self._active_processes.pop(job_id, None)
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
        self._active_processes.pop(job_id, None)
        error_text = (await process.stderr.read()).decode("utf-8", "replace").strip()
        if return_code != 0:
            details = error_text.splitlines()[-1] if error_text else "ffmpeg завершился с ошибкой."
            raise OfflineLibraryError(f"Не удалось собрать видеопоток Kodik: {details[:280]}")

    async def _remux_android_hls_to_mp4(
        self,
        source: str,
        target: Path,
        job: dict[str, Any],
        done_before: int,
        total: int,
        job_id: str,
        duration: float,
    ) -> None:
        """Build one seekable MP4 with the native FFmpegKit runtime.

        A transition to disallowed mobile data cancels the current network
        session, retains already completed episodes, and restarts this episode
        only after an allowed network is available again.
        """

        try:
            from java import jclass  # type: ignore[import-not-found]

            native = jclass("com.animesoul.mobile.NativeDownloadSupport")
        except Exception as error:
            raise OfflineLibraryError("В APK отсутствует модуль сборки MP4.") from error

        while True:
            await self._wait_for_network(job, job_id)
            if target.exists():
                await asyncio.to_thread(target.unlink)
            started = await asyncio.to_thread(native.startRemux, job_id, source, str(target))
            if not bool(started):
                raise OfflineLibraryError("Не удалось запустить сборку локального MP4.")
            restart_after_pause = False
            try:
                while True:
                    if job_id in self._cancelled:
                        await asyncio.to_thread(native.cancelRemux, job_id)
                        raise DownloadCancelled
                    if await self._mobile_downloads_blocked():
                        await asyncio.to_thread(native.cancelRemux, job_id)
                        restart_after_pause = True
                        await self._wait_for_network(job, job_id)
                        break
                    raw_state = await asyncio.to_thread(native.remuxState, job_id)
                    state = json.loads(str(raw_state or "{}"))
                    elapsed = max(0.0, float(state.get("timeMs") or 0) / 1000.0)
                    if duration > 0 and elapsed > 0:
                        episode_progress = min(.99, elapsed / duration)
                        job["progress"] = max(job["progress"], (done_before + episode_progress) / total)
                    if bool(state.get("done")):
                        if bool(state.get("success")) and target.is_file() and target.stat().st_size > 0:
                            return
                        details = str(state.get("error") or "FFmpeg не создал видеофайл.")
                        raise OfflineLibraryError(f"Не удалось собрать MP4: {details[:280]}")
                    await asyncio.sleep(.25)
            except asyncio.CancelledError:
                await asyncio.to_thread(native.cancelRemux, job_id)
                raise
            finally:
                if restart_after_pause and target.exists():
                    await asyncio.to_thread(target.unlink)

    async def _mobile_downloads_blocked(self) -> bool:
        if self._network_type != "mobile":
            return False
        payload = await self._settings_payload()
        return not bool(payload.get("allowMobileDownloads", False))

    async def _wait_for_network(self, job: dict[str, Any], job_id: str) -> None:
        paused = False
        while await self._mobile_downloads_blocked():
            if job_id in self._cancelled:
                raise DownloadCancelled
            paused = True
            job["status"] = "paused"
            job["pauseReason"] = "mobile-network"
            job["error"] = ""
            self._network_changed.clear()
            if not await self._mobile_downloads_blocked():
                break
            try:
                await asyncio.wait_for(self._network_changed.wait(), timeout=.75)
            except TimeoutError:
                pass
        if paused and job_id not in self._cancelled:
            job["status"] = "downloading"
            job["pauseReason"] = ""

    @staticmethod
    def _publish_android_video(
        source: Path,
        anime_folder: str,
        season_folder: str,
        display_name: str,
    ) -> dict[str, str]:
        try:
            from java import jclass  # type: ignore[import-not-found]

            native = jclass("com.animesoul.mobile.NativeDownloadSupport")
            payload = json.loads(str(native.publishVideo(
                str(source), anime_folder, season_folder, display_name,
            )))
        except Exception as error:
            raise OfflineLibraryError("Не удалось сохранить MP4 в папку Movies/AnimeSoul.") from error
        if not isinstance(payload, dict):
            raise OfflineLibraryError("Android вернул некорректный путь сохранённого MP4.")
        return {str(key): str(value) for key, value in payload.items() if value is not None}

    @staticmethod
    def _delete_android_content(content_uri: str) -> bool | None:
        try:
            from java import jclass  # type: ignore[import-not-found]

            return bool(jclass("com.animesoul.mobile.NativeDownloadSupport").deleteVideo(content_uri))
        except Exception:
            return None

    async def _download_android_hls_package(
        self,
        source: str,
        target: Path,
        job: dict[str, Any],
        done_before: int,
        total: int,
        job_id: str,
        episode_id: str,
    ) -> None:
        """Mirror an HLS media playlist for hls.js without a desktop ffmpeg binary."""

        headers = {"User-Agent": USER_AGENT, "Referer": "https://kodik.info/"}
        timeout = httpx.Timeout(35.0, read=120.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
            playlist_url = source
            response = await client.get(playlist_url)
            response.raise_for_status()
            playlist = response.text

            # Private API links occasionally point to a small master manifest.
            # Select its highest advertised variant; the API has already
            # limited the maximum quality requested by the user.
            variants: list[tuple[int, str]] = []
            lines = playlist.splitlines()
            for index, line in enumerate(lines[:-1]):
                if not line.startswith("#EXT-X-STREAM-INF:"):
                    continue
                bandwidth_match = re.search(r"(?:AVERAGE-)?BANDWIDTH=(\d+)", line)
                bandwidth = int(bandwidth_match.group(1)) if bandwidth_match else 0
                next_line = lines[index + 1].strip()
                if next_line and not next_line.startswith("#"):
                    variants.append((bandwidth, urljoin(playlist_url, next_line)))
            if variants:
                playlist_url = max(variants)[1]
                response = await client.get(playlist_url)
                response.raise_for_status()
                playlist = response.text

            resolved_assets: list[str] = []
            for line in playlist.splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    resolved_assets.append(urljoin(playlist_url, stripped))
                for match in re.finditer(r'URI="([^"]+)"', line):
                    resolved_assets.append(urljoin(playlist_url, match.group(1)))

            unique_assets = list(dict.fromkeys(resolved_assets))
            if not unique_assets:
                raise OfflineLibraryError("HLS-поток не содержит сегментов для офлайн-загрузки.")

            asset_directory = target.parent / f".{episode_id}.assets"
            if asset_directory.exists():
                await asyncio.to_thread(shutil.rmtree, asset_directory, True)
            await asyncio.to_thread(asset_directory.mkdir, parents=True, exist_ok=True)

            asset_names: dict[str, str] = {}
            for index, url in enumerate(unique_assets, start=1):
                suffix = Path(urlparse(url).path).suffix.casefold()
                if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
                    suffix = ".bin"
                asset_names[url] = f"asset-{index:05d}{suffix}"

            completed_assets = 0
            semaphore = asyncio.Semaphore(4)

            async def download_asset(url: str) -> None:
                nonlocal completed_assets
                async with semaphore:
                    if job_id in self._cancelled:
                        raise DownloadCancelled
                    asset_response = await client.get(url)
                    asset_response.raise_for_status()
                    destination = asset_directory / asset_names[url]
                    await asyncio.to_thread(destination.write_bytes, asset_response.content)
                    completed_assets += 1
                    episode_progress = completed_assets / len(unique_assets)
                    job["progress"] = min(.99, (done_before + episode_progress) / total)

            try:
                await asyncio.gather(*(download_asset(url) for url in unique_assets))
            except Exception:
                await asyncio.to_thread(shutil.rmtree, asset_directory, True)
                raise

            def local_asset_url(url: str) -> str:
                return f"/api/downloads/assets/{episode_id}/{asset_names[url]}"

            rewritten: list[str] = []
            for line in playlist.splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    rewritten.append(local_asset_url(urljoin(playlist_url, stripped)))
                    continue

                def replace_uri(match: re.Match[str]) -> str:
                    absolute = urljoin(playlist_url, match.group(1))
                    return f'URI="{local_asset_url(absolute)}"'

                rewritten.append(re.sub(r'URI="([^"]+)"', replace_uri, line))

            await asyncio.to_thread(target.write_text, "\n".join(rewritten) + "\n", encoding="utf-8")

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
        if self._directory_cache is not None:
            return self._directory_cache
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
        self._directory_cache = directory
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
            self._invalidate_playback_path_cache()

    def _invalidate_playback_path_cache(self) -> None:
        self._media_path_cache.clear()
        self._asset_directory_cache.clear()
        self._library_cache = None

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

    @staticmethod
    def _validated_android_external_path(value: str) -> Path:
        path = Path(value).resolve()
        lowered = [part.casefold() for part in path.parts]
        if not _is_android_runtime() or "movies" not in lowered or "animesoul" not in lowered:
            raise OfflineLibraryError("Недопустимый путь внешнего видео AnimeSoul.")
        if lowered.index("animesoul") <= lowered.index("movies"):
            raise OfflineLibraryError("Недопустимый путь внешнего видео AnimeSoul.")
        return path

    def _entry_media_file(self, directory: Path, entry: dict[str, Any]) -> Path | None:
        external = entry.get("externalPath")
        if isinstance(external, str) and external:
            try:
                return self._validated_android_external_path(external)
            except OfflineLibraryError:
                return None
        relative = entry.get("file")
        return self._path_within(directory, relative) if isinstance(relative, str) else None

    def _entry_storage_size(self, directory: Path, entry: dict[str, Any]) -> int:
        total = 0
        media = self._entry_media_file(directory, entry)
        if media is not None and media.is_file():
            total += media.stat().st_size
        preview = entry.get("preview")
        if isinstance(preview, str):
            preview_path = self._path_within(directory, preview)
            if preview_path.is_file():
                total += preview_path.stat().st_size
        episode_id = str(entry.get("id") or "")
        relative_media = entry.get("file")
        if episode_id and isinstance(relative_media, str):
            asset_directory = self._path_within(
                directory,
                str(Path(relative_media).parent / f".{episode_id}.assets"),
            )
            if asset_directory.is_dir():
                total += sum(path.stat().st_size for path in asset_directory.rglob("*") if path.is_file())
        return total

    def _storage_volume_path(self, directory: Path, episodes: list[dict[str, Any]]) -> Path:
        for entry in episodes:
            external = entry.get("externalPath")
            if isinstance(external, str):
                try:
                    path = self._validated_android_external_path(external)
                except OfflineLibraryError:
                    continue
                if path.parent.exists():
                    return path.parent
        return directory

    def _existing_episode(self, directory: Path, entry: dict[str, Any]) -> bool:
        path = self._entry_media_file(directory, entry)
        return path is not None and path.is_file()

    async def _remove_entry_files(self, directory: Path, entry: dict[str, Any]) -> None:
        content_uri = entry.get("contentUri")
        if isinstance(content_uri, str) and content_uri:
            deleted = await asyncio.to_thread(self._delete_android_content, content_uri)
            external = entry.get("externalPath")
            if deleted is False and isinstance(external, str) and Path(external).is_file():
                raise OfflineLibraryError(
                    "Подтвердите удаление файла в системном окне Android, затем обновите библиотеку."
                )
        for key in ("file", "preview"):
            relative = entry.get(key)
            if not isinstance(relative, str):
                continue
            path = self._path_within(directory, relative)
            if path.is_file():
                await asyncio.to_thread(path.unlink)
                await self._remove_empty_parents(directory, path.parent)
        episode_id = str(entry.get("id") or "")
        relative_media = entry.get("file")
        if episode_id and isinstance(relative_media, str):
            asset_directory = self._path_within(
                directory,
                str(Path(relative_media).parent / f".{episode_id}.assets"),
            )
            if asset_directory.is_dir():
                await asyncio.to_thread(shutil.rmtree, asset_directory, True)
                await self._remove_empty_parents(directory, asset_directory.parent)

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
            "id", "animeId", "season", "seasonLabel", "episode", "originAnimeId", "originEpisode",
            "dubbing", "translationId", "quality", "duration", "mediaType", "downloadedAt",
            "sizeBytes", "skips",
        )}
        result["skips"] = _sanitize_skip_segments(entry.get("skips"), entry.get("duration"))
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
