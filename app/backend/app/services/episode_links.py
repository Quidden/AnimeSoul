"""Keep one-off releases separate from a provider's full season playlist."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlsplit


def _kodik_episode(video: dict[str, Any]) -> str | None:
    source = str(video.get("iframe_url") or "")
    if "kodik" not in (source + str(video.get("data", {}).get("player", ""))).lower():
        return None
    try:
        return parse_qs(urlsplit(source).query).get("episode", [None])[0]
    except ValueError:
        return None


def normalize_episode_links(anime: dict[str, Any], videos: list[dict[str, Any]]) -> dict[str, Any]:
    """Preserve provider episode numbers in URLs and catalog numbers in saves.

    A single special can be episode 0 (or 24, etc.) of a TV playlist. Responses
    sometimes contain that entire playlist under the special's ID. An explicit
    mapping from catalog episode 1 to another provider episode identifies the
    special; other playlist entries must not become episodes of this title.
    """
    single_release = (
        str((anime.get("episodes") or {}).get("count")) == "1"
        and (anime.get("type") or {}).get("alias") in {"special", "ova", "ona", "movie"}
    )
    if not single_release:
        return {"videos": videos, "invalidEpisodeNumbers": []}

    mapped_episodes = {
        episode for video in videos
        if str(video.get("number")) == "1"
        and (episode := _kodik_episode(video)) is not None
        and episode != "1"
    }
    provider_episode = next(iter(mapped_episodes)) if len(mapped_episodes) == 1 else None
    normalized: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    # Prefer the original catalog row over a later import of episode 0.
    ordered = sorted(videos, key=lambda video: str(video.get("number")) != "1")
    for video in ordered:
        embedded_episode = _kodik_episode(video)
        if provider_episode is not None and embedded_episode is not None:
            if embedded_episode != provider_episode:
                continue
        elif str(video.get("number")) != "1":
            continue
        source = str(video.get("iframe_url") or "")
        if source and source in seen_sources:
            continue
        if source:
            seen_sources.add(source)
        normalized.append({**video, "number": "1"})

    invalid = sorted({str(video.get("number")) for video in videos} - {"1"})
    return {"videos": normalized, "invalidEpisodeNumbers": invalid}
