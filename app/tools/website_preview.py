"""Disposable loopback preview; email and OAuth are always disabled.

Run from app: python -m tools.website_preview. Test login: preview / preview
password printed below. This preview never reads or imports the desktop save.
Add --profile-demo for a populated profile with abstract poster placeholders.
Add --live-catalog --provider-env deploy/.env for real catalogue and playback.
Provider requests are disabled by default. Deployment database/auth settings
are never imported from the provider env file.
"""

import argparse
import asyncio
import os
from contextlib import asynccontextmanager, closing
import sqlite3
from pathlib import Path
import tempfile
from uuid import uuid4


PROVIDER_ENV_KEYS = frozenset({
    "YUMMYANIME_TOKEN", "ANIMESOUL_KODIK_PUBLIC_KEY", "ANIMESOUL_KODIK_PRIVATE_KEY",
})


def load_provider_env(path: Path) -> None:
    """Import only source credentials, retaining explicit shell overrides."""
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key not in PROVIDER_ENV_KEYS:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-demo", action="store_true")
    parser.add_argument("--restore-preview", type=Path)
    parser.add_argument("--live-catalog", action="store_true")
    parser.add_argument("--provider-env", type=Path)
    args = parser.parse_args()
    if args.provider_env and not args.live_catalog:
        parser.error("--provider-env requires --live-catalog")
    if args.provider_env:
        if not args.provider_env.is_file():
            parser.error("Provider env file does not exist")
        load_provider_env(args.provider_env)
    with tempfile.TemporaryDirectory(prefix="animesoul-website-preview-") as temporary:
        origin = "http://localhost:8013"
        restore = args.restore_preview
        preview_database = Path(temporary) / "preview.db"
        if restore:
            source = restore.resolve()
            with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as saved, closing(sqlite3.connect(preview_database)) as destination:
                saved.backup(destination)
        os.environ.update({
            "ANIMESOUL_RUNTIME": "website", "ANIMESOUL_WEBSITE_DEVELOPMENT": "1",
            "ANIMESOUL_PUBLIC_ORIGIN": origin,
            "ANIMESOUL_DATABASE_URL": "sqlite:///" + (Path(temporary) / "preview.db").as_posix(),
            "ANIMESOUL_DATA_DIR": temporary,
            "ANIMESOUL_OWNER_EMAIL": "preview@example.test",
            "ANIMESOUL_AUTH_GOOGLE_CLIENT_ID": "preview-disabled-client",
            "ANIMESOUL_AUTH_GOOGLE_CLIENT_SECRET": "preview-disabled-secret",
            "ANIMESOUL_SMTP_HOST": "preview.invalid", "ANIMESOUL_SMTP_FROM": "preview@example.test",
        })
        from fastapi import FastAPI, HTTPException
        from fastapi.responses import FileResponse, Response
        from fastapi.staticfiles import StaticFiles
        from sqlalchemy import insert, select
        import uvicorn
        from backend.app.website import schema_v1 as s
        from backend.app.website.profile_schema import metadata as profile_metadata
        from backend.app.website.accounts import hash_password
        from backend.app.website.runtime import install_website
        from backend.app.website.database import now
        from backend.app.website.profiles import update_profile

        demo = args.profile_demo
        demo_catalog = [{"anime_id": index + 1, "title": title, "year": year, "type": {"name": "TV Сериал"},
                         "poster": {"big": f"/preview-poster/{index}"}} for index, (title, year) in enumerate([
            ("Провожающая в последний путь Фрирен", 2023), ("Вайолет Эвергарден", 2018),
            ("Твоё имя", 2016), ("Унесённые призраками", 2001), ("Форма голоса", 2016),
            ("Врата Штейна", 2011), ("Психопаспорт", 2012), ("Монстр", 2004),
        ])]

        closers = []

        @asynccontextmanager
        async def lifespan(_app):
            try:
                yield
            finally:
                await asyncio.gather(*(close() for close in closers), return_exceptions=True)

        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
        if args.live_catalog:
            from backend.app.api import community_ratings, episode_dates, kodik, yummy
            for module in (yummy, kodik, episode_dates, community_ratings):
                app.include_router(module.router)
            closers.extend([yummy.close_yummy_services, kodik.close_kodik_services, episode_dates.gateway.close])
        install_website(app)
        database = app.state.website_database
        s.metadata.create_all(database.engine)
        profile_metadata.create_all(database.engine)
        database.seed_roles()
        with database.engine.begin() as conn:
            for username, email, owner in [("preview", "preview@example.test", True), ("viewer", "viewer@example.test", False)]:
                existing = conn.execute(select(s.users.c.id).where(s.users.c.username == username)).scalar()
                if existing:
                    if owner:
                        demo_user_id = existing
                    continue
                user_id = str(uuid4())
                conn.execute(insert(s.users).values(id=user_id, username=username, email=email, email_verified=True, password_hash=hash_password("preview-password-123"), avatar="", disabled=False, created_at=now()))
                if owner:
                    conn.execute(insert(s.user_roles).values(user_id=user_id, role_id="owner"))
                    if demo:
                        update_profile(conn, database, user_id, {"about": "Люблю тихие истории, красивые миры и аниме, к которым хочется возвращаться.", "visibility": {"favorites": True, "collections": True, "ratings": True, "statistics": True}})
                        demo_user_id = user_id

        if demo and not restore and not args.live_catalog:
            document = database.read_save(demo_user_id)
            document["profiles"][0]["snapshot"] = {
                "favorites": list(range(1, 9)), "folders": [
                    {"id": "quiet", "name": "Для тихого вечера", "animeIds": [1, 2, 3]},
                    {"id": "classics", "name": "Любимая классика", "animeIds": [4, 5]},
                    {"id": "stories", "name": "Истории с послевкусием", "animeIds": [6, 7, 8]},
                ], "ratings": {str(item["anime_id"]): {"title": item["title"], "anime": 10 - index * .5, "seasons": {}, "episodes": {}} for index, item in enumerate(demo_catalog)},
                "progress": {str(anime_id): {"title": demo_catalog[anime_id - 1]["title"], "episode": "1", "dub": "", "totalEpisodes": 12, "episodes": {
                    f"1:{episode}": {"position": 1440, "duration": 1440, "percent": 100, "updatedAt": now() * 1000, "completed": True, "watchedSeconds": 1440}
                    for episode in range(1, 13)
                }} for anime_id in range(1, 7)},
            }
            database.write_save(demo_user_id, document)

        @app.get("/preview-poster/{index}")
        def demo_poster(index: int):
            if not demo or not 0 <= index < len(demo_catalog):
                raise HTTPException(404)
            # Abstract placeholders deliberately avoid external media requests.
            colors = [("#8fae9a", "#314b56"), ("#878ab3", "#484462"), ("#79abd0", "#513f75"),
                      ("#d29888", "#743d4a"), ("#afa5cc", "#595773"), ("#ad996e", "#4a493f"),
                      ("#6c9c9e", "#263e54"), ("#b19381", "#544d60")]
            light, dark = colors[index]
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x2=".7" y2="1"><stop stop-color="{light}"/><stop offset="1" stop-color="{dark}"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="145" cy="70" r="32" fill="#ffffff35"/><path d="M0 215 50 150 100 180 170 110 200 170V300H0Z" fill="#10142450"/><path d="M0 270 65 210 135 245 200 190V300H0Z" fill="#10142470"/><text x="18" y="278" fill="#fff9" font-family="sans-serif" font-size="14">PREVIEW / {index + 1:02}</text></svg>'
            return Response(svg, media_type="image/svg+xml")

        def empty_catalog(mode: str = "catalog", ids: str = ""):
            requested = {int(value) for value in ids.split(",") if value.isdigit()}
            anime = [item for item in demo_catalog if mode != "details" or item["anime_id"] in requested] if demo else []
            return {"anime": anime, "videos": [], "trailers": [], "schedule": [], "genres": [], "hasMore": False, "ok": True}

        def empty_ratings():
            return {"ratings": {}, "hasMore": False}

        if not args.live_catalog:
            app.add_api_route("/api/yummy", empty_catalog)
            app.add_api_route("/api/community-ratings", empty_ratings)

        @app.get("/api/health")
        def health():
            return {"ok": True, "preview": True, "catalog": "live" if args.live_catalog else "demo"}

        # Disable external transports in this isolated development utility.
        import backend.app.website.accounts as accounts
        accounts.send_token = lambda *_args: None
        for route in app.router.routes:
            if getattr(route, "path", "").startswith("/api/auth/google/"):
                async def disabled_google():
                    raise HTTPException(503, "Google недоступен в тестовом предпросмотре")
                route.endpoint = disabled_google
                route.dependant.call = disabled_google

        dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            candidate = (dist / path).resolve()
            if path.startswith("api/") or not candidate.is_relative_to(dist.resolve()):
                raise HTTPException(404)
            return FileResponse(candidate if candidate.is_file() else dist / "index.html")

        mode = "live providers" if args.live_catalog else "demo catalogue (no playback)"
        print(f"Disposable preview ({mode}): {origin}/account — login preview, password preview-password-123")
        try:
            uvicorn.run(app, host="127.0.0.1", port=8013, access_log=False)
        finally:
            database.engine.dispose()


if __name__ == "__main__":
    main()
