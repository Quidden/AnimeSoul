"""Owner and public projections. Private save data never leaves this boundary."""

import base64
import binascii
import math
import re
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update

from . import schema_v1 as s
from .database import now
from .profile_schema import user_profiles
from .profile_media import PRESETS, PRESET_KINDS, can_customize
from .security import current_user

DEFAULT_VISIBILITY = {"about": True, "favorites": False, "collections": False, "ratings": False, "statistics": False}
PRESENCE_TTL = 180
MEDIA_BYTES = 1024 * 1024


class ProfileVisibility(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    about: bool | None = None
    favorites: bool | None = None
    collections: bool | None = None
    ratings: bool | None = None
    statistics: bool | None = None


def validate_media(value):
    if value is None:
        return value
    value = value.strip()
    if not value:
        return ""
    if value in PRESET_KINDS or re.fullmatch(r"giphy:[a-zA-Z0-9]{1,100}", value):
        return value
    if value.startswith("data:"):
        header, separator, encoded = value.partition(",")
        formats = {"data:image/png;base64": b"\x89PNG\r\n\x1a\n", "data:image/jpeg;base64": b"\xff\xd8\xff",
                   "data:image/gif;base64": b"GIF8", "data:image/webp;base64": b"RIFF"}
        if not separator or header not in formats:
            raise ValueError("Поддерживаются PNG, JPEG, GIF и WebP")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError("Некорректное изображение") from error
        if len(content) > MEDIA_BYTES or not content.startswith(formats[header]):
            raise ValueError("Некорректное изображение или размер больше 1 МБ")
        if header == "data:image/webp;base64" and content[8:12] != b"WEBP":
            raise ValueError("Некорректный WebP")
        return value
    parsed = urlsplit(value)
    if len(value) > 500 or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Укажите прямую HTTPS-ссылку на изображение")
    return value


class ProfileChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str | None = Field(default=None, min_length=3, max_length=32)
    avatar: str | None = Field(default=None, max_length=1_400_000)
    banner: str | None = Field(default=None, max_length=1_400_000)
    about: str | None = Field(default=None, max_length=600)
    presence: Literal["online", "offline", "dnd", "invisible"] | None = None
    visibility: ProfileVisibility | None = None

    @field_validator("avatar", "banner")
    @classmethod
    def media(cls, value):
        return validate_media(value)


def preferences(conn, user_id):
    row = conn.execute(select(user_profiles).where(user_profiles.c.user_id == user_id)).mappings().first()
    return {"avatar": None, "banner": "", "about": "", "presence": "online", "last_seen_at": 0,
            **(dict(row) if row else {}), "visibility": {**DEFAULT_VISIBILITY, **(row["visibility"] if row else {})}}


def update_profile(conn, database, user_id, changes):
    values = preferences(conn, user_id)
    if "visibility" in changes:
        values["visibility"] = {**values["visibility"], **changes.pop("visibility")}
    values.update(changes)
    values["last_seen_at"] = now()
    values.pop("user_id", None)
    database.upsert_ignore(conn, user_profiles, {"user_id": user_id, **values})
    conn.execute(update(user_profiles).where(user_profiles.c.user_id == user_id).values(**values))


def badges(conn, user_id):
    roles = conn.execute(select(s.roles.c.id, s.roles.c.name, s.roles.c.protected).join(
        s.user_roles, s.roles.c.id == s.user_roles.c.role_id,
    ).where(s.user_roles.c.user_id == user_id).order_by(s.roles.c.name)).mappings().all()
    admin = conn.execute(select(s.role_permissions.c.permission).join(
        s.user_roles, s.user_roles.c.role_id == s.role_permissions.c.role_id,
    ).where(s.user_roles.c.user_id == user_id, s.role_permissions.c.permission.like("admin.%"))).first()
    result = [{"id": "admin", "name": "Админ", "kind": "admin"}] if admin else []
    for role in roles:
        if role["id"] == "owner":
            continue
        if "premium" in role["id"].lower() or any(word in role["name"].lower() for word in ("премиум", "premium")):
            result.append({"id": role["id"], "name": role["name"], "kind": "premium"})
        elif not role["protected"]:
            result.append({"id": role["id"], "name": role["name"], "kind": "unique"})
    return result or [{"id": "member", "name": "Участник", "kind": "member"}]


def active_snapshot(conn, user_id):
    envelope = conn.execute(select(s.save_envelopes.c.payload).where(s.save_envelopes.c.user_id == user_id)).scalar()
    if not envelope:
        return {}
    row = conn.execute(select(s.profiles).where(s.profiles.c.user_id == user_id,
        s.profiles.c.id == envelope.get("activeProfile", "default"))).mappings().first()
    if not row:
        return {}
    snapshot = dict(row["snapshot"])
    items = conn.execute(select(s.save_items).where(s.save_items.c.user_id == user_id,
        s.save_items.c.profile_id == row["id"]).order_by(s.save_items.c.position)).mappings().all()
    for item in items:
        kind = item["kind"]
        if kind in {"favorites", "folders"}:
            snapshot.setdefault(kind, []).append(item["payload"])
        elif kind in {"ratings", "progress"}:
            snapshot.setdefault(kind, {})[item["key"]] = item["payload"]
    return snapshot


def number(value):
    return max(0, value) if type(value) in (int, float) and math.isfinite(value) else 0


def statistics(snapshot):
    titles = episodes = 0
    seconds = 0
    for progress in snapshot.get("progress", {}).values():
        if not isinstance(progress, dict):
            continue
        completed = 0
        for state in progress.get("episodes", {}).values():
            if not isinstance(state, dict):
                continue
            watched = bool(state.get("completed")) or state.get("percent") == 100
            completed += int(watched)
            episodes += int(number(state.get("completions"))) if state.get("completions") is not None else int(watched)
            seconds += number(state.get("watchedSeconds")) if state.get("watchedSeconds") is not None else min(number(state.get("position")), number(state.get("duration")) or number(state.get("position")))
        if completed and completed >= (number(progress.get("totalEpisodes")) or 1):
            titles += 1
    return {"titles": titles, "episodes": episodes, "watchSeconds": int(seconds)}


def profile_projection(database, user_id, owner=False):
    with database.engine.connect() as conn:
        user = conn.execute(select(s.users).where(s.users.c.id == user_id, s.users.c.disabled.is_(False))).mappings().first()
        if not user:
            raise HTTPException(404, "Пользователь не найден")
        settings = preferences(conn, user_id)
        visible = settings["visibility"]
        snapshot = active_snapshot(conn, user_id)
        sections = {}
        if owner or visible["favorites"]:
            sections["favorites"] = [value for value in snapshot.get("favorites", []) if type(value) is int and value > 0]
        if owner or visible["collections"]:
            sections["collections"] = [{"id": folder["id"], "name": folder["name"],
                "animeIds": [value for value in folder.get("animeIds", []) if type(value) is int and value > 0]}
                for folder in snapshot.get("folders", []) if isinstance(folder, dict) and "id" in folder and "name" in folder]
        if owner or visible["ratings"]:
            sections["ratings"] = sorted([{"animeId": int(key), "score": rating["anime"], "title": str(rating.get("title", ""))[:300]}
                for key, rating in snapshot.get("ratings", {}).items() if str(key).isdigit() and isinstance(rating, dict)
                and type(rating.get("anime")) in (int, float) and 1 <= rating["anime"] <= 10],
                key=lambda rating: (-rating["score"], rating["animeId"]))
        if owner or visible["statistics"]:
            sections["statistics"] = statistics(snapshot)
        presence = settings["presence"]
        if not owner and (presence == "invisible" or settings["last_seen_at"] < now() - PRESENCE_TTL):
            presence = "offline"
        return {"id": user["id"], "username": user["username"],
                "avatar": settings["avatar"] if settings["avatar"] is not None else user["avatar"],
                "banner": settings["banner"], "about": settings["about"] if owner or visible["about"] else None,
                "presence": presence, "badges": badges(conn, user_id), "joinedAt": user["created_at"],
                "owner": owner, "sections": sections, **({"visibility": visible} if owner else {})}


def profiles_router(database):
    router = APIRouter(prefix="/api/profiles", tags=["Profiles"])

    @router.get("/me")
    def mine(request: Request):
        return profile_projection(database, current_user(request)["id"], owner=True)

    @router.post("/presence")
    def heartbeat(request: Request):
        account = current_user(request)
        with database.engine.begin() as conn:
            database.upsert_ignore(conn, user_profiles, {"user_id": account["id"], "last_seen_at": now()})
            conn.execute(update(user_profiles).where(user_profiles.c.user_id == account["id"]).values(last_seen_at=now()))
        return {"ok": True}

    @router.get("/media-options")
    def media_options(request: Request):
        account = current_user(request)
        with database.engine.connect() as conn:
            allowed = can_customize(conn, account["id"])
        return {"presets": PRESETS, "canCustomize": allowed,
                "giphyEnabled": bool(request.app.state.website_config.giphy_api_key)}

    @router.get("/{user_id}")
    def public(user_id: str):
        if len(user_id) > 36:
            raise HTTPException(404, "Пользователь не найден")
        return profile_projection(database, user_id)

    return router
