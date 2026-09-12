"""FastAPI transport for AnimeSoul's local offline library."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..services.offline_library import OfflineLibraryError, OfflineLibraryService


router = APIRouter(tags=["Downloads"])
offline_library = OfflineLibraryService(settings.data_dir)
IMMUTABLE_LOCAL_MEDIA_HEADERS = {
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
}


class OfflineSettingsPayload(BaseModel):
    directory: str = Field(min_length=1, max_length=2048)
    kodikPublicKey: str | None = Field(default=None, max_length=512)
    kodikPrivateKey: str | None = Field(default=None, max_length=512)
    clearKodikPublicKey: bool = False
    clearKodikPrivateKey: bool = False
    allowMobileDownloads: bool | None = None


class DownloadNetworkPayload(BaseModel):
    type: str = Field(min_length=1, max_length=24)


class KodikCredentialsPayload(BaseModel):
    kodikPublicKey: str | None = Field(default=None, max_length=512)
    kodikPrivateKey: str | None = Field(default=None, max_length=512)


class DownloadEpisodePayload(BaseModel):
    videoId: int | str
    season: int = Field(ge=1, le=99)
    seasonLabel: str | None = Field(default=None, max_length=300)
    episode: str = Field(min_length=1, max_length=40)
    originAnimeId: int | None = None
    originEpisode: str | None = None
    dubbing: str = Field(min_length=1, max_length=160)
    translationId: int | str | None = None
    iframeUrl: str = Field(min_length=8, max_length=4096)
    sourceId: str | None = Field(default=None, max_length=80)
    sourceIdType: str | None = Field(default=None, max_length=40)
    sourceTitle: str | None = Field(default=None, max_length=300)
    sourceOriginalTitle: str | None = Field(default=None, max_length=300)
    duration: int | float | None = None
    previewUrl: str | None = Field(default=None, max_length=4096)


class DownloadJobPayload(BaseModel):
    animeId: int
    title: str = Field(min_length=1, max_length=300)
    year: int | None = None
    posterUrl: str | None = Field(default=None, max_length=4096)
    quality: int = Field(default=720, ge=144, le=2160)
    # ``min_items``/``max_items`` work in both Pydantic 1 (Android) and 2
    # (desktop), while v1 rejects list constraints spelled as string lengths.
    episodes: list[DownloadEpisodePayload] = Field(min_items=1, max_items=1000)


class DeleteEpisodesPayload(BaseModel):
    episodeIds: list[str] = Field(min_items=1, max_items=1000)


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, KeyError):
        return HTTPException(status_code=404, detail="Запрошенный файл не найден в офлайн-библиотеке.")
    return HTTPException(status_code=422, detail=str(error) or "Не удалось обработать офлайн-библиотеку.")


@router.get("/api/downloads/settings")
async def get_offline_settings() -> dict[str, str | bool]:
    return await offline_library.settings()


@router.put("/api/downloads/settings")
async def set_offline_settings(payload: OfflineSettingsPayload) -> dict[str, str | bool]:
    try:
        return await offline_library.update_settings(
            payload.directory,
            payload.kodikPublicKey,
            payload.kodikPrivateKey,
            payload.clearKodikPublicKey,
            payload.clearKodikPrivateKey,
            payload.allowMobileDownloads,
        )
    except OfflineLibraryError as error:
        raise _http_error(error) from error


@router.get("/api/downloads/library")
async def get_offline_library() -> dict[str, Any]:
    return await offline_library.library()


@router.post("/api/downloads/scan")
async def scan_offline_library() -> dict[str, int]:
    try:
        return await offline_library.scan_existing()
    except OfflineLibraryError as error:
        raise _http_error(error) from error


@router.post("/api/downloads/credentials/validate")
async def validate_kodik_credentials(payload: KodikCredentialsPayload) -> dict[str, Any]:
    return await offline_library.verify_kodik_credentials(
        payload.kodikPublicKey,
        payload.kodikPrivateKey,
    )


@router.get("/api/downloads/anime/{anime_id}")
async def get_downloaded_anime(anime_id: int) -> dict[str, Any]:
    return {"anime": await offline_library.anime(anime_id)}


@router.get("/api/downloads/jobs")
async def get_download_jobs() -> dict[str, list[dict[str, Any]]]:
    return {"jobs": offline_library.jobs()}


@router.post("/api/downloads/availability")
async def check_download_availability(payload: DownloadJobPayload) -> dict[str, Any]:
    """Validate the exact requested rendition before a queue item is created."""

    try:
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        return await offline_library.download_availability(data)
    except OfflineLibraryError as error:
        raise _http_error(error) from error


@router.post("/api/downloads/network")
async def update_download_network(payload: DownloadNetworkPayload) -> dict[str, str]:
    return await offline_library.set_network_type(payload.type)


@router.post("/api/downloads/jobs")
async def create_download_job(payload: DownloadJobPayload) -> dict[str, Any]:
    try:
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        return await offline_library.enqueue(data)
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


@router.post("/api/downloads/episodes/delete")
async def delete_downloaded_episodes(payload: DeleteEpisodesPayload) -> dict[str, int]:
    try:
        count = await offline_library.delete_episodes(payload.episodeIds)
    except (KeyError, OfflineLibraryError) as error:
        raise _http_error(error) from error
    return {"deleted": count}


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
    media_type = "application/vnd.apple.mpegurl" if path.suffix.casefold() == ".m3u8" else "video/mp4"
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name,
        content_disposition_type="inline",
        headers=IMMUTABLE_LOCAL_MEDIA_HEADERS,
    )


@router.get("/api/downloads/assets/{episode_id}/{asset_name}")
async def downloaded_media_asset(episode_id: str, asset_name: str) -> FileResponse:
    try:
        path = await offline_library.asset_path(episode_id, asset_name)
    except (KeyError, OfflineLibraryError) as error:
        raise _http_error(error) from error
    suffix = path.suffix.casefold()
    media_type = "video/mp2t" if suffix in {".ts", ".m2ts"} else "application/octet-stream"
    return FileResponse(path, media_type=media_type, headers=IMMUTABLE_LOCAL_MEDIA_HEADERS)


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
