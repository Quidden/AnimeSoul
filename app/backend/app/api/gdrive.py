"""FastAPI endpoints for Google Drive OAuth2 and storage synchronization."""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
from typing import Any, Literal
import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..config import settings
from ..services.gdrive import get_gdrive_service, merge_storage_documents
from ..services.storage import JsonStorage, validate_storage_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gdrive", tags=["Google Drive Sync"])

gdrive_service = get_gdrive_service(settings.data_dir)
local_storage = JsonStorage(settings.data_dir)
oauth_completion_lock = asyncio.Lock()


class CredentialsRequest(BaseModel):
    client_id: str
    client_secret: str | None = None


GOOGLE_CLIENT_ID_RE = re.compile(r"^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$", re.IGNORECASE)


async def _verify_google_credentials(client_id: str, client_secret: str | None) -> list[dict[str, str]]:
    """Probe Google's official OAuth endpoints without starting a user login."""

    checks: list[dict[str, str]] = []
    if not GOOGLE_CLIENT_ID_RE.fullmatch(client_id):
        return [{
            "field": "googleClientId",
            "label": "Google Client ID",
            "status": "invalid",
            "detail": "Client ID должен иметь вид 123…-abc.apps.googleusercontent.com.",
        }, *([{
            "field": "googleClientSecret",
            "label": "Google Client Secret",
            "status": "pending",
            "detail": "Secret нельзя проверить, пока Client ID имеет неверный формат.",
        }] if client_secret else [])]

    auth_params = {
        "client_id": client_id,
        "redirect_uri": "http://localhost",
        "response_type": "code",
        "scope": "openid email",
        "state": secrets.token_urlsafe(12),
    }
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            auth_response = await client.get(
                "https://accounts.google.com/o/oauth2/v2/auth",
                params=auth_params,
            )
            auth_hint = f"{auth_response.headers.get('location', '')} {auth_response.text[:4000]}".casefold()
            id_rejected = auth_response.status_code in {400, 401, 403} or any(
                marker in auth_hint for marker in ("invalid_client", "deleted_client", "oauth client was not found")
            )
            if id_rejected:
                checks.append({
                    "field": "googleClientId",
                    "label": "Google Client ID",
                    "status": "invalid",
                    "detail": "Google не распознал Client ID или OAuth-клиент отключён.",
                })
                if client_secret:
                    checks.append({
                        "field": "googleClientSecret",
                        "label": "Google Client Secret",
                        "status": "pending",
                        "detail": "Secret нельзя проверить с отклонённым Client ID.",
                    })
                return checks
            checks.append({
                "field": "googleClientId",
                "label": "Google Client ID",
                "status": "valid",
                "detail": "Google распознал OAuth-клиент и принял параметры входа.",
            })

            if client_secret:
                token_response = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "code": f"animesoul-credential-check-{secrets.token_urlsafe(12)}",
                        "grant_type": "authorization_code",
                        "redirect_uri": "http://localhost",
                    },
                )
                payload = token_response.json() if token_response.content else {}
                oauth_error = str(payload.get("error") or "") if isinstance(payload, dict) else ""
                if oauth_error == "invalid_grant":
                    checks.append({
                        "field": "googleClientSecret",
                        "label": "Google Client Secret",
                        "status": "valid",
                        "detail": "Google принял пару Client ID/Secret; тестовый одноразовый код ожидаемо отклонён.",
                    })
                elif oauth_error in {"invalid_client", "unauthorized_client"}:
                    checks.append({
                        "field": "googleClientSecret",
                        "label": "Google Client Secret",
                        "status": "invalid",
                        "detail": "Google отклонил пару Client ID/Secret. Проверьте Secret и тип OAuth-клиента.",
                    })
                else:
                    checks.append({
                        "field": "googleClientSecret",
                        "label": "Google Client Secret",
                        "status": "pending",
                        "detail": f"Google не дал однозначного результата проверки Secret{f' ({oauth_error})' if oauth_error else ''}.",
                    })
    except (httpx.HTTPError, ValueError) as error:
        detail = "Google OAuth сейчас недоступен — ключ не сохранён, повторите проверку позже."
        checked_fields = {check["field"] for check in checks}
        if "googleClientId" not in checked_fields:
            checks.append({
                "field": "googleClientId", "label": "Google Client ID",
                "status": "pending", "detail": detail,
            })
        if client_secret and "googleClientSecret" not in checked_fields:
            checks.append({
                "field": "googleClientSecret", "label": "Google Client Secret",
                "status": "pending", "detail": detail,
            })
        logger.info("Google credential verification unavailable: %s", type(error).__name__)
    return checks


class SyncRequest(BaseModel):
    mode: Literal["auto", "local", "cloud", "merge", "anime_only"] = "auto"
    prefer_watched: bool = True
    folder_mode: Literal["visible", "appdata"] = "visible"
    resolve_initial_choice: bool = False


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
        "oauth_pending": gdrive_service.load_pending_oauth() is not None,
        "user_email": tokens.get("user_email", "") if has_tokens else "",
        "user_name": tokens.get("user_name", "") if has_tokens else "",
        "has_credentials": bool(client_id),
        "client_id": client_id,
        "has_cloud_file": has_cloud_file,
        "choice_pending": choice_pending,
        **gdrive_service.sync_status(),
    }


