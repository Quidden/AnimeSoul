"""FastAPI endpoints for Google Drive OAuth2 and storage synchronization."""

from __future__ import annotations

import json
import logging
from typing import Any, Literal
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..config import settings
from ..services.gdrive import get_gdrive_service, merge_storage_documents
from ..services.storage import JsonStorage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gdrive", tags=["Google Drive Sync"])

gdrive_service = get_gdrive_service(settings.data_dir)
local_storage = JsonStorage(settings.data_dir)


class CredentialsRequest(BaseModel):
    client_id: str
    client_secret: str | None = None


class SyncRequest(BaseModel):
    mode: Literal["auto", "local", "cloud", "merge", "anime_only"] = "auto"
    prefer_watched: bool = True
    folder_mode: Literal["visible", "appdata"] = "visible"


@router.get("/status")
async def get_status() -> dict[str, Any]:
    """Return Google Drive connection status and user details."""
    tokens = gdrive_service.load_tokens()
    client_id, _ = gdrive_service.get_client_credentials()
    has_tokens = bool(tokens and isinstance(tokens, dict) and tokens.get("access_token"))

    choice_pending = bool(tokens.get("choice_pending")) if has_tokens else False
    has_cloud_file = bool(tokens.get("has_cloud_file", choice_pending)) if has_tokens else False

    return {
        "connected": has_tokens,
        "user_email": tokens.get("user_email", "") if has_tokens else "",
        "user_name": tokens.get("user_name", "") if has_tokens else "",
        "has_credentials": bool(client_id),
        "client_id": client_id,
        "has_cloud_file": has_cloud_file,
        "choice_pending": choice_pending,
        **gdrive_service.sync_status(),
    }


@router.post("/credentials")
async def set_credentials(payload: CredentialsRequest) -> dict[str, Any]:
    """Save user-provided Google OAuth client credentials."""
    client_secret = payload.client_secret.strip() if payload.client_secret is not None else None
    gdrive_service.save_client_credentials(payload.client_id.strip(), client_secret)
    return {"saved": True}


@router.get("/auth-url")
async def get_auth_url(request: Request, redirect_uri: str | None = None) -> dict[str, str]:
    """Generate Google OAuth authorization URL."""
    client_id, _ = gdrive_service.get_client_credentials()
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="Google OAuth Client ID не настроен. Укажите Client ID в настройках.",
        )

    if not redirect_uri:
        base = str(request.base_url).rstrip("/")
        redirect_uri = f"{base}/api/gdrive/oauth2callback"

    url, _ = gdrive_service.get_auth_url(redirect_uri)
    return {"url": url, "redirect_uri": redirect_uri}


@router.get("/oauth2callback", response_class=HTMLResponse)
async def oauth2callback(request: Request, code: str = Query(...), state: str = Query(...)) -> str:
    """Handle OAuth redirect callback from Google."""
    base = str(request.base_url).rstrip("/")
    redirect_uri = f"{base}/api/gdrive/oauth2callback"

    try:
        if not gdrive_service.consume_oauth_state(state):
            raise ValueError("OAuth session expired or has an invalid state. Start connection again.")
        tokens = await gdrive_service.exchange_code(code, redirect_uri)
        email = tokens.get("user_email", "Google Account")
        return f"""
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="utf-8">
            <title>AnimeSoul — Google Drive подключен</title>
            <style>
                body {{
                    font-family: system-ui, -apple-system, sans-serif;
                    background: #0d0b14;
                    color: #e2e8f0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                }}
                .card {{
                    background: #181524;
                    border: 1px solid #2e2842;
                    border-radius: 16px;
                    padding: 32px;
                    text-align: center;
                    max-width: 400px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                }}
                h2 {{ color: #a78bfa; margin-top: 0; }}
                p {{ color: #94a3b8; font-size: 14px; line-height: 1.5; }}
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Google Диск подключен!</h2>
                <p>Вы успешно авторизовались как <strong>{email}</strong>.</p>
                <p>Окно можно закрыть, сохранение AnimeSoul обновлено.</p>
            </div>
            <script>
                if (window.opener) {{
                    window.opener.postMessage({{ type: "GDRIVE_AUTH_SUCCESS" }}, {json.dumps(base)});
                    setTimeout(() => window.close(), 1500);
                }}
            </script>
        </body>
        </html>
        """
    except Exception as exc:
        logger.error("OAuth exchange failed: %s", exc)
        return f"""
        <!DOCTYPE html>
        <html lang="ru">
        <head><meta charset="utf-8"><title>Ошибка подключения</title></head>
        <body style="background:#0d0b14;color:#ef4444;font-family:sans-serif;padding:40px;text-align:center;">
            <h2>Не удалось подключить Google Диск</h2>
            <p>{exc}</p>
        </body>
        </html>
        """


