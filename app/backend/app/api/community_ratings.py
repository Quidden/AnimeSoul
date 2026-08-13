"""Anonymous shared rating endpoints for local and hosted AnimeSoul servers."""

from __future__ import annotations

import math
import re
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response

from ..config import settings
from ..services.community_ratings import CommunityRatingStore


router = APIRouter(prefix="/api/community-ratings", tags=["Community ratings"])
store = CommunityRatingStore(settings.data_dir)
COOKIE_NAME = "animesoul_rating_voter"
COOKIE_MAX_AGE = 365 * 24 * 60 * 60
EPISODE_KEY = re.compile(r"^\d+:.{1,40}$")


@router.get("")
async def list_community_ratings(
    ids: str = "",
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Return requested aggregates or a recent paginated public export."""

    if ids.strip():
        anime_ids = _parse_ids(ids)
        has_more = False
    else:
        anime_ids = await store.list_anime_ids(limit + 1, offset)
        has_more = len(anime_ids) > limit
        anime_ids = anime_ids[:limit]
    return {
        "ratings": await store.aggregate(anime_ids),
        "hasMore": has_more,
        "offset": offset,
    }


@router.get("/{anime_id}")
async def get_community_rating(anime_id: int) -> dict[str, Any]:
    """Return the public AnimeSoul aggregate for one anime."""

    _validate_anime_id(anime_id)
    rating = (await store.aggregate([anime_id])).get(str(anime_id))
    return {"rating": rating}


@router.put("/{anime_id}")
async def publish_community_rating(
    anime_id: int,
    payload: dict[str, Any],
    request: Request,
    response: Response,
) -> dict[str, Any]:
    """Replace this browser's anonymous vote tree and return the new aggregate."""

    _validate_anime_id(anime_id)
    voter_id = request.cookies.get(COOKIE_NAME)
    if not voter_id or not _valid_voter_id(voter_id):
        voter_id = str(uuid.uuid4())
    title = str(payload.get("title", "")).strip()[:300]
    anime = _optional_score(payload.get("anime"))
    seasons = _score_map(payload.get("seasons"), "season")
    episodes = _score_map(payload.get("episodes"), "episode")
    await store.replace(voter_id, anime_id, title, anime, seasons, episodes)
    response.set_cookie(
        COOKIE_NAME,
        voter_id,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    rating = (await store.aggregate([anime_id])).get(str(anime_id))
    return {"rating": rating, "anonymous": True}


def _parse_ids(raw: str) -> list[int]:
    values: list[int] = []
    for item in raw.split(","):
        if not item.strip():
            continue
        try:
            anime_id = int(item)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Anime IDs must be integers") from error
        _validate_anime_id(anime_id)
        if anime_id not in values:
            values.append(anime_id)
        if len(values) > 100:
            raise HTTPException(status_code=422, detail="At most 100 anime IDs are allowed")
    return values


def _validate_anime_id(anime_id: int) -> None:
    if anime_id <= 0:
        raise HTTPException(status_code=422, detail="Anime ID must be positive")


def _valid_voter_id(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


def _optional_score(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(status_code=422, detail="Scores must be numbers from 1 to 10")
    score = float(value)
    if not math.isfinite(score) or score < 1 or score > 10:
        raise HTTPException(status_code=422, detail="Scores must be numbers from 1 to 10")
    return score


def _score_map(value: Any, kind: str) -> dict[str, float]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail=f"{kind.title()} ratings must be an object")
    maximum = 200 if kind == "season" else 5000
    if len(value) > maximum:
        raise HTTPException(status_code=422, detail=f"Too many {kind} ratings")
    normalized: dict[str, float] = {}
    for raw_key, raw_score in value.items():
        key = str(raw_key)
        valid_key = key.isdigit() and int(key) > 0 if kind == "season" else bool(EPISODE_KEY.fullmatch(key))
        if not valid_key:
            raise HTTPException(status_code=422, detail=f"Invalid {kind} rating key")
        score = _optional_score(raw_score)
        if score is not None:
            normalized[key] = score
    return normalized
