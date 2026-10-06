"""Health and private playback endpoints for the configured Kodik account."""

from __future__ import annotations

import json
import logging
import os
import time
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from ..config import settings
from ..services.kodik import KodikAnimeGateway, KodikNotConfiguredError
from ..services.offline_library import OfflineLibraryError, OfflineLibraryService
from ..services.kodik_helpers import _is_kodik_url


router = APIRouter(prefix="/api/kodik", tags=["Kodik"])
gateway = KodikAnimeGateway(settings.data_dir)
playback = OfflineLibraryService(settings.data_dir)
logger = logging.getLogger(__name__)


class KodikStreamPayload(BaseModel):
    refresh: bool = False
    videoId: int | str
    season: int = Field(ge=1, le=99)
    episode: str = Field(min_length=1, max_length=40)
    originAnimeId: int | None = None
    originEpisode: str | None = Field(default=None, max_length=40)
    dubbing: str = Field(min_length=1, max_length=160)
    translationId: int | str | None = None
    iframeUrl: str = Field(min_length=8, max_length=4096)
    sourceId: str | None = Field(default=None, max_length=80)
    sourceIdType: str | None = Field(default=None, max_length=40)
    sourceTitle: str | None = Field(default=None, max_length=300)
    sourceOriginalTitle: str | None = Field(default=None, max_length=300)


@router.get("")
async def kodik_proxy(mode: str = "ping") -> dict[str, object]:
    if mode != "ping":
        raise HTTPException(status_code=400, detail="Unsupported Kodik mode")
    started_at = time.perf_counter()
    try:
        await gateway.ping()
    except KodikNotConfiguredError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (httpx.HTTPError, json.JSONDecodeError, RuntimeError) as error:
        raise HTTPException(status_code=502, detail="Kodik API is temporarily unavailable") from error
    return {
        "ok": True,
        "upstreamMs": round((time.perf_counter() - started_at) * 1000),
    }


@router.post("/stream")
@router.post("/download")
async def kodik_stream(payload: KodikStreamPayload, response: Response) -> dict[str, object]:
    if os.getenv("ANIMESOUL_RUNTIME", "local") == "website":
        try:
            source = urlsplit("https:" + payload.iframeUrl if payload.iframeUrl.startswith("//") else payload.iframeUrl)
            source_port = source.port
        except ValueError as error:
            raise HTTPException(422, "Некорректная ссылка Kodik") from error
        if not _is_kodik_url(payload.iframeUrl) or source.scheme != "https" or source.username or source.password or source_port not in {None, 443}:
            raise HTTPException(422, "Для серверного плеера требуется HTTPS-ссылка Kodik")
    started_at = time.perf_counter()
    try:
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        result = await playback.playback_source(data)
        elapsed = round((time.perf_counter() - started_at) * 1000)
        response.headers["Server-Timing"] = f"stream_resolve;dur={elapsed}"
        response.headers["Cache-Control"] = "no-store"
        logger.info("Kodik stream resolution completed in %s ms", elapsed)
        return result
    except OfflineLibraryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


async def close_kodik_services() -> None:
    """Close the standalone credential-check connection pool."""

    await gateway.close()
