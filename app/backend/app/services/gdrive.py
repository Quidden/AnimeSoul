"""Google Drive storage synchronization service."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import secrets
import time
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any, Literal
import httpx

logger = logging.getLogger(__name__)

DEFAULT_CLIENT_ID = ""
DEFAULT_CLIENT_SECRET = ""

FOLDER_NAME = "AnimeSoul"
STORAGE_FILENAME = "animesoul-storage.json"


def _document_timestamp(document: dict[str, Any]) -> float:
    """Return a comparable timestamp for last-writer-wins collection fields."""

    value = document.get("updatedAt")
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0
    return 0.0


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

    histories = _unique(_as_list(local.get("completionHistory")) + _as_list(cloud.get("completionHistory")))
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
        merged["time"] = max(float(local.get("time", 0) or 0), float(cloud.get("time", 0) or 0))
    return merged


def merge_storage_documents(
    local_doc: dict[str, Any],
    cloud_doc: dict[str, Any],
    prefer_watched: bool = True,
    anime_only: bool = False,
) -> dict[str, Any]:
    """Merge local and cloud storage documents according to profile and watched preference rules."""

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
        str(p.get("id")): p for p in local_profiles if isinstance(p, dict) and p.get("id")
    }
    cloud_by_id = {
        str(p.get("id")): p for p in cloud_profiles if isinstance(p, dict) and p.get("id")
    }

    # Profile membership follows the latest complete document as well. Otherwise
    # a profile deleted on one device is silently resurrected by an older cloud copy.
    if anime_only or collection_source is None:
        profile_ids = list(local_by_id)
        profile_ids.extend(pid for pid in cloud_by_id if pid not in local_by_id)
    else:
        source = local_by_id if collection_source == "local" else cloud_by_id
        profile_ids = list(source)

    merged_profiles: list[dict[str, Any]] = []
    for pid in profile_ids:
        local_p = local_by_id.get(pid)
        cloud_p = cloud_by_id.get(pid)
        if local_p and cloud_p:
            merged_profiles.append(
                merge_profile(
                    local_p,
                    cloud_p,
                    prefer_watched=prefer_watched,
                    anime_only=anime_only,
                    collection_source=collection_source,
                )
            )
        elif local_p:
            merged_profiles.append(local_p)
        elif cloud_p:
            merged_profiles.append(cloud_p)

    merged["profiles"] = merged_profiles
    if local_time or cloud_time:
        merged["updatedAt"] = newer_doc.get("updatedAt")
    merged_profile_ids = {profile.get("id") for profile in merged_profiles}
    if merged.get("activeProfile") not in merged_profile_ids and merged_profiles:
        merged["activeProfile"] = merged_profiles[0].get("id")

    return merged


def merge_profile(
    local_p: dict[str, Any],
    cloud_p: dict[str, Any],
    prefer_watched: bool = True,
    anime_only: bool = False,
    collection_source: Literal["local", "cloud"] | None = None,
) -> dict[str, Any]:
    """Merge two profiles sharing the same ID."""

    if collection_source == "cloud" and not anime_only:
        merged_p = {**local_p, **cloud_p}
    else:
        merged_p = {**cloud_p, **local_p}
    local_snap = local_p.get("snapshot", {})
    cloud_snap = cloud_p.get("snapshot", {})

    if not isinstance(local_snap, dict):
        local_snap = {}
    if not isinstance(cloud_snap, dict):
        cloud_snap = {}

    merged_snap = merge_snapshot(
        local_snap,
        cloud_snap,
        prefer_watched=prefer_watched,
        anime_only=anime_only,
        collection_source=collection_source,
    )
    merged_p["snapshot"] = merged_snap
    return merged_p


def merge_snapshot(
    local_snap: dict[str, Any],
    cloud_snap: dict[str, Any],
    prefer_watched: bool = True,
    anime_only: bool = False,
    collection_source: Literal["local", "cloud"] | None = None,
) -> dict[str, Any]:
    """Merge two snapshots (favorites, folders, tracked, progress, etc.)."""

    if collection_source == "cloud" and not anime_only:
        merged = {**local_snap, **cloud_snap}
    else:
        merged = {**cloud_snap, **local_snap}
    if anime_only:
        # Preserve local playerPrefs, theme, and UI settings strictly
        if "playerPrefs" in local_snap:
            merged["playerPrefs"] = local_snap["playerPrefs"]
        if "theme" in local_snap:
            merged["theme"] = local_snap["theme"]

    # 1. Merge Favorites
    local_favs = _as_list(local_snap.get("favorites"))
    cloud_favs = _as_list(cloud_snap.get("favorites"))
    if collection_source == "local":
        merged["favorites"] = local_favs
    elif collection_source == "cloud":
        merged["favorites"] = cloud_favs
    else:
        merged["favorites"] = sorted(set(local_favs) | set(cloud_favs))

    # 2. Merge Folders
    local_folders = _as_list(local_snap.get("folders"))
    cloud_folders = _as_list(cloud_snap.get("folders"))
    source_folders = cloud_folders if collection_source == "cloud" else local_folders
    other_folders = local_folders if collection_source == "cloud" else cloud_folders
    other_by_id = {str(f.get("id")): f for f in other_folders if isinstance(f, dict) and f.get("id")}
    merged_folders = []
    for lf in source_folders:
        if not isinstance(lf, dict):
            continue
        fid = str(lf.get("id"))
        if fid in other_by_id:
            cf = other_by_id[fid]
            merged_f = dict(lf)
            if collection_source is None:
                merged_f["animeIds"] = sorted(set(_as_list(lf.get("animeIds"))) | set(_as_list(cf.get("animeIds"))))
            # Merge notes
            merged_f["notes"] = {**_as_dict(cf.get("notes")), **_as_dict(lf.get("notes"))}
            merged_folders.append(merged_f)
        else:
            merged_folders.append(lf)

    for cf in other_folders:
        if collection_source is None and isinstance(cf, dict) and str(cf.get("id")) not in {str(f.get("id")) for f in source_folders if isinstance(f, dict)}:
            merged_folders.append(cf)

    merged["folders"] = merged_folders

    # 3. Merge tracked anime. Collection membership follows the newest document,
    # preventing an unsubscribed title from returning after cloud synchronization.
    local_tracked = _as_list(local_snap.get("tracked"))
    cloud_tracked = _as_list(cloud_snap.get("tracked"))
    source_tracked = cloud_tracked if collection_source == "cloud" else local_tracked
    other_tracked = local_tracked if collection_source == "cloud" else cloud_tracked
    other_tracked_by_id = {
        int(t["animeId"]): t for t in other_tracked
        if isinstance(t, dict) and t.get("animeId") is not None
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
        item["animeIds"] = sorted(set(_as_list(source_tracker.get("animeIds"))) | set(_as_list(other_tracker.get("animeIds"))))
        known_keys = sorted(set(_as_list(source_tracker.get("knownEpisodeKeys"))) | set(_as_list(other_tracker.get("knownEpisodeKeys"))))
        if known_keys:
            item["knownEpisodeKeys"] = known_keys
        known_any_keys = sorted(set(_as_list(source_tracker.get("knownAnyEpisodeKeys"))) | set(_as_list(other_tracker.get("knownAnyEpisodeKeys"))))
        if known_any_keys:
            item["knownAnyEpisodeKeys"] = known_any_keys
        item["knownEpisodes"] = max(
            int(source_tracker.get("knownEpisodes", 0) or 0),
            int(other_tracker.get("knownEpisodes", 0) or 0),
            len(known_keys),
        )
        if collection_source is None:
            item["dubs"] = sorted(set(_as_list(source_tracker.get("dubs"))) | set(_as_list(other_tracker.get("dubs"))))
            pending = sorted(set(_as_list(source_tracker.get("pendingEpisodeKeys"))) | set(_as_list(other_tracker.get("pendingEpisodeKeys"))))
        else:
            pending = _as_list(source_tracker.get("pendingEpisodeKeys"))
        item["pendingEpisodeKeys"] = pending
        item["newEpisodes"] = len(pending)
        if collection_source is None:
            pending_other_dub = sorted(set(_as_list(source_tracker.get("pendingOtherDubEpisodeKeys"))) | set(_as_list(other_tracker.get("pendingOtherDubEpisodeKeys"))))
        else:
            pending_other_dub = _as_list(source_tracker.get("pendingOtherDubEpisodeKeys"))
        item["pendingOtherDubEpisodeKeys"] = pending_other_dub
        item["otherDubEpisodes"] = len(pending_other_dub)
        for timestamp_key in ("lastCheckedAt", "lastNewEpisodeAt"):
            item[timestamp_key] = max(
                int(source_tracker.get(timestamp_key, 0) or 0),
                int(other_tracker.get(timestamp_key, 0) or 0),
            )
        merged_tracked.append(item)

    if collection_source is None:
        for tracker in other_tracked:
            if isinstance(tracker, dict) and tracker.get("animeId") is not None and int(tracker["animeId"]) not in source_ids:
                merged_tracked.append(tracker)
    merged["tracked"] = merged_tracked

    # 4. Merge Progress (watched status)
    local_progress = local_snap.get("progress", {}) if isinstance(local_snap.get("progress"), dict) else {}
    cloud_progress = cloud_snap.get("progress", {}) if isinstance(cloud_snap.get("progress"), dict) else {}

    all_anime_ids = set(local_progress.keys()) | set(cloud_progress.keys())
    merged_progress: dict[str, Any] = {}

    for aid in all_anime_ids:
        lp = local_progress.get(aid) if isinstance(local_progress.get(aid), dict) else {}
        cp = cloud_progress.get(aid) if isinstance(cloud_progress.get(aid), dict) else {}

        lp_eps = _as_dict(lp.get("episodes"))
        cp_eps = _as_dict(cp.get("episodes"))
        local_latest = max((_episode_updated_at(value) for value in lp_eps.values() if isinstance(value, dict)), default=0)
        cloud_latest = max((_episode_updated_at(value) for value in cp_eps.values() if isinstance(value, dict)), default=0)
        mp = {**cp, **lp} if local_latest >= cloud_latest else {**lp, **cp}

        # Merge nested episode tracking map (e.g. episodes: { "s1e1": { completed: true, time: 100 } })
        all_ep_keys = set(lp_eps.keys()) | set(cp_eps.keys())
        merged_eps: dict[str, Any] = {}

        for ep_k in all_ep_keys:
            lep_val = lp_eps.get(ep_k)
            cep_val = cp_eps.get(ep_k)

            lep_dict = lep_val if isinstance(lep_val, dict) else {}
            cep_dict = cep_val if isinstance(cep_val, dict) else {}

            merged_eps[ep_k] = _merge_episode_state(lep_dict, cep_dict, prefer_watched)

        mp["episodes"] = merged_eps
        merged_progress[aid] = mp

    merged["progress"] = merged_progress

    # Human-readable metadata is never used as an identifier, but makes exported
    # JSON understandable without looking up numeric IDs.
    if collection_source == "cloud" and not anime_only:
        merged["animeTitles"] = {
            **_as_dict(local_snap.get("animeTitles")),
            **_as_dict(cloud_snap.get("animeTitles")),
        }
    else:
        merged["animeTitles"] = {
            **_as_dict(cloud_snap.get("animeTitles")),
            **_as_dict(local_snap.get("animeTitles")),
        }
    for anime_id, item in merged_progress.items():
        if isinstance(item, dict) and item.get("title"):
            merged["animeTitles"][str(anime_id)] = item["title"]

    # 5. Merge watchingHidden
    local_hidden = _as_list(local_snap.get("watchingHidden"))
    cloud_hidden = _as_list(cloud_snap.get("watchingHidden"))
    if collection_source == "local":
        merged["watchingHidden"] = local_hidden
    elif collection_source == "cloud":
        merged["watchingHidden"] = cloud_hidden
    else:
        merged["watchingHidden"] = sorted(set(local_hidden) | set(cloud_hidden))

    return merged


class GoogleDriveService:
    """Handles Google Drive API v3 interactions, OAuth 2.0 tokens, and file sync."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.tokens_file = data_dir / "gdrive-tokens.json"
        self.credentials_file = data_dir / "gdrive-credentials.json"
        self._lock = asyncio.Lock()
        self._pending_document: dict[str, Any] | None = None
        self._sync_task: asyncio.Task[None] | None = None
        self._pending_mode: Literal["visible", "appdata"] = "visible"
        self._local_reader: Callable[[], Awaitable[dict[str, Any] | None]] | None = None
        self._local_writer: Callable[[dict[str, Any]], Awaitable[None]] | None = None
        stored_tokens = self.load_tokens() or {}
        self.last_sync_error = str(stored_tokens.get("last_sync_error") or "")
        self.last_sync_at = float(stored_tokens.get("last_sync_at") or 0.0)
        self.last_sync_started_at = 0.0
        self._oauth_states: dict[str, float] = {}

    def mark_sync_started(self) -> None:
        """Expose a truthful sync lifecycle to the UI."""
        self.last_sync_started_at = time.time()
        self.last_sync_error = ""
        self._persist_sync_result()

    def mark_sync_succeeded(self) -> None:
        self.last_sync_at = time.time()
        self.last_sync_error = ""
        self._persist_sync_result()

    def mark_sync_failed(self, error: Exception | str) -> None:
        self.last_sync_error = str(error)
        self._persist_sync_result()

    def _persist_sync_result(self) -> None:
        """Keep the last confirmed cloud result across app restarts."""
        tokens = self.load_tokens()
        if not tokens or not isinstance(tokens, dict):
            return
        tokens["last_sync_at"] = self.last_sync_at
        tokens["last_sync_error"] = self.last_sync_error
        self.save_tokens(tokens)

    def sync_status(self) -> dict[str, Any]:
        """Return the current background-upload state for status indicators."""
        running = bool(self._sync_task and not self._sync_task.done())
        pending = self._pending_document is not None
        if running:
            state = "syncing"
        elif self.last_sync_error:
            state = "error"
        elif self.last_sync_at:
            state = "synced"
        else:
            state = "idle"
        return {
            "sync_state": state,
            "sync_running": running,
            "sync_pending": pending,
            "last_sync_at": self.last_sync_at,
            "last_sync_started_at": self.last_sync_started_at,
            "last_sync_error": self.last_sync_error,
        }

    def get_client_credentials(self) -> tuple[str, str]:
        """Return (client_id, client_secret) from config/credentials file, settings or defaults."""
        if self.credentials_file.exists():
            try:
                data = json.loads(self.credentials_file.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    client_id = str(data.get("client_id") or data.get("installed", {}).get("client_id") or "")
                    client_secret = str(
                        data.get("client_secret") or data.get("installed", {}).get("client_secret") or ""
                    )
                    if client_id:
                        return client_id, client_secret
            except Exception:
                pass
        from ..config import settings
        if settings.gdrive_client_id:
            return settings.gdrive_client_id, settings.gdrive_client_secret
        return DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET

    def save_client_credentials(self, client_id: str, client_secret: str) -> None:
        """Save custom client credentials provided by user."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        payload = {"client_id": client_id, "client_secret": client_secret}
        old_payload: dict[str, Any] = {}
        if self.credentials_file.exists():
            try:
                old_payload = json.loads(self.credentials_file.read_text(encoding="utf-8"))
            except Exception:
                old_payload = {}
        self.credentials_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        if old_payload and old_payload != payload:
            self.disconnect()

    def load_tokens(self) -> dict[str, Any] | None:
        if not self.tokens_file.exists():
            return None
        try:
            return json.loads(self.tokens_file.read_text(encoding="utf-8"))
        except Exception:
            return None

    def save_tokens(self, tokens: dict[str, Any]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.tokens_file.write_text(json.dumps(tokens, indent=2), encoding="utf-8")

    def set_choice_pending(self, pending: bool) -> None:
        tokens = self.load_tokens()
        if tokens and isinstance(tokens, dict):
            tokens["choice_pending"] = pending
            self.save_tokens(tokens)

    def update_cloud_status(
        self,
        *,
        has_cloud_file: bool | None = None,
        choice_pending: bool | None = None,
    ) -> None:
        """Persist cached cloud state without performing another network request."""

        tokens = self.load_tokens()
        if not tokens or not isinstance(tokens, dict):
            return
        if has_cloud_file is not None:
            tokens["has_cloud_file"] = has_cloud_file
        if choice_pending is not None:
            tokens["choice_pending"] = choice_pending
        self.save_tokens(tokens)

    def disconnect(self) -> None:
        if self.tokens_file.exists():
            try:
                self.tokens_file.unlink()
            except OSError:
                pass

    def get_auth_url(self, redirect_uri: str) -> tuple[str, str]:
        from urllib.parse import urlencode

        client_id, _ = self.get_client_credentials()
        scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email"
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scope,
            "access_type": "offline",
            "prompt": "consent",
            "state": secrets.token_urlsafe(24),
        }
        self._oauth_states[params["state"]] = time.time() + 600
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}", params["state"]

    def consume_oauth_state(self, state: str) -> bool:
        expires_at = self._oauth_states.pop(state, 0)
        return bool(expires_at and expires_at >= time.time())

    async def exchange_code(self, code: str, redirect_uri: str) -> dict[str, Any]:
        client_id, client_secret = self.get_client_credentials()
        data = {
            "client_id": client_id,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
        if client_secret:
            data["client_secret"] = client_secret

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data=data,
            )
            if not resp.is_success:
                try:
                    err_json = resp.json()
                    err_msg = err_json.get("error_description") or err_json.get("error") or resp.text
                except Exception:
                    err_msg = resp.text
                raise Exception(f"Google Token API: {err_msg}")
            tokens = resp.json()
            tokens["expires_at"] = time.time() + float(tokens.get("expires_in", 3600) or 3600)

            # Get user email
            user_info = await self._fetch_user_info(client, tokens.get("access_token", ""))
            tokens["user_email"] = user_info.get("email", "")
            tokens["user_name"] = user_info.get("name", "")

            # Save first: cloud inspection needs the newly issued access token.
            self.save_tokens(tokens)
            try:
                cloud_doc, _ = await self.read_cloud_storage()
                tokens["has_cloud_file"] = cloud_doc is not None
                tokens["choice_pending"] = cloud_doc is not None
            except Exception:
                tokens["has_cloud_file"] = False
                tokens["choice_pending"] = False

            self.save_tokens(tokens)
            return tokens

    async def _fetch_user_info(self, client: httpx.AsyncClient, access_token: str) -> dict[str, Any]:
        try:
            res = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if res.is_success:
                return res.json()
        except Exception:
            pass
        return {}

    async def get_valid_access_token(self) -> str | None:
        tokens = self.load_tokens()
        if not tokens or not isinstance(tokens, dict):
            return None

        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")

        try:
            expires_at = float(tokens.get("expires_at", 0) or 0)
        except (TypeError, ValueError):
            expires_at = 0
        if access_token and (not expires_at or expires_at > time.time() + 60):
            return str(access_token)
        if not refresh_token:
            return access_token

        client_id, client_secret = self.get_client_credentials()
        ref_data = {
            "client_id": client_id,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        if client_secret:
            ref_data["client_secret"] = client_secret

        # Always attempt refresh to ensure non-expired access_token
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data=ref_data,
                )
                if res.is_success:
                    new_tokens = res.json()
                    tokens["access_token"] = new_tokens.get("access_token", access_token)
                    tokens["expires_at"] = time.time() + float(new_tokens.get("expires_in", 3600) or 3600)
                    self.save_tokens(tokens)
                    return tokens["access_token"]
        except Exception as err:
            logger.warning("Failed to refresh Google Drive access token: %s", err)

        return access_token

    async def _get_folder(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        mode: Literal["visible", "appdata"] = "visible",
        create: bool = False,
    ) -> str | None:
        headers = {"Authorization": f"Bearer {access_token}"}

        if mode == "appdata":
            return "appDataFolder"

        # Search for folder "AnimeSoul" in drive root
        query = f"name = '{FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        res = await client.get(
            "https://www.googleapis.com/drive/v3/files",
            params={"q": query, "spaces": "drive"},
            headers=headers,
        )
        res.raise_for_status()
        files = res.json().get("files", [])
        if files:
            return files[0]["id"]

        if not create:
            return None

        # Create folder if it doesn't exist
        create_res = await client.post(
            "https://www.googleapis.com/drive/v3/files",
            json={"name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"},
            headers=headers,
        )
        create_res.raise_for_status()
        return create_res.json()["id"]

    async def read_cloud_storage(
        self, mode: Literal["visible", "appdata"] = "visible"
    ) -> tuple[dict[str, Any] | None, str | None]:
        """Read cloud storage document from Google Drive. Returns (doc, file_id)."""
        access_token = await self.get_valid_access_token()
        if not access_token:
            return None, None

        async with httpx.AsyncClient() as client:
            headers = {"Authorization": f"Bearer {access_token}"}
            folder_id = await self._get_folder(client, access_token, mode, create=False)
            if mode == "visible" and not folder_id:
                return None, None

            spaces = "appDataFolder" if mode == "appdata" else "drive"
            if mode == "appdata":
                q = f"name = '{STORAGE_FILENAME}' and 'appDataFolder' in parents and trashed = false"
            else:
                q = f"name = '{STORAGE_FILENAME}' and '{folder_id}' in parents and trashed = false"

            res = await client.get(
                "https://www.googleapis.com/drive/v3/files",
                params={"q": q, "spaces": spaces},
                headers=headers,
            )
            res.raise_for_status()
            files = res.json().get("files", [])
            if not files:
                return None, None

            file_id = files[0]["id"]
            file_res = await client.get(
                f"https://www.googleapis.com/drive/v3/files/{file_id}",
                params={"alt": "media"},
                headers=headers,
            )
            file_res.raise_for_status()
            doc = file_res.json()
            return doc, file_id

    async def write_cloud_storage(
        self, document: dict[str, Any], mode: Literal["visible", "appdata"] = "visible"
    ) -> str | None:
        """Write storage document to Google Drive. Returns file_id."""
        access_token = await self.get_valid_access_token()
        if not access_token:
            return None

        async with self._lock:
            async with httpx.AsyncClient() as client:
                headers = {"Authorization": f"Bearer {access_token}"}
                folder_id = await self._get_folder(client, access_token, mode, create=True)

                spaces = "appDataFolder" if mode == "appdata" else "drive"
                if mode == "appdata":
                    q = f"name = '{STORAGE_FILENAME}' and 'appDataFolder' in parents and trashed = false"
                else:
                    q = f"name = '{STORAGE_FILENAME}' and '{folder_id}' in parents and trashed = false"

                res = await client.get(
                    "https://www.googleapis.com/drive/v3/files",
                    params={"q": q, "spaces": spaces},
                    headers=headers,
                )
                res.raise_for_status()
                files = res.json().get("files", [])

                content = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")

                if files:
                    file_id = files[0]["id"]
                    patch_res = await client.patch(
                        f"https://www.googleapis.com/upload/drive/v3/files/{file_id}",
                        params={"uploadType": "media"},
                        headers={**headers, "Content-Type": "application/json; charset=utf-8"},
                        content=content,
                    )
                    patch_res.raise_for_status()
                    self.update_cloud_status(has_cloud_file=True, choice_pending=False)
                    return file_id
                else:
                    metadata = {"name": STORAGE_FILENAME}
                    if mode == "appdata":
                        metadata["parents"] = ["appDataFolder"]
                    else:
                        metadata["parents"] = [folder_id]

                    multipart_body = (
                        b"--foo_bar_baud\r\n"
                        b"Content-Type: application/json; charset=UTF-8\r\n\r\n"
                        + json.dumps(metadata).encode("utf-8")
                        + b"\r\n--foo_bar_baud\r\n"
                        b"Content-Type: application/json; charset=UTF-8\r\n\r\n"
                        + content
                        + b"\r\n--foo_bar_baud--"
                    )

                    post_res = await client.post(
                        "https://www.googleapis.com/upload/drive/v3/files",
                        params={"uploadType": "multipart"},
                        headers={
                            **headers,
                            "Content-Type": "multipart/related; boundary=foo_bar_baud",
                        },
                        content=multipart_body,
                    )
                    post_res.raise_for_status()
                    file_id = post_res.json().get("id")
                    self.update_cloud_status(has_cloud_file=bool(file_id), choice_pending=False)
                    return file_id

    def schedule_write(
        self,
        document: dict[str, Any],
        mode: Literal["visible", "appdata"] = "visible",
        *,
        local_reader: Callable[[], Awaitable[dict[str, Any] | None]] | None = None,
        local_writer: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        """Coalesce autosaves and merge the latest local/cloud documents first."""

        self._pending_document = deepcopy(document)
        self._pending_mode = mode
        self._local_reader = local_reader
        self._local_writer = local_writer
        self.mark_sync_started()
        if self._sync_task and not self._sync_task.done():
            return

        async def worker() -> None:
            failed = False
            while self._pending_document is not None:
                pending = self._pending_document
                self._pending_document = None
                pending_mode = self._pending_mode
                local_reader = self._local_reader
                local_writer = self._local_writer
                try:
                    # A newer local save may have arrived while the task was queued.
                    if local_reader:
                        latest_local = await local_reader()
                        if latest_local and _document_timestamp(latest_local) >= _document_timestamp(pending):
                            pending = latest_local

                    cloud_document, _ = await self.read_cloud_storage(mode=pending_mode)
                    merged = merge_storage_documents(pending, cloud_document or {})
                    await self.write_cloud_storage(merged, mode=pending_mode)

                    # Do not overwrite a save that arrived while the network request
                    # was running. The following loop iteration will merge that save.
                    if local_writer and self._pending_document is None:
                        latest_local = await local_reader() if local_reader else pending
                        if not latest_local or _document_timestamp(latest_local) <= _document_timestamp(merged):
                            await local_writer(merged)
                except Exception as error:
                    failed = True
                    self.mark_sync_failed(error)
                    logger.warning("Google Drive autosync failed: %s", error)
                    # Keep the latest state for the next explicit/local save attempt.
                    if self._pending_document is None:
                        self._pending_document = pending
                    break
            if not failed and self._pending_document is None:
                self.mark_sync_succeeded()

        self._sync_task = asyncio.create_task(worker())


_services: dict[Path, GoogleDriveService] = {}


def get_gdrive_service(data_dir: Path) -> GoogleDriveService:
    """Return one shared service per data directory (one lock and autosave queue)."""

    key = data_dir.resolve()
    if key not in _services:
        _services[key] = GoogleDriveService(key)
    return _services[key]
