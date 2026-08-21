"""React-compatible resilient catalogue endpoints."""

from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, HTTPException, Query, Response

from ..config import settings
from ..services.catalog import CatalogueUnavailableError, HybridCatalogueService
from ..services.kodik import KodikAnimeGateway
from ..services.yummy import YummyAnimeGateway


router = APIRouter(prefix="/api/yummy", tags=["YummyAnime", "Kodik"])
gateway = YummyAnimeGateway(settings.yummy_token)
kodik_gateway = KodikAnimeGateway(settings.data_dir)
catalogue_service = HybridCatalogueService(gateway, kodik_gateway, settings.data_dir)


def _source_headers(sources: dict[str, str]) -> dict[str, str]:
    return {
        "X-AnimeSoul-Yummy-Status": sources.get("yummy", "unused"),
        "X-AnimeSoul-Kodik-Status": sources.get("kodik", "unused"),
    }


def _set_source_headers(response: Response, sources: dict[str, str]) -> None:
    for key, value in _source_headers(sources).items():
        response.headers[key] = value


@router.get("")
async def yummy_proxy(
    response: Response,
    mode: str = "catalog",
    id: int | None = None,
    ids: str = "",
    limit: int = Query(24, ge=1, le=48),
    offset: int = Query(0, ge=0),
    q: str = "",
) -> dict:
    """Keep the UI contract while filling missing data from either provider."""

    try:
        if mode == "ping":
            started_at = time.perf_counter()
            await gateway.request("/anime", {"limit": 1, "offset": 0})
            _set_source_headers(response, {"yummy": "ok", "kodik": "unused"})
            return {
                "ok": True,
                "upstreamMs": round((time.perf_counter() - started_at) * 1000),
            }
        if mode == "details":
            requested = [item for item in ids.split(",") if item][:50]
            anime, sources = await catalogue_service.details(requested)
            _set_source_headers(response, sources)
            return {"anime": anime, "_sources": sources}
        if mode == "videos":
            if id is None:
                raise HTTPException(status_code=400, detail="Anime ID is required")
            payload, sources = await catalogue_service.videos(id)
            _set_source_headers(response, sources)
            return {**payload, "_sources": sources}
        if mode == "trailers":
            if id is None:
                raise HTTPException(status_code=400, detail="Anime ID is required")
            trailers = await gateway.request(f"/anime/{id}/trailers") or []
            _set_source_headers(response, {"yummy": "ok", "kodik": "unused"})
            return {"trailers": trailers}
        if mode == "schedule":
            schedule = await gateway.request("/anime/schedule") or []
            _set_source_headers(response, {"yummy": "ok", "kodik": "unused"})
            return {"schedule": schedule}

        anime, sources = await catalogue_service.catalogue(q.strip(), limit, offset)
        _set_source_headers(response, sources)
        return {
            "anime": anime,
            "hasMore": len(anime) == limit,
            "_sources": sources,
        }
    except HTTPException:
        raise
    except CatalogueUnavailableError as error:
        raise HTTPException(
            status_code=502,
            detail=str(error),
            headers=_source_headers(error.sources),
        ) from error
    except RuntimeError as error:
        raise HTTPException(
            status_code=503,
            detail=str(error),
            headers=_source_headers({"yummy": "error", "kodik": "unused"}),
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="YummyAnime API is temporarily unavailable",
            headers=_source_headers({"yummy": "error", "kodik": "unused"}),
        ) from error
