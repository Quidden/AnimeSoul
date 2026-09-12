"""Conservative identity matching for individual titles, not whole franchises."""

from __future__ import annotations

import re
from typing import Any


def normalise_title(value: object) -> str:
    text = str(value or "").casefold().replace("ё", "е")
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).strip()


def anime_titles(anime: dict[str, Any]) -> set[str]:
    values = [anime.get(key) for key in ("title", "original", "title_ru", "title_en")]
    other = anime.get("other_titles")
    values.extend(other if isinstance(other, list) else re.split(r"\s*(?:/|\||;)\s*", other or ""))
    # Yummy's `original` can describe the adaptation source, not its title.
    return {normalise_title(value) for value in values} - {
        "", "ранобэ", "манга", "манхва", "маньхуа", "оригинал", "оригинальное",
        "игра", "новелла", "роман", "manga", "light novel", "original", "game",
    }


def anime_remote_ids(anime: dict[str, Any]) -> dict[str, str]:
    raw = anime.get("remote_ids")
    return {
        key: str(value).casefold().strip()
        for key, value in (raw.items() if isinstance(raw, dict) else [])
        if value not in (None, "", 0, "0")
    }


def anime_match_score(left: dict[str, Any], right: dict[str, Any]) -> int:
    left_ids, right_ids = anime_remote_ids(left), anime_remote_ids(right)
    # Shikimori identifies an individual season/part/movie. Kinopoisk and IMDb
    # can be shared by several seasons, so they must never override this ID.
    if left_ids.get("shikimori_id") and right_ids.get("shikimori_id"):
        return 1000 if left_ids["shikimori_id"] == right_ids["shikimori_id"] else 0
    if left_ids.get("kodik_id") and left_ids.get("kodik_id") == right_ids.get("kodik_id"):
        return 1000
    if not (anime_titles(left) & anime_titles(right)):
        return 0
    left_year, right_year = left.get("year"), right.get("year")
    if left_year and right_year and str(left_year) != str(right_year):
        return 0
    left_kind = (left.get("type") or {}).get("alias")
    right_kind = (right.get("type") or {}).get("alias")
    if left_kind and right_kind and left_kind != right_kind:
        return 0
    return 550 if left_year and right_year else 500
