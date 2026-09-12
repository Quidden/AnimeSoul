"""Pure helpers for merging local and Google Drive save documents.

This module deliberately contains no filesystem or network access.  Keeping the
conflict-resolution rules separate makes them easy to test without constructing
the Google Drive client.
"""

from __future__ import annotations

from datetime import datetime
import json
from typing import Any, Literal


FieldSource = Literal["local", "cloud"] | None


def _normalized_timestamp(value: Any) -> float:
    """Normalize JS milliseconds and Unix seconds to one comparable scale."""

    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0
    try:
        timestamp = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return timestamp / 1000 if timestamp > 10_000_000_000 else timestamp


def _document_timestamp(document: dict[str, Any]) -> float:
    """Return a comparable timestamp for last-writer-wins collection fields."""

    return _normalized_timestamp(document.get("updatedAt"))


def _field_updated_at(
    snapshot: dict[str, Any], field: str, fallback: float = 0.0
) -> float:
    revisions = _as_dict(snapshot.get("fieldUpdatedAt"))
    return _normalized_timestamp(revisions.get(field)) or fallback


def _field_source(
    field: str,
    local_snapshot: dict[str, Any],
    cloud_snapshot: dict[str, Any],
    local_fallback: float = 0.0,
    cloud_fallback: float = 0.0,
) -> FieldSource:
    local_time = _field_updated_at(local_snapshot, field, local_fallback)
    cloud_time = _field_updated_at(cloud_snapshot, field, cloud_fallback)
    if not local_time and not cloud_time:
        return None
    return "local" if local_time >= cloud_time else "cloud"


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _unique(values: list[Any]) -> list[Any]:
    """Deduplicate JSON scalar values while preserving their order."""

    result: list[Any] = []
    seen: set[str] = set()
    for value in values:
        marker = json.dumps(value, ensure_ascii=False, sort_keys=True)
        if marker not in seen:
            seen.add(marker)
            result.append(value)
    return result


