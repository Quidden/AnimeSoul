"""Transactional account, authorization and per-account save persistence."""

from copy import deepcopy
import hashlib
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, delete, event, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

from . import schema_v1 as s
from .profile_schema import user_profiles

PERMISSIONS = {
    "player.use": "Доступ к плееру AnimeSoul",
    "downloads.use": "Скачивание аниме",
    "profile.customize": "Премиум: свои аватарки, шапки и поиск GIF",
    "admin.users": "Назначение ролей пользователям",
    "admin.roles": "Создание и настройка ролей",
}
OWNER_ROLE = "owner"
PLAYER_ROLE = "player"
SESSION_SECONDS = 7 * 24 * 3600
LIST_FIELDS = {"favorites", "folders", "tracked"}
MAP_FIELDS = {"progress", "ratings"}


def now() -> int:
    return int(time.time())


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class Database:
    def __init__(self, url: str):
        options = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            options["connect_args"] = {"check_same_thread": False}
            if ":memory:" in url:
                options["poolclass"] = StaticPool
        self.engine = create_engine(url, **options)
        if self.engine.dialect.name == "sqlite":
            @event.listens_for(self.engine, "connect")
            def enable_foreign_keys(connection, _record):
                connection.execute("PRAGMA foreign_keys=ON")

    def seed_roles(self):
        # Insert-if-absent is safe when multiple workers start simultaneously.
        with self.engine.begin() as conn:
            for role_id, name, permissions in [
                (OWNER_ROLE, "Владелец", list(PERMISSIONS)),
                (PLAYER_ROLE, "Доступ к плееру", ["player.use"]),
                ("downloads", "Доступ к скачиванию", ["downloads.use"]),
                ("premium", "Премиум", ["profile.customize"]),
            ]:
                self.upsert_ignore(conn, s.roles, {"id": role_id, "name": name, "protected": True})
                for permission in permissions:
                    self.upsert_ignore(conn, s.role_permissions, {"role_id": role_id, "permission": permission})

    def upsert_ignore(self, conn, table, values):
        if self.engine.dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as dialect_insert
        else:
            from sqlalchemy.dialects.sqlite import insert as dialect_insert
        conn.execute(dialect_insert(table).values(**values).on_conflict_do_nothing())

    def rate_limit(self, key: str, maximum: int, seconds: int):
        timestamp = now()
        if self.engine.dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as dialect_insert
        else:
            from sqlalchemy.dialects.sqlite import insert as dialect_insert
        statement = dialect_insert(s.limits).values(
            key=digest(key), window=timestamp // seconds, hits=1, expires_at=timestamp + seconds * 2,
        ).on_conflict_do_update(
            index_elements=[s.limits.c.key, s.limits.c.window],
            set_={"hits": s.limits.c.hits + 1},
            where=s.limits.c.hits < maximum,
        ).returning(s.limits.c.hits)
        with self.engine.begin() as conn:
            result = conn.execute(statement).first()
            conn.execute(delete(s.limits).where(s.limits.c.expires_at < timestamp))
        if not result:
            raise HTTPException(429, "Слишком много запросов. Попробуйте позже.", headers={"Retry-After": str(seconds)})

    def public_user(self, conn, user):
        assigned = conn.execute(select(s.roles.c.id, s.roles.c.name).join(
            s.user_roles, s.roles.c.id == s.user_roles.c.role_id,
        ).where(s.user_roles.c.user_id == user["id"])).mappings().all()
        permissions = conn.execute(select(s.role_permissions.c.permission).join(
            s.user_roles, s.user_roles.c.role_id == s.role_permissions.c.role_id,
        ).where(s.user_roles.c.user_id == user["id"])).scalars().all()
        linked = conn.execute(select(s.identities.c.subject).where(
            s.identities.c.user_id == user["id"], s.identities.c.provider == "google",
        )).first()
        profile = conn.execute(select(user_profiles.c.avatar, user_profiles.c.presence).where(user_profiles.c.user_id == user["id"])).mappings().first()
        return {
            "id": user["id"], "username": user["username"], "email": user["email"],
            "emailVerified": user["email_verified"], "avatar": profile["avatar"] if profile and profile["avatar"] is not None else user["avatar"],
            "presence": profile["presence"] if profile else "online",
            "hasPassword": bool(user["password_hash"]), "googleLinked": bool(linked),
            "roles": [dict(role) for role in assigned], "permissions": sorted(set(permissions)),
        }

    def authenticate(self, raw_token: str):
        if not raw_token or len(raw_token) > 100:
            return None
        with self.engine.connect() as conn:
            session = conn.execute(select(s.sessions).where(
                s.sessions.c.token_hash == digest(raw_token), s.sessions.c.expires_at > now(),
            )).mappings().first()
            if not session:
                return None
            user = conn.execute(select(s.users).where(s.users.c.id == session["user_id"])).mappings().first()
            if not user or user["disabled"]:
                return None
            return {**self.public_user(conn, user), "session": dict(session)}

    def new_session(self, conn, user_id: str, old_token: str = ""):
        raw_token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        conn.execute(delete(s.sessions).where(s.sessions.c.expires_at <= now()))
        if old_token:
            conn.execute(delete(s.sessions).where(s.sessions.c.token_hash == digest(old_token)))
        conn.execute(insert(s.sessions).values(
            token_hash=digest(raw_token), user_id=user_id, csrf_hash=digest(csrf),
            created_at=now(), expires_at=now() + SESSION_SECONDS,
        ))
        return raw_token, csrf

    def promote_verified_owner(self, conn, user, owner_email):
        if owner_email and user["email_verified"] and user["email"] == owner_email:
            # Lock the protected role so bootstrap is one-time across workers.
            conn.execute(select(s.roles).where(s.roles.c.id == OWNER_ROLE).with_for_update()).first()
            existing = conn.execute(select(s.user_roles.c.user_id).where(s.user_roles.c.role_id == OWNER_ROLE)).first()
            if not existing:
                self.upsert_ignore(conn, s.user_roles, {"user_id": user["id"], "role_id": OWNER_ROLE})
                self.record_audit(conn, user["id"], "owner.bootstrap", user["id"])

    def record_audit(self, conn, actor: str, action: str, target: str):
        conn.execute(insert(s.audit).values(id=str(uuid4()), actor_id=actor, action=action, target_id=target, created_at=now()))

    def issue_token(self, conn, user_id: str, purpose: str, email: str):
        raw = secrets.token_urlsafe(32)
        conn.execute(delete(s.tokens).where(s.tokens.c.expires_at <= now()))
        conn.execute(delete(s.tokens).where(s.tokens.c.user_id == user_id, s.tokens.c.purpose == purpose))
        conn.execute(insert(s.tokens).values(
            token_hash=digest(raw), user_id=user_id, purpose=purpose, email=email,
            expires_at=now() + (1800 if purpose == "reset" else 3600),
        ))
        return raw

    def read_save(self, user_id: str):
        with self.engine.begin() as conn:
            conn.execute(select(s.users.c.id).where(s.users.c.id == user_id).with_for_update()).one()
            envelope = conn.execute(select(s.save_envelopes).where(
                s.save_envelopes.c.user_id == user_id,
            ).with_for_update()).mappings().first()
            if not envelope:
                # New accounts never import a previous user's browser backup.
                document = {"schemaVersion": 3, "activeProfile": "default", "profiles": [
                    {"id": "default", "name": "Основной", "snapshot": {}},
                ]}
                self.upsert_ignore(conn, s.save_envelopes, {"user_id": user_id, "revision": 0, "payload": {k: v for k, v in document.items() if k != "profiles"}})
                self.upsert_ignore(conn, s.profiles, {"user_id": user_id, "id": "default", "position": 0, "payload": {"id": "default", "name": "Основной"}, "snapshot": {}})
                envelope = conn.execute(select(s.save_envelopes).where(s.save_envelopes.c.user_id == user_id).with_for_update()).mappings().one()
            result = deepcopy(envelope["payload"])
            result["profiles"] = []
            rows = conn.execute(select(s.profiles).where(s.profiles.c.user_id == user_id).order_by(s.profiles.c.position)).mappings().all()
            items = conn.execute(select(s.save_items).where(s.save_items.c.user_id == user_id).order_by(s.save_items.c.position)).mappings().all()
            for row in rows:
                profile = {**deepcopy(row["payload"]), "snapshot": deepcopy(row["snapshot"])}
                for item in items:
                    if item["profile_id"] != row["id"]:
                        continue
                    kind = item["kind"]
                    if kind in LIST_FIELDS:
                        profile["snapshot"].setdefault(kind, []).append(item["payload"])
                    else:
                        profile["snapshot"].setdefault(kind, {})[item["key"]] = item["payload"]
                result["profiles"].append(profile)
            result["serverRevision"] = envelope["revision"]
            return result

    def write_save(self, user_id: str, document: dict):
        document = deepcopy(document)
        expected = document.pop("serverRevision", None)
        profile_list = document.pop("profiles")
        ids = [p["id"] for p in profile_list]
        if len(ids) != len(set(ids)) or len(ids) > 30 or any(len(p) > 128 for p in ids):
            raise HTTPException(422, "Некорректные профили")
        with self.engine.begin() as conn:
            envelope = conn.execute(select(s.save_envelopes).where(s.save_envelopes.c.user_id == user_id).with_for_update()).mappings().first()
            if not envelope or type(expected) is not int or expected != envelope["revision"]:
                raise HTTPException(409, "Сейв изменён в другой вкладке. Перезагрузите страницу перед сохранением.")
            revision = expected + 1
            conn.execute(delete(s.save_items).where(s.save_items.c.user_id == user_id))
            conn.execute(delete(s.profiles).where(s.profiles.c.user_id == user_id))
            for position, profile in enumerate(profile_list):
                snapshot = profile.pop("snapshot")
                item_rows = []
                for kind in LIST_FIELDS | MAP_FIELDS:
                    value = snapshot.pop(kind, None)
                    if value is None:
                        continue
                    if kind in LIST_FIELDS and isinstance(value, list):
                        snapshot[kind] = []
                        pairs = [(str(index), payload) for index, payload in enumerate(value)]
                    elif kind in MAP_FIELDS and isinstance(value, dict):
                        snapshot[kind] = {}
                        pairs = list(value.items())
                    else:
                        raise HTTPException(422, f"Некорректное поле {kind}")
                    for index, (key, payload) in enumerate(pairs):
                        if len(str(key)) > 255:
                            raise HTTPException(422, "Слишком длинный ключ сейва")
                        item_rows.append({"user_id": user_id, "profile_id": profile["id"], "kind": kind, "key": str(key), "position": index, "payload": payload})
                conn.execute(insert(s.profiles).values(user_id=user_id, id=profile["id"], position=position, payload=profile, snapshot=snapshot))
                if item_rows:
                    conn.execute(insert(s.save_items), item_rows)
            result = conn.execute(update(s.save_envelopes).where(
                s.save_envelopes.c.user_id == user_id, s.save_envelopes.c.revision == expected,
            ).values(payload=document, revision=revision))
            if result.rowcount != 1:
                raise HTTPException(409, "Сейв уже изменён. Перезагрузите страницу.")
            return revision


def conflict(error: IntegrityError):
    # Never expose SQL, constraint names or other users' email addresses.
    raise HTTPException(409, "Логин или почта уже используются") from error
