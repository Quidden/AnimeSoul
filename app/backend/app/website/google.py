"""Google authorization code flow with PKCE, browser-bound state and nonce."""

import asyncio
import base64
import hashlib
import hmac
import secrets
from urllib.parse import urlencode
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from google.auth.transport.requests import Request as GoogleRequest
from google.auth.exceptions import GoogleAuthError
from google.oauth2.id_token import verify_oauth2_token
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import IntegrityError

from . import schema_v1 as s
from .accounts import normalize_email, set_session
from .database import digest, now
from .security import current_user


class TimedGoogleRequest(GoogleRequest):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 15
        return super().__call__(*args, **kwargs)


def google_router(database, config):
    router = APIRouter(prefix="/api/auth/google", tags=["Google login"])
    browser_cookie = "__Host-animesoul_oauth" if config.secure else "animesoul_oauth_dev"
    callback_url = config.origin + "/api/auth/google/callback"

    def start(request, link=False):
        if not config.google_enabled:
            raise HTTPException(503, "Вход через Google ещё не настроен")
        database.rate_limit("oauth:" + (request.client.host if request.client else "unknown"), 15, 300)
        account = current_user(request) if link else None
        if account and now() - account["session"]["created_at"] > 300:
            raise HTTPException(403, "Для привязки Google сначала войдите в аккаунт заново")
        state, browser, nonce, verifier = [secrets.token_urlsafe(32) for _ in range(4)]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        with database.engine.begin() as conn:
            conn.execute(delete(s.oauth_states).where(s.oauth_states.c.expires_at <= now()))
            conn.execute(insert(s.oauth_states).values(
                state_hash=digest(state), browser_hash=digest(browser), nonce=nonce, verifier=verifier,
                user_id=account["id"] if account else None,
                session_hash=account["session"]["token_hash"] if account else None,
                expires_at=now() + 600,
            ))
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "client_id": config.google_client_id, "redirect_uri": callback_url,
            "response_type": "code", "scope": "openid email profile", "state": state,
            "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256",
            "prompt": "select_account",
        })
        response = JSONResponse({"url": url}) if link else RedirectResponse(url, status_code=303)
        response.set_cookie(browser_cookie, browser, max_age=600, secure=config.secure, httponly=True, samesite="lax", path="/")
        return response

    @router.get("/start")
    def login_start(request: Request):
        return start(request)

    @router.post("/link")
    def link_start(request: Request):
        return start(request, link=True)

    def consume_state(request, state):
        browser = request.cookies.get(browser_cookie, "")
        if not state or not browser or len(state) > 100:
            raise ValueError("Missing OAuth state")
        with database.engine.begin() as conn:
            result = conn.execute(delete(s.oauth_states).where(
                s.oauth_states.c.state_hash == digest(state),
                s.oauth_states.c.browser_hash == digest(browser),
                s.oauth_states.c.expires_at > now(),
            ).returning(*s.oauth_states.c)).mappings().first()
            if not result:
                raise ValueError("Invalid OAuth state")
            return dict(result)

    def complete_identity(request, state, claims):
        email = normalize_email(claims.get("email", ""))
        subject = claims.get("sub", "")
        if not isinstance(subject, str) or not subject or len(subject) > 255 or claims.get("email_verified") is not True:
            raise ValueError("Unverified Google identity")
        if not hmac.compare_digest(str(claims.get("nonce", "")), state["nonce"]):
            raise ValueError("Invalid nonce")
        if claims.get("azp", config.google_client_id) != config.google_client_id:
            raise ValueError("Invalid authorized party")
        with database.engine.begin() as conn:
            identity = conn.execute(select(s.identities).where(s.identities.c.provider == "google", s.identities.c.subject == subject)).mappings().first()
            if state["user_id"]:
                account = current_user(request)
                if account["id"] != state["user_id"] or account["session"]["token_hash"] != state["session_hash"]:
                    raise ValueError("Linking session changed")
                if identity and identity["user_id"] != account["id"]:
                    raise ValueError("Google identity already linked")
                user_id = account["id"]
                if not identity:
                    conn.execute(insert(s.identities).values(provider="google", subject=subject, user_id=user_id))
                database.record_audit(conn, user_id, "google.link", user_id)
            elif identity:
                user_id = identity["user_id"]
            else:
                # Matching emails never silently merge an existing local account.
                if conn.execute(select(s.users.c.id).where(s.users.c.email == email)).first():
                    raise ValueError("Local account exists; explicit link required")
                user_id = str(uuid4())
                username = "user_" + secrets.token_hex(8)
                avatar = str(claims.get("picture", ""))[:500]
                if not avatar.startswith("https://lh3.googleusercontent.com/"):
                    avatar = ""
                conn.execute(insert(s.users).values(id=user_id, username=username, email=email, email_verified=True, password_hash=None, avatar=avatar, disabled=False, created_at=now()))
                conn.execute(insert(s.identities).values(provider="google", subject=subject, user_id=user_id))
            user = conn.execute(select(s.users).where(s.users.c.id == user_id).with_for_update()).mappings().one()
            if user["disabled"]:
                raise ValueError("Disabled account")
            database.promote_verified_owner(conn, user, config.owner_email)
            return database.new_session(conn, user_id, request.cookies.get(config.cookie, ""))

    @router.get("/callback")
    async def callback(request: Request, state: str = "", code: str = "", error: str = ""):
        try:
            stored = await asyncio.to_thread(consume_state, request, state)
            if error or not code or len(code) > 4096:
                raise ValueError("Authorization declined")
            async with httpx.AsyncClient(timeout=15) as client:
                token_response = await client.post("https://oauth2.googleapis.com/token", data={
                    "grant_type": "authorization_code", "code": code, "client_id": config.google_client_id,
                    "client_secret": config.google_client_secret, "redirect_uri": callback_url,
                    "code_verifier": stored["verifier"],
                })
                token_response.raise_for_status()
                encoded = token_response.json().get("id_token", "")
            # The official verifier validates signature, expiry, audience, issuer.
            claims = await asyncio.to_thread(verify_oauth2_token, encoded, TimedGoogleRequest(), config.google_client_id)
            session_tokens = await asyncio.to_thread(complete_identity, request, stored, claims)
            response = RedirectResponse(config.origin + "/account", status_code=303)
            set_session(response, config, session_tokens)
        except (ValueError, HTTPException, httpx.HTTPError, IntegrityError, GoogleAuthError):
            response = RedirectResponse(config.origin + "/account?auth_error=google", status_code=303)
        response.delete_cookie(browser_cookie, path="/", secure=config.secure, httponly=True, samesite="lax")
        return response

    return router
