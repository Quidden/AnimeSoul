"""Role administration; ownership is reserved for the trusted bootstrap flow."""

from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from . import schema_v1 as s
from .database import OWNER_ROLE, PERMISSIONS
from .security import require_permission


class RoleChange(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    permissions: list[str] = Field(max_length=20)


class AssignRoles(BaseModel):
    roles: list[str] = Field(max_length=30)


def admin_router(database):
    router = APIRouter(prefix="/api/admin", tags=["Administration"])

    def owner(account):
        return any(role["id"] == OWNER_ROLE for role in account["roles"])

    def role_dict(conn, role):
        return {**role, "permissions": conn.execute(select(s.role_permissions.c.permission).where(s.role_permissions.c.role_id == role["id"])).scalars().all()}

    @router.get("/roles")
    def list_roles(request: Request):
        account = getattr(request.state, "account", None)
        if not account or not account["emailVerified"] or not {"admin.roles", "admin.users"}.intersection(account["permissions"]):
            raise HTTPException(403, "Нет доступа к управлению ролями")
        with database.engine.connect() as conn:
            return {"roles": [role_dict(conn, dict(role)) for role in conn.execute(select(s.roles).order_by(s.roles.c.name)).mappings()], "permissions": PERMISSIONS}

    def validate_permissions(account, permissions):
        if not set(permissions).issubset(PERMISSIONS):
            raise HTTPException(422, "Неизвестное разрешение")
        if not owner(account) and (not set(permissions).issubset(account["permissions"]) or any(p.startswith("admin.") for p in permissions)):
            raise HTTPException(403, "Только владелец выдаёт права управления сайтом")

    @router.post("/roles")
    def create_role(payload: RoleChange, request: Request):
        account = require_permission(request, "admin.roles")
        validate_permissions(account, payload.permissions)
        role_id = str(uuid4())
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(422, "Введите название роли")
        try:
            with database.engine.begin() as conn:
                conn.execute(insert(s.roles).values(id=role_id, name=name, protected=False))
                for permission in set(payload.permissions):
                    conn.execute(insert(s.role_permissions).values(role_id=role_id, permission=permission))
                database.record_audit(conn, account["id"], "role.create", role_id)
        except IntegrityError as error:
            raise HTTPException(409, "Роль с таким названием уже существует") from error
        return {"ok": True, "id": role_id}

    @router.put("/roles/{role_id}")
    def change_role(role_id: str, payload: RoleChange, request: Request):
        account = require_permission(request, "admin.roles")
        validate_permissions(account, payload.permissions)
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(422, "Введите название роли")
        try:
            with database.engine.begin() as conn:
                role = conn.execute(select(s.roles).where(s.roles.c.id == role_id).with_for_update()).mappings().first()
                if not role:
                    raise HTTPException(404, "Роль не найдена")
                existing = role_dict(conn, dict(role))["permissions"]
                if role["protected"] or (not owner(account) and any(p.startswith("admin.") for p in existing)):
                    raise HTTPException(403, "Эту роль нельзя изменить")
                conn.execute(update(s.roles).where(s.roles.c.id == role_id).values(name=name))
                conn.execute(delete(s.role_permissions).where(s.role_permissions.c.role_id == role_id))
                for permission in set(payload.permissions):
                    conn.execute(insert(s.role_permissions).values(role_id=role_id, permission=permission))
                database.record_audit(conn, account["id"], "role.update", role_id)
        except IntegrityError as error:
            raise HTTPException(409, "Роль с таким названием уже существует") from error
        return {"ok": True}

    @router.get("/users")
    def list_users(request: Request, q: str = Query(default="", max_length=100), offset: int = Query(default=0, ge=0)):
        require_permission(request, "admin.users")
        with database.engine.connect() as conn:
            query = select(s.users).order_by(s.users.c.created_at, s.users.c.id)
            if q.strip():
                pattern = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                query = query.where(s.users.c.username.like(pattern, escape="\\") | s.users.c.email.like(pattern, escape="\\"))
            rows = conn.execute(query.offset(offset).limit(51)).mappings().all()
            return {"users": [database.public_user(conn, user) for user in rows[:50]], "hasMore": len(rows) > 50}

    @router.put("/users/{user_id}/roles")
    def assign_roles(user_id: str, payload: AssignRoles, request: Request):
        account = require_permission(request, "admin.users")
        requested = set(payload.roles)
        with database.engine.begin() as conn:
            user = conn.execute(select(s.users).where(s.users.c.id == user_id).with_for_update()).mappings().first()
            if not user:
                raise HTTPException(404, "Пользователь не найден")
            previous = set(conn.execute(select(s.user_roles.c.role_id).where(s.user_roles.c.user_id == user_id)).scalars())
            if (OWNER_ROLE in previous) != (OWNER_ROLE in requested):
                raise HTTPException(403, "Права владельца нельзя менять через сайт")
            if user_id == account["id"] and not owner(account):
                raise HTTPException(403, "Нельзя менять собственные права")
            if not owner(account) and OWNER_ROLE in previous:
                raise HTTPException(403, "Нельзя менять роли владельца")
            known = set(conn.execute(select(s.roles.c.id).where(s.roles.c.id.in_(requested))).scalars())
            if requested != known:
                raise HTTPException(422, "Роль не найдена")
            if not owner(account):
                changed = previous.symmetric_difference(requested)
                permissions = set(conn.execute(select(s.role_permissions.c.permission).where(s.role_permissions.c.role_id.in_(changed))).scalars())
                validate_permissions(account, permissions)
            conn.execute(delete(s.user_roles).where(s.user_roles.c.user_id == user_id))
            for role_id in requested:
                conn.execute(insert(s.user_roles).values(user_id=user_id, role_id=role_id))
            database.record_audit(conn, account["id"], "user.roles", user_id)
        return {"ok": True}

    @router.get("/audit")
    def audit_log(request: Request):
        require_permission(request, "admin.users")
        with database.engine.connect() as conn:
            return {"events": [dict(row) for row in conn.execute(select(s.audit).order_by(s.audit.c.created_at.desc()).limit(100)).mappings()]}

    return router
