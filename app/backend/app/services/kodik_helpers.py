"""Pure normalization helpers for Kodik player and catalogue payloads."""

from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any
from urllib.parse import parse_qs, urlparse


class OfflineLibraryError(RuntimeError):
    """A user-facing offline-library error."""


class CredentialVerificationUnavailable(OfflineLibraryError):
    """A credential could not be confirmed because its provider is offline."""


def _normalise_url(value: str) -> str:
    return f"https:{value}" if value.startswith("//") else value


def _is_kodik_url(value: str) -> bool:
    try:
        host = (urlparse(_normalise_url(value)).hostname or "").casefold()
    except ValueError:
        return False
    allowed_suffixes = (
        "kodik.info",
        "kodik.cc",
        "kodikplayer.com",
        "kodik.biz",
        "kodik.online",
    )
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in allowed_suffixes)


def _private_player_link(value: str) -> str:
    """Return the exact protocol-relative player URL signed for Kodik.

    The private API accepts the player link, rather than a catalogue lookup.
    Its query string is deliberately retained: Kodik embeds use it to select a
    concrete episode inside a season.
    """

    if not _is_kodik_url(value):
        raise OfflineLibraryError("Для загрузки поддерживаются только источники Kodik.")
    parsed = urlparse(_normalise_url(value))
    if not parsed.hostname or not parsed.path:
        raise OfflineLibraryError("Не удалось прочитать ссылку плеера Kodik.")
    host = parsed.hostname.casefold()
    path = parsed.path
    if not re.fullmatch(r"/(?:serial|season|seria|video|movie)/[^/]+/[^/]+/[^/]+/?", path):
        raise OfflineLibraryError("Ссылка Kodik не указывает конкретное видео или сезон.")
    return f"//{host}{path}" + (f"?{parsed.query}" if parsed.query else "")


def _kodik_player_candidates(raw_link: str | None, official_link: str | None) -> list[str]:
    """Order private-API links without replacing an exact episode selection.

    ``/seria`` (and the single-video variants) already identifies the row the
    user selected.  A catalogue lookup is useful for broad ``/serial`` and
    ``/season`` embeds, but it can resolve another franchise entry while the
    frontend is still loading that entry's remote ids.  Keep exact links
    authoritative and use the lookup only as a fallback for them.
    """

    raw_url = urlparse(_normalise_url(raw_link or ""))
    raw_path = raw_url.path.casefold()
    query_keys = {key.casefold() for key in parse_qs(raw_url.query)}
    raw_is_exact = (
        any(raw_path.startswith(prefix) for prefix in ("/seria/", "/video/", "/movie/"))
        or "episode" in query_keys
    )
    ordered = (raw_link, official_link) if raw_is_exact else (official_link, raw_link)
    candidates = [item for item in ordered if item]
    if raw_link:
        bare_link = raw_link.split("?", 1)[0]
        if bare_link != raw_link:
            candidates.append(bare_link)
    return list(dict.fromkeys(candidates))


