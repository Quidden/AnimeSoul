"""Register the isolated website runtime on the existing FastAPI application."""

import json

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from ..services.storage import validate_storage_document
from .accounts import account_router
from .admin import admin_router
from .config import load_website_settings
from .database import Database
from .google import google_router
from .profiles import profiles_router
from .security import WebsiteSecurityMiddleware, current_user, trusted_hosts


def install_website(app):
    config = load_website_settings()
    config.validate()
    database = Database(config.database_url)
    app.state.website_database = database
    app.state.website_config = config
    app.add_middleware(WebsiteSecurityMiddleware, database=database, config=config)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_hosts(config.origin))
    app.include_router(account_router(database, config))
    app.include_router(google_router(database, config))
    app.include_router(admin_router(database))
    app.include_router(profiles_router(database))
    router = APIRouter(tags=["Account saves"])

    @router.get("/api/storage")
    def read(request: Request):
        return database.read_save(current_user(request)["id"])

    @router.put("/api/storage")
    def write(document: dict, request: Request):
        account = current_user(request)
        database.rate_limit("save:" + account["id"], 120, 60)
        if not validate_storage_document(document):
            raise HTTPException(422, "Некорректный сейв")
        try:
            json.dumps(document, allow_nan=False)
        except (ValueError, OverflowError, RecursionError) as error:
            raise HTTPException(422, "Некорректные значения в сейве") from error
        revision = database.write_save(account["id"], document)
        return {"saved": True, "serverRevision": revision, "cloud_sync_scheduled": False}

    app.include_router(router)


def start_website(app):
    database = app.state.website_database
    with database.engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if version != "0002_user_profiles":
            raise RuntimeError("Run website database migrations before starting the server")
    database.seed_roles()
