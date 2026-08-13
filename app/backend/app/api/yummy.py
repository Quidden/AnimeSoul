"""React-compatible YummyAnime proxy endpoints."""

from __future__ import annotations

import asyncio
import time

import httpx
from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..services.yummy import YummyAnimeGateway


router = APIRouter(prefix="/api/yummy", tags=["YummyAnime"])
gateway = YummyAnimeGateway(settings.yummy_token)


@router.get("")
async def yummy_proxy(
    mode: str = "catalog",
    id: int | None = None,
    ids: str = "",
    limit: int = Query(24, ge=1, le=48),
    offset: int = Query(0, ge=0),
    q: str = "",
) -> dict:
    """Preserve the response contract used by the existing React UI."""

    try:
        if mode == "ping":
            started_at = time.perf_counter()
            await gateway.request("/anime", {"limit": 1, "offset": 0})
            return {
                "ok": True,
                "upstreamMs": round((time.perf_counter() - started_at) * 1000),
            }
        if mode == "details":
            requested = [item for item in ids.split(",") if item][:50]
            results = await asyncio.gather(
                *(gateway.request(f"/anime/{item}") for item in requested),
                return_exceptions=True,
            )
            return {"anime": [item for item in results if not isinstance(item, Exception)]}
        if mode == "videos":
            if id is None:
                raise HTTPException(status_code=400, detail="Anime ID is required")
            details, videos = await asyncio.gather(
                gateway.request(f"/anime/{id}"),
                gateway.request(f"/anime/{id}/videos"),
            )
            return {"anime": details, "videos": videos or []}
        if mode == "trailers":
            if id is None:
                raise HTTPException(status_code=400, detail="Anime ID is required")
            return {"trailers": await gateway.request(f"/anime/{id}/trailers") or []}
        if mode == "schedule":
            return {"schedule": await gateway.request("/anime/schedule") or []}

        params: dict[str, object] = {"limit": limit, "offset": offset}
        if q.strip():
            anime = await gateway.search(q.strip(), limit=limit, offset=offset)
        else:
            anime = await gateway.request("/anime", params) or []
        return {"anime": anime, "hasMore": len(anime) == limit}
    except HTTPException:
        raise
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="YummyAnime API is temporarily unavailable") from error