def _kodik_signature(link: str, ip: str, deadline: str, private_key: str) -> str:
    message = f"{link}:{ip}:{deadline}".encode("utf-8")
    return hmac.new(private_key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _first_kodik_player_link(value: object) -> str | None:
    """Find a concrete player link in a Kodik catalogue response."""

    candidates: list[str] = []

    def collect(entry: object) -> None:
        if isinstance(entry, str):
            try:
                candidates.append(_private_player_link(entry))
            except OfflineLibraryError:
                pass
            return
        if isinstance(entry, dict):
            for nested in entry.values():
                collect(nested)
        elif isinstance(entry, list):
            for nested in entry:
                collect(nested)

    collect(value)
    return next(
        (
            link for link in candidates
            if urlparse(_normalise_url(link)).path.casefold().startswith(("/seria/", "/video/", "/movie/"))
        ),
        candidates[0] if candidates else None,
    )


def _select_kodik_source(links: object, requested_quality: int) -> tuple[str, int]:
    """Select one direct source from the documented private API response."""

    if not isinstance(links, dict):
        raise OfflineLibraryError("Kodik не предоставил доступные качества видео.")
    available = sorted(
        (int(quality) for quality in links if str(quality).isdigit()),
        reverse=True,
    )
    selected = next((quality for quality in available if quality <= requested_quality), None)
    if selected is None and available:
        selected = available[-1]
    if selected is None:
        raise OfflineLibraryError("Kodik не предоставил качества для этой серии.")
    variants = links.get(str(selected), links.get(selected))
    if isinstance(variants, str):
        source = variants
    elif isinstance(variants, list):
        source = next(
            (
                _source_value(item)
                for item in variants
                if isinstance(item, dict)
                and isinstance(_source_value(item), str)
            ),
            None,
        )
    elif isinstance(variants, dict):
        source = _source_value(variants)
    else:
        source = None
    if not isinstance(source, str) or not source.strip():
        raise OfflineLibraryError("Kodik не передал прямую ссылку на выбранное качество.")
    return _normalise_url(source.strip()), selected


def _source_value(value: dict[object, object]) -> object:
    """Read a direct source regardless of the API field's casing.

    Kodik's private API currently uses ``Src``/``Type`` while some older
    examples use lowercase names.  JSON keys are case-sensitive, so normalise
    them at this boundary rather than making the download flow depend on one
    spelling.
    """

    for key, item in value.items():
        if isinstance(key, str) and key.casefold() in {"src", "url", "link"}:
            return item
    return None


def _normalise_kodik_sources(links: object) -> list[dict[str, Any]]:
    """Expose every direct quality returned by Kodik in one stable shape."""

    if not isinstance(links, dict):
        return []
    result: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for raw_quality, raw_variants in links.items():
        try:
            quality = int(raw_quality)
        except (TypeError, ValueError):
            continue
        variants = raw_variants if isinstance(raw_variants, list) else [raw_variants]
        for variant in variants:
            if isinstance(variant, str):
                source = variant
                source_type = "hls" if ".m3u8" in variant.split("?", 1)[0] else "video"
            elif isinstance(variant, dict):
                source = _source_value(variant)
                source_type = next(
                    (
                        str(item).casefold()
                        for key, item in variant.items()
                        if isinstance(key, str) and key.casefold() in {"type", "format", "mime"}
                    ),
                    "",
                )
            else:
                continue
            if not isinstance(source, str) or not source.strip():
                continue
            source = _normalise_url(source.strip())
            identity = (quality, source)
            if identity in seen:
                continue
            seen.add(identity)
            result.append(
                {
                    "quality": quality,
                    "src": source,
                    "type": source_type or ("hls" if ".m3u8" in source.split("?", 1)[0] else "video"),
                }
            )
    return sorted(result, key=lambda item: int(item["quality"]), reverse=True)


def _normalise_kodik_subtitles(value: object) -> list[dict[str, Any]]:
    """Accept current and legacy subtitle shapes used by the private API."""

    result: list[dict[str, Any]] = []
    seen: set[str] = set()

    def visit(candidate: object, fallback_label: str = "") -> None:
        if isinstance(candidate, str):
            source = candidate.strip()
            if not source.startswith(("//", "https://", "http://")):
                return
            source = _normalise_url(source)
            if source in seen:
                return
            seen.add(source)
            label = fallback_label.strip() or f"Субтитры {len(result) + 1}"
            result.append({"src": source, "label": label, "language": fallback_label.strip() or "und"})
            return
        if isinstance(candidate, list):
            for item in candidate:
                visit(item, fallback_label)
            return
        if not isinstance(candidate, dict):
            return
        source = _source_value(candidate)
        if isinstance(source, str):
            label = next(
                (
                    str(item).strip()
                    for key, item in candidate.items()
                    if isinstance(key, str)
                    and key.casefold() in {"label", "title", "name", "language", "lang", "srclang"}
                    and str(item).strip()
                ),
                fallback_label.strip() or f"Субтитры {len(result) + 1}",
            )
            language = next(
                (
                    str(item).strip()
                    for key, item in candidate.items()
                    if isinstance(key, str)
                    and key.casefold() in {"language", "lang", "srclang", "locale"}
                    and str(item).strip()
                ),
                fallback_label.strip() or "und",
            )
            normalized = _normalise_url(source.strip())
            if normalized and normalized not in seen:
                seen.add(normalized)
                result.append(
                    {
                        "src": normalized,
                        "label": label,
                        "language": language,
                        "default": bool(candidate.get("default", candidate.get("Default", False))),
                    }
                )
            return
        for key, item in candidate.items():
            visit(item, str(key))

    visit(value)
    return result


def _normalise_kodik_skips(payload: dict[str, Any]) -> dict[str, dict[str, float]]:
    """Read opening/ending markers without depending on one API field casing."""

    raw = next(
        (
            value
            for key, value in payload.items()
            if isinstance(key, str) and key.casefold().replace("_", "") in {"skips", "skipsegments", "segments"}
        ),
        None,
    )
    result: dict[str, dict[str, float]] = {}

    def segment(kind: object, value: object) -> None:
        normalized_kind = str(kind or "").casefold().replace("_", "").replace("-", "")
        target = "opening" if normalized_kind in {"opening", "op", "intro"} else "ending" if normalized_kind in {"ending", "ed", "outro", "credits"} else ""
        if not target:
            return
        start: object = None
        end: object = None
        length: object = None
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            start, end = value[0], value[1]
        elif isinstance(value, dict):
            lowered = {str(key).casefold().replace("_", ""): item for key, item in value.items()}
            start = lowered.get("start", lowered.get("time", lowered.get("from")))
            end = lowered.get("end", lowered.get("to"))
            length = lowered.get("length", lowered.get("duration"))
        try:
            start_number = float(start)
            length_number = float(length) if length is not None else float(end) - start_number
        except (TypeError, ValueError):
            return
        if start_number < 0 or length_number <= 0:
            return
        result[target] = {"time": start_number, "length": length_number}

    def implicit_kind(value: object, fallback: str) -> str:
        """Classify Kodik's unlabelled single range by its position.

        Kodik returns a generic ``skip`` array for some releases. With two
        ranges their order is unambiguous, but with one range the old parser
        always called it an opening. That turns end credits into an opening
        button and routes Android auto-next through an unreliable seek-to-end.
        Openings in ordinary episodes occur well before ten minutes; a lone
        range after that point is therefore the ending.
        """

        start: object = None
        if isinstance(value, (list, tuple)) and value:
            start = value[0]
        elif isinstance(value, dict):
            lowered = {str(key).casefold().replace("_", ""): item for key, item in value.items()}
            start = lowered.get("start", lowered.get("time", lowered.get("from")))
        try:
            return "ending" if float(start) >= 600 else fallback
        except (TypeError, ValueError):
            return fallback

    if isinstance(raw, dict):
        for key, value in raw.items():
            segment(key, value)
        generic = next(
            (value for key, value in raw.items() if str(key).casefold() in {"skip", "markers"}),
            None,
        )
        if isinstance(generic, list):
            ranges = [item for item in generic if isinstance(item, (list, tuple, dict))]
            if ranges:
                first = ranges[0]
                if isinstance(first, dict):
                    lowered = {str(key).casefold(): item for key, item in first.items()}
                    explicit = lowered.get("type", lowered.get("kind", lowered.get("name")))
                    segment(explicit or implicit_kind(first, "opening"), first)
                else:
                    segment(implicit_kind(first, "opening"), first)
            if len(ranges) > 1:
                last = ranges[-1]
                if isinstance(last, dict):
                    lowered = {str(key).casefold(): item for key, item in last.items()}
                    explicit = lowered.get("type", lowered.get("kind", lowered.get("name")))
                    segment(explicit or "ending", last)
                else:
                    segment("ending", last)
    elif isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            lowered = {str(key).casefold(): item_value for key, item_value in item.items()}
            segment(lowered.get("type", lowered.get("kind", lowered.get("name"))), item)
    return result


def _sanitize_skip_segments(
    value: object,
    duration: object = None,
) -> dict[str, dict[str, float]]:
    """Validate persisted skip markers and repair legacy lone endings.

    Builds before this repair stored an unlabelled late Kodik range under the
    ``opening`` key. Keep existing downloads usable without redownloading them
    by correcting that shape as it is written or exposed by the library API.
    """

    if not isinstance(value, dict):
        return {}
    try:
        media_duration = max(0.0, float(duration or 0))
    except (TypeError, ValueError):
        media_duration = 0.0
    result: dict[str, dict[str, float]] = {}
    for kind in ("opening", "ending"):
        raw = value.get(kind)
        if not isinstance(raw, dict):
            continue
        try:
            start = float(raw.get("time"))
            length = float(raw.get("length"))
        except (TypeError, ValueError):
            continue
        if start < 0 or length <= 0 or (media_duration > 0 and start >= media_duration):
            continue
        if media_duration > 0:
            length = min(length, media_duration - start)
        if length > 0:
            result[kind] = {"time": start, "length": length}

    opening = result.get("opening")
    late_threshold = media_duration * 0.6 if media_duration > 0 else 600.0
    if opening and "ending" not in result and opening["time"] >= late_threshold:
        result["ending"] = result.pop("opening")
    return result


def _normalise_dubbing(value: object) -> str:
    """Make catalogue and application dubbing labels comparable."""

    text = str(value or "").casefold().replace("озвучка", "")
    return re.sub(r"[^\w]+", "", text)


def _normalise_title(value: object) -> str:
    text = str(value or "").casefold().replace("ё", "е")
    return re.sub(r"[^\w]+", "", text).strip()


def _episode_link_from_results(
    results: object,
    season: object,
    episode: object,
    translation_id: object = None,
    dubbing: object = None,
    title: object = None,
    original_title: object = None,
) -> str | None:
    """Pick the exact episode link returned by Kodik's public catalogue.

    ``with_episodes_data=true`` adds an episode object with a concrete
    ``/seria/...`` link.  That link, unlike a season or serial embed, is what
    the private API expects when it signs a direct download URL.
    """

    if not isinstance(results, list):
        return None
    wanted_season = str(season or "").strip()
    wanted_episode = str(episode or "").strip()
    if not wanted_season or not wanted_episode:
        return None
    wanted_translation = str(translation_id).strip() if translation_id is not None else ""
    wanted_dubbing = _normalise_dubbing(dubbing)
    wanted_titles = {_normalise_title(item) for item in (title, original_title)} - {""}
    matches: list[tuple[int, int, str]] = []

    for index, result in enumerate(results):
        if not isinstance(result, dict):
            continue
        seasons = result.get("seasons")
        if not isinstance(seasons, dict):
            continue

        translation = result.get("translation")
        if not isinstance(translation, dict):
            translation = {}
        result_translation = str(
            translation.get("id", result.get("translation_id", result.get("translationId", "")))
        ).strip()
        result_dubbing = _normalise_dubbing(
            translation.get("title", result.get("translation_title", result.get("dubbing", "")))
        )
        material = result.get("material_data")
        if not isinstance(material, dict):
            material = {}
        result_titles = {
            _normalise_title(item)
            for item in (
                result.get("title"),
                result.get("title_orig"),
                material.get("title"),
                material.get("title_en"),
            )
        } - {""}
        for result_season, season_data in seasons.items():
            if not isinstance(season_data, dict):
                continue
            episodes = season_data.get("episodes")
            if not isinstance(episodes, dict):
                continue
            episode_data = next((value for key, value in episodes.items() if str(key) == wanted_episode), None)
            if isinstance(episode_data, str):
                link = episode_data
            elif isinstance(episode_data, dict):
                link = episode_data.get("link")
            else:
                link = None
            if not isinstance(link, str) or not link.strip():
                continue

            score = 25 if str(result_season) == wanted_season else 0
            if wanted_titles and result_titles:
                if wanted_titles & result_titles:
                    score += 200
                elif any(
                    wanted in result_title or result_title in wanted
                    for wanted in wanted_titles
                    for result_title in result_titles
                ):
                    score += 60
            if wanted_translation and result_translation == wanted_translation:
                score += 100
            if wanted_dubbing and result_dubbing:
                if wanted_dubbing == result_dubbing:
                    score += 80
                elif wanted_dubbing in result_dubbing or result_dubbing in wanted_dubbing:
                    score += 40
            matches.append((score, -index, link.strip()))

    return max(matches)[2] if matches else None


def _search_identifier_name(source_id_type: object) -> str | None:
    """Map the app's stable catalogue id to Kodik's documented search key."""

    kind = str(source_id_type or "").casefold().strip()
    return {
        "shikimori": "shikimori_id",
        "kinopoisk": "kinopoisk_id",
        "imdb": "imdb_id",
        "kodik": "id",
    }.get(kind)