@router.post("/disconnect")
async def disconnect() -> dict[str, bool]:
    """Disconnect Google Drive account."""
    gdrive_service.disconnect()
    return {"disconnected": True}


async def _sync_drive_impl(payload: SyncRequest) -> dict[str, Any]:
    """Sync local storage with Google Drive."""
    tokens = gdrive_service.load_tokens()
    if not tokens or not isinstance(tokens, dict):
        raise HTTPException(status_code=401, detail="Google Диск не подключен.")

    local_doc = await local_storage.read() or {}
    cloud_doc, _ = await gdrive_service.read_cloud_storage(mode=payload.folder_mode)

    gdrive_service.set_choice_pending(False)

    if payload.mode == "local" or (payload.mode == "auto" and not cloud_doc):
        # Upload local document to cloud
        file_id = await gdrive_service.write_cloud_storage(local_doc, mode=payload.folder_mode)
        gdrive_service.update_cloud_status(has_cloud_file=bool(file_id), choice_pending=False)
        return {"status": "uploaded", "file_id": file_id, "document": local_doc}

    if payload.mode == "anime_only":
        merged = merge_storage_documents(
            local_doc, cloud_doc or {}, prefer_watched=payload.prefer_watched, anime_only=True
        )
        await local_storage.write(merged)
        file_id = await gdrive_service.write_cloud_storage(merged, mode=payload.folder_mode)
        gdrive_service.update_cloud_status(has_cloud_file=bool(file_id), choice_pending=False)
        return {"status": "merged", "file_id": file_id, "document": merged}

    if payload.mode == "cloud":
        # Download cloud document and replace local
        if not cloud_doc:
            raise HTTPException(status_code=444, detail="Сохранение на Google Диске не найдено.")
        await local_storage.write(cloud_doc)
        gdrive_service.update_cloud_status(has_cloud_file=True, choice_pending=False)
        return {"status": "downloaded", "document": cloud_doc}

    # Mode: merge (or auto when both exist)
    if cloud_doc and local_doc:
        merged = merge_storage_documents(
            local_doc, cloud_doc, prefer_watched=payload.prefer_watched
        )
        await local_storage.write(merged)
        file_id = await gdrive_service.write_cloud_storage(merged, mode=payload.folder_mode)
        gdrive_service.update_cloud_status(has_cloud_file=bool(file_id), choice_pending=False)
        return {"status": "merged", "file_id": file_id, "document": merged}

    if cloud_doc:
        await local_storage.write(cloud_doc)
        gdrive_service.update_cloud_status(has_cloud_file=True, choice_pending=False)
        return {"status": "downloaded", "document": cloud_doc}

    file_id = await gdrive_service.write_cloud_storage(local_doc, mode=payload.folder_mode)
    gdrive_service.update_cloud_status(has_cloud_file=bool(file_id), choice_pending=False)
    return {"status": "uploaded", "file_id": file_id, "document": local_doc}


@router.post("/sync")
async def sync_drive(payload: SyncRequest) -> dict[str, Any]:
    """Run an explicit sync and expose its real outcome to status polling."""
    gdrive_service.mark_sync_started()
    try:
        result = await _sync_drive_impl(payload)
    except Exception as error:
        gdrive_service.mark_sync_failed(error)
        raise
    gdrive_service.mark_sync_succeeded()
    return result