@router.get("/network-check")
async def network_check() -> dict[str, Any]:
    """Check the Google OAuth host without sending credentials or changing OAuth state."""
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            response = await client.get("https://oauth2.googleapis.com/")
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Google OAuth недоступен: {error}",
        ) from error
    return {"reachable": True, "status_code": response.status_code}


@router.post("/credentials")
async def set_credentials(payload: CredentialsRequest) -> dict[str, Any]:
    """Verify and save user-provided Google OAuth client credentials."""

    client_id = payload.client_id.strip()
    client_secret = payload.client_secret.strip() if payload.client_secret is not None else None
    checks = await _verify_google_credentials(client_id, client_secret)
    saved = bool(checks) and all(check["status"] == "valid" for check in checks)
    if saved:
        gdrive_service.save_client_credentials(client_id, client_secret)
    return {"saved": saved, "checks": checks}


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
        # Android suspends Chaquopy networking while Chrome owns the screen.
        # Store the one-time code now and exchange it after AnimeSoul returns
        # to the foreground. This callback therefore performs no remote I/O.
        gdrive_service.save_pending_oauth(code, redirect_uri)
        return """
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="utf-8">
            <title>AnimeSoul — завершаем подключение</title>
            <style>
                body {
                    font-family: system-ui, -apple-system, sans-serif;
                    background: #0d0b14;
                    color: #e2e8f0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                }
                .card {
                    background: #181524;
                    border: 1px solid #2e2842;
                    border-radius: 16px;
                    padding: 32px;
                    text-align: center;
                    max-width: 400px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                }
                h2 { color: #a78bfa; margin-top: 0; }
                p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
                a { display:inline-block;margin-top:14px;padding:12px 18px;border-radius:12px;background:#8f6df2;color:white;text-decoration:none;font-weight:700; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Код Google получен</h2>
                <p>Вернитесь в AnimeSoul — приложение завершит подключение на переднем плане.</p>
                <a href="animesoul://oauth-complete">Вернуться в AnimeSoul</a>
            </div>
            <script>
                setTimeout(() => { window.location.href = "animesoul://oauth-complete"; }, 700);
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


@router.post("/complete-auth")
async def complete_auth() -> dict[str, Any]:
    """Exchange a pending Android callback after the app is foregrounded."""
    # Both the Android deep link and the foreground listener can request
    # completion. Serialize them so Google's one-time code is exchanged once.
    async with oauth_completion_lock:
        pending = gdrive_service.load_pending_oauth()
        if not pending:
            return {"pending": False, "connected": bool(gdrive_service.load_tokens())}
        try:
            tokens = await gdrive_service.exchange_code(
                str(pending["code"]),
                str(pending["redirect_uri"]),
            )
        except httpx.TransportError as error:
            # Keep a still-valid one-time code so foreground polling can retry a
            # transient Android network transition.
            raise HTTPException(status_code=503, detail=f"Google OAuth временно недоступен: {error}") from error
        except Exception as error:
            gdrive_service.clear_pending_oauth()
            raise HTTPException(status_code=400, detail=str(error)) from error
        gdrive_service.clear_pending_oauth()
        return {
            "pending": False,
            "connected": True,
            "user_email": tokens.get("user_email", ""),
        }


@router.post("/disconnect")
async def disconnect() -> dict[str, bool]:
    """Revoke Google access when reachable, then disconnect this device."""
    revoked = await gdrive_service.revoke_and_disconnect()
    return {"disconnected": True, "revoked": revoked}


async def _sync_drive_impl(payload: SyncRequest) -> dict[str, Any]:
    """Sync local storage with Google Drive."""
    tokens = gdrive_service.load_tokens()
    if not tokens or not isinstance(tokens, dict):
        raise HTTPException(status_code=401, detail="Google Диск не подключен.")

    if tokens.get("choice_pending"):
        if not payload.resolve_initial_choice:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Сначала выберите, как объединить найденное облачное сохранение. "
                    "Фоновая синхронизация пока заблокирована."
                ),
            )
        if payload.mode == "auto":
            raise HTTPException(
                status_code=422,
                detail="Для первого объединения выберите явный режим.",
            )

    local_document = await local_storage.read()
    if local_document is not None and not validate_storage_document(local_document):
        raise HTTPException(
            status_code=500,
            detail="Локальное сохранение повреждено. Облачные данные не изменены.",
        )
    local_doc = local_document or {}
    cloud_doc, _ = await gdrive_service.read_cloud_storage(mode=payload.folder_mode)

    if payload.mode == "local" or (payload.mode == "auto" and not cloud_doc):
        if not local_document:
            raise HTTPException(
                status_code=409,
                detail="Локальное сохранение отсутствует; облако не перезаписано.",
            )
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
        backup = await local_storage.replace_with_backup(
            cloud_doc,
            "before-cloud-restore",
        )
        gdrive_service.update_cloud_status(has_cloud_file=True, choice_pending=False)
        return {
            "status": "downloaded",
            "document": cloud_doc,
            "backup": str(backup) if backup else None,
        }

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
        backup = await local_storage.replace_with_backup(
            cloud_doc,
            "before-cloud-restore",
        )
        gdrive_service.update_cloud_status(has_cloud_file=True, choice_pending=False)
        return {
            "status": "downloaded",
            "document": cloud_doc,
            "backup": str(backup) if backup else None,
        }

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
