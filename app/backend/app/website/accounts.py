"""Accounts and credential changes with explicit reauthentication."""

import re
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from . import schema_v1 as s
from .database import SESSION_SECONDS, conflict, digest, now
from .mail import send_token
from .security import current_user
from .profiles import ProfileChange, update_profile
from .profile_media import authorize_media

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1)
DUMMY_HASH = hasher.hash("unrelated-constant-for-missing-account-timing")
USERNAME = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_email(value):
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL.fullmatch(value):
        raise HTTPException(422, "Введите корректный email")
    return value


def normalize_username(value):
    value = value.strip().lower()
    if not USERNAME.fullmatch(value):
        raise HTTPException(422, "Логин: 3–32 латинских буквы, цифры или подчёркивания")
    return value


def hash_password(value):
    if not 12 <= len(value) <= 128:
        raise HTTPException(422, "Пароль должен содержать от 12 до 128 символов")
    return hasher.hash(value)


def check_password(encoded, value):
    try:
        return hasher.verify(encoded or DUMMY_HASH, value) and bool(encoded)
    except (VerificationError, InvalidHashError):
        return False


def reauthenticate(conn, account, password):
    user = conn.execute(select(s.users).where(s.users.c.id == account["id"]).with_for_update()).mappings().one()
    if user["password_hash"]:
        if not check_password(user["password_hash"], password):
            raise HTTPException(403, "Текущий пароль неверен")
    elif now() - account["session"]["created_at"] > 300:
        raise HTTPException(403, "Для изменения данных выйдите и снова войдите через Google")
    return user


def set_session(response, config, tokens):
    token, csrf = tokens
    response.set_cookie(config.cookie, token, max_age=SESSION_SECONDS, secure=config.secure, httponly=True, samesite="lax", path="/")
    response.set_cookie(config.csrf_cookie, csrf, max_age=SESSION_SECONDS, secure=config.secure, httponly=False, samesite="strict", path="/")


class Registration(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128)


class Login(BaseModel):
    login: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class PasswordChange(BaseModel):
    password: str = Field(min_length=12, max_length=128)
    currentPassword: str = Field(default="", max_length=128)


class EmailChange(BaseModel):
    email: str = Field(max_length=254)
    currentPassword: str = Field(default="", max_length=128)


class EmailRequest(BaseModel):
    email: str = Field(max_length=254)


class Confirmation(BaseModel):
    token: str = Field(min_length=20, max_length=100)
    password: str | None = Field(default=None, min_length=12, max_length=128)


