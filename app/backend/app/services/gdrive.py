"""Google Drive storage synchronization service."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
import secrets
import time
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any, Literal
import httpx

from .gdrive_merge import (
    _document_timestamp,
    merge_profile,
    merge_snapshot,
    merge_storage_documents,
)

logger = logging.getLogger(__name__)

DEFAULT_CLIENT_ID = ""
DEFAULT_CLIENT_SECRET = ""

FOLDER_NAME = "AnimeSoul"
STORAGE_FILENAME = "animesoul-storage.json"


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

    def save_client_credentials(self, client_id: str, client_secret: str | None) -> None:
        """Save custom client credentials and preserve an omitted/blank secret."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        current_id, current_secret = self.get_client_credentials()
        normalized_secret = (client_secret.strip() or None) if client_secret else None
        resolved_secret = current_secret if normalized_secret is None else normalized_secret
        payload = {"client_id": client_id, "client_secret": resolved_secret}
        credentials_changed = bool(
            current_id
            and (current_id != client_id or current_secret != resolved_secret)
        )
        self.credentials_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        if credentials_changed:
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
