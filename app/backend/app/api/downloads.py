"""FastAPI transport for AnimeSoul's local offline library."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..services.offline_library import OfflineLibraryError, OfflineLibraryService
from .yummy import gateway as yummy_gateway


router = APIRouter(tags=["Downloads"])
offline_library = OfflineLibraryService(settings.data_dir)


class OfflineSettingsPayload(BaseModel):
    directory: str = Field(min_length=1, max_length=2048)
    kodikApiToken: str | None = Field(default=None, max_length=512)
    clearKodikApiToken: bool = False


class DownloadEpisodePayload(BaseModel):
    videoId: int | str
    season: int = Field(ge=1, le=99)
    episode: str = Field(min_length=1, max_length=40)
    originAnimeId: int | None = None
    originEpisode: str | None = None
    dubbing: str = Field(min_length=1, max_length=160)
    translationId: int | str | None = None
    iframeUrl: str = Field(min_length=8, max_length=4096)
    sourceId: str | None = Field(default=None, max_length=80)
    sourceIdType: str | None = Field(default=None, max_length=40)
    duration: int | float | None = None
    previewUrl: str | None = Field(default=None, max_length=4096)


class DownloadJobPayload(BaseModel):
    animeId: int
    title: str = Field(min_length=1, max_length=300)
    year: int | None = None
    posterUrl: str | None = Field(default=None, max_length=4096)
    quality: int = Field(default=720, ge=144, le=2160)
    episodes: list[DownloadEpisodePayload] = Field(min_length=1, max_length=1000)


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, KeyError):
        return HTTPException(status_code=404, detail="Запрошенный файл не найден в офлайн-библиотеке.")
    return HTTPException(status_code=422, detail=str(error) or "Не удалось обработать офлайн-библиотеку.")


def _catalog_source_reference(detail: object) -> tuple[str, str] | None:
    if not isinstance(detail, dict):
        return None
    remote_ids = detail.get("remote_ids")
    if not isinstance(remote_ids, dict):
        return None
    for field, kind in (
        ("shikimori_id", "shikimori"),
        ("kp_id", "kinopoisk"),
        ("imdb_id", "imdb"),
        ("worldart_id", "worldart_animation" if remote_ids.get("worldart_type") == "animation" else "worldart_cinema"),
    ):
        value = remote_ids.get(field)
        if isinstance(value, (str, int)) and str(value).strip() and str(value).strip() != "0":
            return str(value).strip(), kind
    return None


async def _enrich_catalog_source_ids(request: dict[str, Any]) -> dict[str, Any]:
    """Attach an external catalog id for modern Kodik `/season` embeds.

    The normal player flow already has the detail response in the browser.  A
    second lookup here is intentionally a best-effort fallback so queuing a
    download immediately after opening an anime still has the same data.
    """

    episodes = request.get("episodes")
    if not isinstance(episodes, list):
        return request
    missing_ids = {
        int(item.get("originAnimeId") or request.get("animeId") or 0)
        for item in episodes
        if isinstance(item, dict) and not item.get("sourceId")
    }
    missing_ids.discard(0)
    if not missing_ids:
        return request
    anime_ids = sorted(missing_ids)
    results = await asyncio.gather(
        *(yummy_gateway.request(f"/anime/{anime_id}") for anime_id in anime_ids),
        return_exceptions=True,
    )
    references = {
        anime_id: reference
        for anime_id, detail in zip(anime_ids, results)
        if not isinstance(detail, Exception)
        if (reference := _catalog_source_reference(detail)) is not None
    }
    if not references:
        return request
    for item in episodes:
        if not isinstance(item, dict) or item.get("sourceId"):
            continue
        anime_id = int(item.get("originAnimeId") or request.get("animeId") or 0)
        reference = references.get(anime_id)
        if reference:
            item["sourceId"], item["sourceIdType"] = reference
    return request


@router.get("/api/downloads/settings")
async def get_offline_settings() -> dict[str, str | bool]:
    return await offline_library.settings()


@router.put("/api/downloads/settings")
async def set_offline_settings(payload: OfflineSettingsPayload) -> dict[str, str | bool]:
    try:
        return await offline_library.update_settings(
            payload.directory,
            payload.kodikApiToken,
            payload.clearKodikApiToken,
        )
    except OfflineLibraryError as error:
        raise _http_error(error) from error


@router.get("/api/downloads/library")
async def get_offline_library() -> dict[str, Any]:
    return await offline_library.library()


@router.get("/api/downloads/jobs")
async def get_download_jobs() -> dict[str, list[dict[str, Any]]]:
    return {"jobs": offline_library.jobs()}


@router.post("/api/downloads/jobs")
async def create_download_job(payload: DownloadJobPayload) -> dict[str, Any]:
    try:
        request = await _enrich_catalog_source_ids(payload.model_dump())
        return await offline_library.enqueue(request)
    except OfflineLibraryError as error:
        raise _http_error(error) from error


@router.delete("/api/downloads/jobs/{job_id}")
async def cancel_download_job(job_id: str) -> dict[str, bool]:
    try:
        await offline_library.cancel(job_id)
    except KeyError as error:
        raise _http_error(error) from error
    return {"cancelled": True}


@router.delete("/api/downloads/episodes/{episode_id}")
async def delete_downloaded_episode(episode_id: str) -> dict[str, bool]:
    try:
        await offline_library.delete_episode(episode_id)
    except (KeyError, OfflineLibraryError) as error:
        raise _http_error(error) from error
    return {"deleted": True}


@router.delete("/api/downloads/anime/{anime_id}")
async def delete_downloaded_anime(anime_id: int) -> dict[str, int]:
    try:
        count = await offline_library.delete_anime(anime_id)
    except (KeyError, OfflineLibraryError) as error:
        raise _http_error(error) from error
    return {"deleted": count}


@router.get("/api/downloads/media/{episode_id}")
async def downloaded_media(episode_id: str) -> FileResponse:
    try:
        path = await offline_library.media_path(episode_id)
    except (KeyError, OfflineLibraryError) as error:
        raise _http_error(error) from error
    return FileResponse(path, media_type="video/mp4", filename=path.name, content_disposition_type="inline")


@router.get("/api/downloads/previews/{episode_id}")
async def downloaded_preview(episode_id: str) -> FileResponse:
    try:
        path = await offline_library.media_path(episode_id, "preview")
    except (KeyError, OfflineLibraryError) as error:
        raise _http_error(error) from error
    return FileResponse(path)


@router.get("/api/downloads/posters/{anime_id}")
async def downloaded_poster(anime_id: int) -> FileResponse:
    try:
        path = await offline_library.poster_path(anime_id)
    except (KeyError, OfflineLibraryError) as error:
        raise _http_error(error) from error
    return FileResponse(path)
