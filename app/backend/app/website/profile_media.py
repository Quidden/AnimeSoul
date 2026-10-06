"""First-party presets and an explicit entitlement for custom profile media."""

from fastapi import HTTPException
from sqlalchemy import select

from . import schema_v1 as s

CUSTOM_MEDIA_PERMISSION = "profile.customize"
PRESETS = [
    {"id": "avatar-moon", "kind": "avatar", "name": "Луна", "animated": False},
    {"id": "avatar-kitsune", "kind": "avatar", "name": "Кицунэ", "animated": False},
    {"id": "avatar-cat", "kind": "avatar", "name": "Звёздный кот", "animated": False},
    {"id": "avatar-orbit", "kind": "avatar", "name": "Орбита", "animated": True},
    {"id": "banner-night", "kind": "banner", "name": "Лунная ночь", "animated": False},
    {"id": "banner-dawn", "kind": "banner", "name": "Рассвет", "animated": False},
    {"id": "banner-stars", "kind": "banner", "name": "Звёздный дождь", "animated": True},
    {"id": "banner-sakura", "kind": "banner", "name": "Лепестки сакуры", "animated": True},
]
for preset in PRESETS:
    preset.setdefault("url", f"/profile-presets/{preset['id']}.svg")
PRESET_KINDS = {preset["url"]: preset["kind"] for preset in PRESETS}


def can_customize(conn, user_id):
    permissions = set(conn.execute(select(s.role_permissions.c.permission).join(
        s.user_roles, s.user_roles.c.role_id == s.role_permissions.c.role_id,
    ).where(s.user_roles.c.user_id == user_id)).scalars())
    return CUSTOM_MEDIA_PERMISSION in permissions or any(value.startswith("admin.") for value in permissions)


def authorize_media(conn, user_id, changes):
    allowed = can_customize(conn, user_id)
    for kind in ("avatar", "banner"):
        value = changes.get(kind)
        if not value:
            continue
        if value in PRESET_KINDS:
            if PRESET_KINDS[value] != kind:
                raise HTTPException(422, "Выберите готовый вариант для этого поля")
        elif not allowed:
            raise HTTPException(403, "Свои изображения и поиск GIF доступны с премиумом. Выберите готовый вариант.")
