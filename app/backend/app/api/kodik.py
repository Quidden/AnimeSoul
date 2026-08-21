"""Health and private playback endpoints for the configured Kodik account."""

from __future__ import annotations

import json
import time

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import settings
from ..services.kodik import KodikAnimeGateway, KodikNotConfiguredError
from ..services.offline_library import OfflineLibraryError, OfflineLibraryService


router = APIRouter(prefix="/api/kodik", tags=["Kodik"])
gateway = KodikAnimeGateway(settings.data_dir)
playback = OfflineLibraryService(settings.data_dir)


class KodikStreamPayload(BaseModel):
    videoId: int | str
    season: int = Field(ge=1, le=99)
    episode: str = Field(min_length=1, max_length=40)
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
async def kodik_stream(payload: KodikStreamPayload) -> dict[str, object]:
    try:
        return await playback.playback_source(payload.model_dump())
    except OfflineLibraryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