def account_router(database, config):
    router = APIRouter(prefix="/api/auth", tags=["Accounts"])

    def limit(request, action, maximum=5, seconds=300):
        database.rate_limit(action + ":" + (request.client.host if request.client else "unknown"), maximum, seconds)

    @router.get("/config")
    def configuration():
        return {"website": True, "google": config.google_enabled, "email": config.mail_enabled, "giphyKey": config.giphy_api_key}

    @router.get("/me")
    def me(request: Request):
        account = getattr(request.state, "account", None)
        return {"user": {k: v for k, v in account.items() if k != "session"} if account else None}

    @router.post("/register")
    def register(payload: Registration, request: Request, response: Response):
        limit(request, "register", 5, 3600)
        if not config.mail_enabled:
            raise HTTPException(503, "Регистрация по почте будет доступна после настройки SMTP")
        username, email = normalize_username(payload.username), normalize_email(payload.email)
        encoded = hash_password(payload.password)
        try:
            with database.engine.begin() as conn:
                user_id = str(uuid4())
                conn.execute(insert(s.users).values(id=user_id, username=username, email=email, password_hash=encoded, email_verified=False, avatar="", disabled=False, created_at=now()))
                token = database.issue_token(conn, user_id, "verify", email)
                session_tokens = database.new_session(conn, user_id, request.cookies.get(config.cookie, ""))
        except IntegrityError as error:
            conflict(error)
        # Commit the account first. A mail outage can be retried after login.
        set_session(response, config, session_tokens)
        try:
            send_token(config, email, token, "verify")
            delivery = True
        except HTTPException:
            delivery = False
        return {"ok": True, "verificationSent": delivery}

    @router.post("/login")
    def login(payload: Login, request: Request, response: Response):
        limit(request, "login", 15, 300)
        identifier = payload.login.strip().lower()
        database.rate_limit("login-id:" + identifier, 10, 300)
        with database.engine.begin() as conn:
            user = conn.execute(select(s.users).where((s.users.c.email == identifier) | (s.users.c.username == identifier))).mappings().first()
            if not check_password(user["password_hash"] if user else None, payload.password) or user["disabled"]:
                raise HTTPException(401, "Неверный логин или пароль")
            if hasher.check_needs_rehash(user["password_hash"]):
                conn.execute(update(s.users).where(s.users.c.id == user["id"]).values(password_hash=hasher.hash(payload.password)))
            database.promote_verified_owner(conn, user, config.owner_email)
            session_tokens = database.new_session(conn, user["id"], request.cookies.get(config.cookie, ""))
        set_session(response, config, session_tokens)
        return {"ok": True}

    @router.post("/logout")
    def logout(request: Request, response: Response):
        account = current_user(request)
        with database.engine.begin() as conn:
            conn.execute(delete(s.sessions).where(s.sessions.c.token_hash == account["session"]["token_hash"]))
        response.delete_cookie(config.cookie, path="/", secure=config.secure, httponly=True, samesite="lax")
        response.delete_cookie(config.csrf_cookie, path="/", secure=config.secure, samesite="strict")
        return {"ok": True}

    @router.patch("/profile")
    def profile(payload: ProfileChange, request: Request):
        account = current_user(request)
        changes = payload.model_dump(exclude_none=True)
        if not changes:
            raise HTTPException(422, "Нет изменений профиля")
        username = normalize_username(changes.pop("username")) if "username" in changes else None
        if "visibility" in changes:
            changes["visibility"] = payload.visibility.model_dump(exclude_none=True)
        try:
            with database.engine.begin() as conn:
                conn.execute(select(s.users.c.id).where(s.users.c.id == account["id"]).with_for_update()).one()
                authorize_media(conn, account["id"], changes)
                if username is not None:
                    conn.execute(update(s.users).where(s.users.c.id == account["id"]).values(username=username))
                    database.record_audit(conn, account["id"], "profile.username", account["id"])
                if changes:
                    update_profile(conn, database, account["id"], changes)
        except IntegrityError as error:
            conflict(error)
        return {"ok": True}

    @router.post("/password")
    def password(payload: PasswordChange, request: Request, response: Response):
        account = current_user(request)
        limit(request, "credential-change")
        encoded = hash_password(payload.password)
        with database.engine.begin() as conn:
            reauthenticate(conn, account, payload.currentPassword)
            conn.execute(update(s.users).where(s.users.c.id == account["id"]).values(password_hash=encoded))
            conn.execute(delete(s.sessions).where(s.sessions.c.user_id == account["id"]))
            conn.execute(delete(s.tokens).where(s.tokens.c.user_id == account["id"]))
            session_tokens = database.new_session(conn, account["id"])
            database.record_audit(conn, account["id"], "credential.password", account["id"])
        set_session(response, config, session_tokens)
        return {"ok": True}

    @router.post("/email")
    def email(payload: EmailChange, request: Request):
        account = current_user(request)
        limit(request, "credential-change")
        target = normalize_email(payload.email)
        if not config.mail_enabled:
            raise HTTPException(503, "Почтовая отправка ещё не настроена")
        with database.engine.begin() as conn:
            reauthenticate(conn, account, payload.currentPassword)
            if conn.execute(select(s.users.c.id).where(s.users.c.email == target)).first():
                raise HTTPException(409, "Эта почта уже используется")
            token = database.issue_token(conn, account["id"], "email", target)
        send_token(config, target, token, "email")
        return {"ok": True}

    @router.post("/verification")
    def verification(request: Request):
        account = current_user(request)
        limit(request, "mail")
        if not config.mail_enabled:
            raise HTTPException(503, "Почтовая отправка ещё не настроена")
        with database.engine.begin() as conn:
            token = database.issue_token(conn, account["id"], "verify", account["email"])
        send_token(config, account["email"], token, "verify")
        return {"ok": True}

    @router.post("/reset")
    def reset(payload: EmailRequest, request: Request, background: BackgroundTasks):
        limit(request, "mail")
        email = normalize_email(payload.email)
        if not config.mail_enabled:
            raise HTTPException(503, "Почтовая отправка ещё не настроена")
        with database.engine.begin() as conn:
            user = conn.execute(select(s.users).where(s.users.c.email == email, s.users.c.disabled.is_(False))).mappings().first()
            token = database.issue_token(conn, user["id"], "reset", email) if user else None
        if token:
            def deliver():
                try:
                    send_token(config, email, token, "reset")
                except HTTPException:
                    pass  # Never expose account existence through delivery errors.
            background.add_task(deliver)
        return {"ok": True, "message": "Если аккаунт существует, письмо отправлено"}

    @router.post("/confirm")
    def confirm(payload: Confirmation, request: Request, response: Response):
        limit(request, "confirm", 15)
        encoded = hash_password(payload.password) if payload.password is not None else None
        try:
            with database.engine.begin() as conn:
                # DELETE RETURNING atomically consumes tokens even across workers.
                token = conn.execute(delete(s.tokens).where(s.tokens.c.token_hash == digest(payload.token), s.tokens.c.expires_at > now()).returning(*s.tokens.c)).mappings().first()
                if not token:
                    raise HTTPException(400, "Ссылка истекла или уже использована")
                user = conn.execute(select(s.users).where(s.users.c.id == token["user_id"]).with_for_update()).mappings().one()
                if user["disabled"]:
                    raise HTTPException(403, "Аккаунт отключён")
                if token["purpose"] == "reset":
                    if not encoded or token["email"] != user["email"]:
                        raise HTTPException(422, "Нужен новый пароль")
                    conn.execute(update(s.users).where(s.users.c.id == user["id"]).values(password_hash=encoded, email_verified=True))
                elif token["purpose"] in {"verify", "email"}:
                    if token["purpose"] == "verify" and token["email"] != user["email"]:
                        raise HTTPException(400, "Ссылка больше не актуальна")
                    conn.execute(update(s.users).where(s.users.c.id == user["id"]).values(email=token["email"], email_verified=True))
                else:
                    raise HTTPException(400, "Неверная ссылка")
                conn.execute(delete(s.sessions).where(s.sessions.c.user_id == user["id"]))
                conn.execute(delete(s.tokens).where(s.tokens.c.user_id == user["id"]))
                updated_user = {**user, "email": token["email"], "email_verified": True}
                database.promote_verified_owner(conn, updated_user, config.owner_email)
                database.record_audit(conn, user["id"], "credential." + token["purpose"], user["id"])
                # Email changes require an existing session or a fresh login. A
                # link sent to the new address must not log its recipient in.
                if token["purpose"] == "email":
                    session_tokens = None
                else:
                    session_tokens = database.new_session(conn, user["id"], request.cookies.get(config.cookie, ""))
        except IntegrityError as error:
            conflict(error)
        if session_tokens:
            set_session(response, config, session_tokens)
        else:
            response.delete_cookie(config.cookie, path="/", secure=config.secure, httponly=True, samesite="lax")
            response.delete_cookie(config.csrf_cookie, path="/", secure=config.secure, samesite="strict")
        return {"ok": True}

    return router
