"""Optional release-date metadata, fetched independently of playback."""

from fastapi import APIRouter, HTTPException, Path, Query

from ..config import settings
from ..services.episode_dates import EpisodeDatesGateway, EpisodeDatesUnavailable


router = APIRouter(tags=["Episode dates"])
gateway = EpisodeDatesGateway(settings.data_dir)


@router.get("/api/episode-dates/{mal_id}")
async def get_episode_dates(
    mal_id: int = Path(ge=1, le=2_000_000_000),
    page: int = Query(default=1, ge=1, le=100),
) -> dict:
    try:
        return await gateway.dates(mal_id, page)
    except EpisodeDatesUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