def _episode_updated_at(value: dict[str, Any]) -> float:
    try:
        return float(value.get("updatedAt", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def _progress_reset_at(value: dict[str, Any]) -> float:
    try:
        return float(value.get("resetAt", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def _merge_episode_state(
    local: dict[str, Any], cloud: dict[str, Any], prefer_watched: bool
) -> dict[str, Any]:
    """Merge one episode without mistaking the farthest seek for the latest position."""

    local_is_newer = _episode_updated_at(local) >= _episode_updated_at(cloud)
    newer, older = (local, cloud) if local_is_newer else (cloud, local)
    merged = {**older, **newer}

    if prefer_watched:
        merged["completed"] = bool(local.get("completed") or cloud.get("completed"))
        merged["manuallyCompleted"] = bool(
            local.get("manuallyCompleted") or cloud.get("manuallyCompleted")
        )

    histories = _unique(
        _as_list(local.get("completionHistory"))
        + _as_list(cloud.get("completionHistory"))
    )
    if histories:
        merged["completionHistory"] = sorted(histories)
    for key in ("completions", "watchedSeconds", "duration"):
        values = [local.get(key), cloud.get(key)]
        numeric = [value for value in values if isinstance(value, (int, float))]
        if numeric:
            merged[key] = max(numeric)

    # Old exports used `time`. Keep compatibility, while modern `position` follows
    # the most recently updated record so rewinding on one device is respected.
    if "time" in local or "time" in cloud:
        merged["time"] = max(
            float(local.get("time", 0) or 0),
            float(cloud.get("time", 0) or 0),
        )
    return merged


def merge_storage_documents(
    local_doc: dict[str, Any],
    cloud_doc: dict[str, Any],
    prefer_watched: bool = True,
    anime_only: bool = False,
) -> dict[str, Any]:
    """Merge local and cloud storage documents according to profile rules."""

    if not isinstance(local_doc, dict):
        return cloud_doc if isinstance(cloud_doc, dict) else {}
    if not isinstance(cloud_doc, dict):
        return local_doc

    local_time = _document_timestamp(local_doc)
    cloud_time = _document_timestamp(cloud_doc)
    collection_source: Literal["local", "cloud"] | None = None
    if local_time or cloud_time:
        collection_source = "local" if local_time >= cloud_time else "cloud"

    newer_doc = local_doc if collection_source != "cloud" else cloud_doc
    older_doc = cloud_doc if collection_source != "cloud" else local_doc
    merged = {**older_doc, **newer_doc}
    merged["schemaVersion"] = max(
        local_doc.get("schemaVersion", 1),
        cloud_doc.get("schemaVersion", 1),
    )

    local_profiles = local_doc.get("profiles", [])
    cloud_profiles = cloud_doc.get("profiles", [])
    if not isinstance(local_profiles, list):
        local_profiles = []
    if not isinstance(cloud_profiles, list):
        cloud_profiles = []

    local_by_id = {
        str(profile.get("id")): profile
        for profile in local_profiles
        if isinstance(profile, dict) and profile.get("id")
    }
    cloud_by_id = {
        str(profile.get("id")): profile
        for profile in cloud_profiles
        if isinstance(profile, dict) and profile.get("id")
    }

    # Profiles have no deletion UI/tombstones yet. Union is therefore safer:
    # merely opening a stale device must never delete a newer cloud profile.
    profile_ids = list(local_by_id)
    profile_ids.extend(pid for pid in cloud_by_id if pid not in local_by_id)

    merged_profiles: list[dict[str, Any]] = []
    for profile_id in profile_ids:
        local_profile = local_by_id.get(profile_id)
        cloud_profile = cloud_by_id.get(profile_id)
        if local_profile and cloud_profile:
            merged_profiles.append(
                merge_profile(
                    local_profile,
                    cloud_profile,
                    prefer_watched=prefer_watched,
                    anime_only=anime_only,
                    collection_source=collection_source,
                    local_document_time=local_time,
                    cloud_document_time=cloud_time,
                )
            )
        elif local_profile:
            merged_profiles.append(local_profile)
        elif cloud_profile:
            merged_profiles.append(cloud_profile)

    merged["profiles"] = merged_profiles
    if local_time or cloud_time:
        merged["updatedAt"] = newer_doc.get("updatedAt")
    merged_profile_ids = {profile.get("id") for profile in merged_profiles}
    if merged.get("activeProfile") not in merged_profile_ids and merged_profiles:
        merged["activeProfile"] = merged_profiles[0].get("id")
    return merged


def merge_profile(
    local_profile: dict[str, Any],
    cloud_profile: dict[str, Any],
    prefer_watched: bool = True,
    anime_only: bool = False,
    collection_source: Literal["local", "cloud"] | None = None,
    local_document_time: float = 0.0,
    cloud_document_time: float = 0.0,
) -> dict[str, Any]:
    """Merge two profiles sharing the same ID."""

    if collection_source == "cloud" and not anime_only:
        merged_profile = {**local_profile, **cloud_profile}
    else:
        merged_profile = {**cloud_profile, **local_profile}
    local_snapshot = local_profile.get("snapshot", {})
    cloud_snapshot = cloud_profile.get("snapshot", {})
    if not isinstance(local_snapshot, dict):
        local_snapshot = {}
    if not isinstance(cloud_snapshot, dict):
        cloud_snapshot = {}

    merged_profile["snapshot"] = merge_snapshot(
        local_snapshot,
        cloud_snapshot,
        prefer_watched=prefer_watched,
        anime_only=anime_only,
        collection_source=collection_source,
        local_document_time=local_document_time,
        cloud_document_time=cloud_document_time,
    )
    return merged_profile


def merge_snapshot(
    local_snapshot: dict[str, Any],
    cloud_snapshot: dict[str, Any],
    prefer_watched: bool = True,
    anime_only: bool = False,
    collection_source: Literal["local", "cloud"] | None = None,
    local_document_time: float = 0.0,
    cloud_document_time: float = 0.0,
) -> dict[str, Any]:
    """Merge favorites, folders, tracking, progress, ratings, and profile metadata."""

    if collection_source == "cloud" and not anime_only:
        merged = {**local_snapshot, **cloud_snapshot}
    else:
        merged = {**cloud_snapshot, **local_snapshot}
    if anime_only:
        # Preserve local player and UI preferences during an anime-only restore.
        if "playerPrefs" in local_snapshot:
            merged["playerPrefs"] = local_snapshot["playerPrefs"]
        if "theme" in local_snapshot:
            merged["theme"] = local_snapshot["theme"]

    synced_fields = (
        "favorites",
        "folders",
        "progress",
        "ratings",
        "tracked",
        "theme",
        "toolbar",
        "playerPrefs",
        "historyClearedAt",
        "historyEnabled",
        "libraryExpanded",
        "watchingExpanded",
        "historyExpanded",
        "watchingHidden",
    )
    field_sources = {
        field: _field_source(
            field,
            local_snapshot,
            cloud_snapshot,
            local_document_time,
            cloud_document_time,
        )
        for field in synced_fields
    }
    merged["fieldUpdatedAt"] = {
        field: max(
            _field_updated_at(local_snapshot, field, local_document_time),
            _field_updated_at(cloud_snapshot, field, cloud_document_time),
        )
        for field in synced_fields
    }

    # Settings follow their own revisions. A progress change on an old device
    # must not roll back a newer theme or player preference from the cloud.
    if not anime_only:
        for field in (
            "theme",
            "toolbar",
            "playerPrefs",
            "historyClearedAt",
            "historyEnabled",
            "libraryExpanded",
            "watchingExpanded",
            "historyExpanded",
        ):
            source = field_sources[field]
            source_snapshot = cloud_snapshot if source == "cloud" else local_snapshot
            if source and field in source_snapshot:
                merged[field] = source_snapshot[field]

    local_favorites = _as_list(local_snapshot.get("favorites"))
    cloud_favorites = _as_list(cloud_snapshot.get("favorites"))
    favorites_source = field_sources["favorites"]
    if favorites_source == "local":
        merged["favorites"] = local_favorites
    elif favorites_source == "cloud":
        merged["favorites"] = cloud_favorites
    else:
        merged["favorites"] = sorted(set(local_favorites) | set(cloud_favorites))

    local_folders = _as_list(local_snapshot.get("folders"))
    cloud_folders = _as_list(cloud_snapshot.get("folders"))
    folders_source = field_sources["folders"]
    source_folders = cloud_folders if folders_source == "cloud" else local_folders
    other_folders = local_folders if folders_source == "cloud" else cloud_folders
    other_by_id = {
        str(folder.get("id")): folder
        for folder in other_folders
        if isinstance(folder, dict) and folder.get("id")
    }
    merged_folders: list[dict[str, Any]] = []
    for source_folder in source_folders:
        if not isinstance(source_folder, dict):
            continue
        folder_id = str(source_folder.get("id"))
        if folder_id in other_by_id:
            other_folder = other_by_id[folder_id]
            merged_folder = dict(source_folder)
            if folders_source is None:
                merged_folder["animeIds"] = sorted(
                    set(_as_list(source_folder.get("animeIds")))
                    | set(_as_list(other_folder.get("animeIds")))
                )
            merged_folder["notes"] = {
                **_as_dict(other_folder.get("notes")),
                **_as_dict(source_folder.get("notes")),
            }
            merged_folders.append(merged_folder)
        else:
            merged_folders.append(source_folder)

    source_folder_ids = {
        str(folder.get("id")) for folder in source_folders if isinstance(folder, dict)
    }
    for other_folder in other_folders:
        if (
            folders_source is None
            and isinstance(other_folder, dict)
            and str(other_folder.get("id")) not in source_folder_ids
        ):
            merged_folders.append(other_folder)
    merged["folders"] = merged_folders

    # Tracking membership follows the latest document so an unsubscribe is not
    # undone by a stale cloud copy.  Baselines are still merged conservatively.
    local_tracked = _as_list(local_snapshot.get("tracked"))
    cloud_tracked = _as_list(cloud_snapshot.get("tracked"))
    tracked_source = field_sources["tracked"]
    source_tracked = cloud_tracked if tracked_source == "cloud" else local_tracked
    other_tracked = local_tracked if tracked_source == "cloud" else cloud_tracked
    other_tracked_by_id = {
        int(tracker["animeId"]): tracker
        for tracker in other_tracked
        if isinstance(tracker, dict) and tracker.get("animeId") is not None
    }
    source_ids: set[int] = set()
    merged_tracked: list[dict[str, Any]] = []
    for source_tracker in source_tracked:
        if not isinstance(source_tracker, dict) or source_tracker.get("animeId") is None:
            continue
        anime_id = int(source_tracker["animeId"])
        source_ids.add(anime_id)
        other_tracker = other_tracked_by_id.get(anime_id, {})
        item = {**other_tracker, **source_tracker}
        item["animeIds"] = sorted(
            set(_as_list(source_tracker.get("animeIds")))
            | set(_as_list(other_tracker.get("animeIds")))
        )
        known_keys = sorted(
            set(_as_list(source_tracker.get("knownEpisodeKeys")))
            | set(_as_list(other_tracker.get("knownEpisodeKeys")))
        )
        if known_keys:
            item["knownEpisodeKeys"] = known_keys
        known_any_keys = sorted(
            set(_as_list(source_tracker.get("knownAnyEpisodeKeys")))
            | set(_as_list(other_tracker.get("knownAnyEpisodeKeys")))
        )
        if known_any_keys:
            item["knownAnyEpisodeKeys"] = known_any_keys
        item["knownEpisodes"] = max(
            int(source_tracker.get("knownEpisodes", 0) or 0),
            int(other_tracker.get("knownEpisodes", 0) or 0),
            len(known_keys),
        )
        if tracked_source is None:
            item["dubs"] = sorted(
                set(_as_list(source_tracker.get("dubs")))
                | set(_as_list(other_tracker.get("dubs")))
            )
            pending = sorted(
                set(_as_list(source_tracker.get("pendingEpisodeKeys")))
                | set(_as_list(other_tracker.get("pendingEpisodeKeys")))
            )
        else:
            pending = _as_list(source_tracker.get("pendingEpisodeKeys"))
        item["pendingEpisodeKeys"] = pending
        item["newEpisodes"] = len(pending)
        if tracked_source is None:
            pending_other_dub = sorted(
                set(_as_list(source_tracker.get("pendingOtherDubEpisodeKeys")))
                | set(_as_list(other_tracker.get("pendingOtherDubEpisodeKeys")))
            )
        else:
            pending_other_dub = _as_list(
                source_tracker.get("pendingOtherDubEpisodeKeys")
            )
        item["pendingOtherDubEpisodeKeys"] = pending_other_dub
        item["otherDubEpisodes"] = len(pending_other_dub)
        for timestamp_key in ("lastCheckedAt", "lastNewEpisodeAt"):
            item[timestamp_key] = max(
                int(source_tracker.get(timestamp_key, 0) or 0),
                int(other_tracker.get(timestamp_key, 0) or 0),
            )
        merged_tracked.append(item)

    if tracked_source is None:
        for tracker in other_tracked:
            if (
                isinstance(tracker, dict)
                and tracker.get("animeId") is not None
                and int(tracker["animeId"]) not in source_ids
            ):
                merged_tracked.append(tracker)
    merged["tracked"] = merged_tracked

    local_progress = _as_dict(local_snapshot.get("progress"))
    cloud_progress = _as_dict(cloud_snapshot.get("progress"))
    merged_progress: dict[str, Any] = {}
    for anime_id in set(local_progress) | set(cloud_progress):
        local_item = _as_dict(local_progress.get(anime_id))
        cloud_item = _as_dict(cloud_progress.get(anime_id))
        reset_at = max(_progress_reset_at(local_item), _progress_reset_at(cloud_item))
        local_episodes = {
            key: value
            for key, value in _as_dict(local_item.get("episodes")).items()
            if isinstance(value, dict)
            and (not reset_at or _episode_updated_at(value) > reset_at)
        }
        cloud_episodes = {
            key: value
            for key, value in _as_dict(cloud_item.get("episodes")).items()
            if isinstance(value, dict)
            and (not reset_at or _episode_updated_at(value) > reset_at)
        }
        local_latest = max(
            (
                _episode_updated_at(value)
                for value in local_episodes.values()
                if isinstance(value, dict)
            ),
            default=_progress_reset_at(local_item),
        )
        cloud_latest = max(
            (
                _episode_updated_at(value)
                for value in cloud_episodes.values()
                if isinstance(value, dict)
            ),
            default=_progress_reset_at(cloud_item),
        )
        merged_item = (
            {**cloud_item, **local_item}
            if local_latest >= cloud_latest
            else {**local_item, **cloud_item}
        )
        merged_item["episodes"] = {
            key: _merge_episode_state(
                _as_dict(local_episodes.get(key)),
                _as_dict(cloud_episodes.get(key)),
                prefer_watched,
            )
            for key in set(local_episodes) | set(cloud_episodes)
        }
        if reset_at:
            merged_item["resetAt"] = reset_at
        merged_progress[anime_id] = merged_item
    merged["progress"] = merged_progress

    # Ratings are profile data too. Respect deletions from the newest document;
    # during an unprioritized merge, keep the newest edit for every anime.
    local_ratings = _as_dict(local_snapshot.get("ratings"))
    cloud_ratings = _as_dict(cloud_snapshot.get("ratings"))
    ratings_source = field_sources["ratings"]
    if ratings_source == "local":
        merged["ratings"] = local_ratings
    elif ratings_source == "cloud":
        merged["ratings"] = cloud_ratings
    else:
        merged_ratings: dict[str, Any] = {}
        for anime_id in set(local_ratings) | set(cloud_ratings):
            local_rating = _as_dict(local_ratings.get(anime_id))
            cloud_rating = _as_dict(cloud_ratings.get(anime_id))
            if anime_id not in local_ratings:
                merged_ratings[anime_id] = cloud_rating
                continue
            if anime_id not in cloud_ratings:
                merged_ratings[anime_id] = local_rating
                continue
            local_updated = int(local_rating.get("updatedAt", 0) or 0)
            cloud_updated = int(cloud_rating.get("updatedAt", 0) or 0)
            merged_ratings[anime_id] = (
                local_rating if local_updated >= cloud_updated else cloud_rating
            )
        merged["ratings"] = merged_ratings

    # Names are metadata only, but make an exported JSON document readable.
    if collection_source == "cloud" and not anime_only:
        merged["animeTitles"] = {
            **_as_dict(local_snapshot.get("animeTitles")),
            **_as_dict(cloud_snapshot.get("animeTitles")),
        }
    else:
        merged["animeTitles"] = {
            **_as_dict(cloud_snapshot.get("animeTitles")),
            **_as_dict(local_snapshot.get("animeTitles")),
        }
    for anime_id, item in merged_progress.items():
        if isinstance(item, dict) and item.get("title"):
            merged["animeTitles"][str(anime_id)] = item["title"]

    local_hidden = _as_list(local_snapshot.get("watchingHidden"))
    cloud_hidden = _as_list(cloud_snapshot.get("watchingHidden"))
    hidden_source = field_sources["watchingHidden"]
    if hidden_source == "local":
        merged["watchingHidden"] = local_hidden
    elif hidden_source == "cloud":
        merged["watchingHidden"] = cloud_hidden
    else:
        merged["watchingHidden"] = sorted(set(local_hidden) | set(cloud_hidden))
    return merged
