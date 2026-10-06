"""Website boundary: explicit API allowlist, sessions, CSRF and permissions."""

import asyncio
import hmac
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .database import digest

BODY_LIMIT = 4 * 1024 * 1024
PUBLIC_AUTH = {"config", "me", "register", "login", "reset", "confirm", "google/start", "google/callback"}


def current_user(request: Request):
    user = getattr(request.state, "account", None)
    if not user:
        raise HTTPException(401, "Войдите в аккаунт")
    return user


def require_permission(request: Request, permission: str):
    user = current_user(request)
    if not user["emailVerified"] or permission not in user["permissions"]:
        raise HTTPException(403, "Нет разрешения для этого действия")
    return user


class WebsiteSecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, database, config):
        super().__init__(app)
        self.database, self.config = database, config

    async def dispatch(self, request, call_next):
        try:
            response = await self.handle(request, call_next)
        except HTTPException as error:
            response = JSONResponse({"detail": error.detail}, status_code=error.status_code, headers=error.headers)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' https:; "
            "media-src 'self' https: blob:; frame-src https:; worker-src 'self' blob:; "
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        )
        if self.config.secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    async def handle(self, request, call_next):
        path = request.url.path
        if path.startswith(("/watch-party", "/ws/")) or path == "/health":
            raise HTTPException(404, "Маршрут недоступен в серверном режиме")
        if not path.startswith("/api/"):
            return await call_next(request)
        ip = request.client.host if request.client else "unknown"
        await asyncio.to_thread(self.database.rate_limit, "api:" + ip, 600, 60)
        account = await asyncio.to_thread(self.database.authenticate, request.cookies.get(self.config.cookie, ""))
        request.state.account = account
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            if request.headers.get("origin") != self.config.origin:
                raise HTTPException(403, "Недопустимый источник запроса")
            if account:
                if request.headers.get("x-account-id") != account["id"]:
                    raise HTTPException(409, "Аккаунт изменился в другой вкладке. Перезагрузите страницу.")
                csrf = request.headers.get("x-csrf-token", "")
                if not csrf or not hmac.compare_digest(digest(csrf), account["session"]["csrf_hash"]):
                    raise HTTPException(403, "Не удалось проверить CSRF-токен. Перезагрузите страницу.")
            if request.method != "DELETE":
                if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
                    raise HTTPException(415, "Требуется JSON")
                body = bytearray()
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > BODY_LIMIT:
                        raise HTTPException(413, "Слишком большой запрос")
                # Starlette's cached request forwards this bounded body to routing.
                request._body = bytes(body)
        if path.startswith("/api/auth/"):
            action = path.removeprefix("/api/auth/")
            if action not in PUBLIC_AUTH:
                current_user(request)
        elif path == "/api/storage":
            current_user(request)
        elif path.startswith("/api/profiles/") and request.method == "GET":
            if path == "/api/profiles/me":
                current_user(request)
        elif path == "/api/profiles/presence" and request.method == "POST":
            current_user(request)
        elif path.startswith("/api/admin/"):
            current_user(request)  # Individual handlers check their permission.
        elif path == "/api/kodik" or path == "/api/kodik/stream":
            user = require_permission(request, "player.use")
            if request.method == "POST":
                await asyncio.to_thread(self.database.rate_limit, "stream:" + user["id"], 30, 60)
        elif path == "/api/kodik/download" and request.method == "POST":
            user = require_permission(request, "downloads.use")
            await asyncio.to_thread(self.database.rate_limit, "download:" + user["id"], 30, 60)
        elif path == "/api/yummy" and request.method == "GET":
            pass
        elif path.startswith("/api/episode-dates/") and request.method == "GET":
            pass
        elif path.startswith("/api/community-ratings") and request.method == "GET":
            pass
        elif path == "/api/health" and request.method == "GET":
            pass
        else:
            raise HTTPException(404, "Маршрут недоступен в серверном режиме")
        return await call_next(request)


def trusted_hosts(origin: str):
    return [urlsplit(origin).hostname]
