"""FastAPI application entry point for AnimeSoul backend services.

Provides API routes for storage persistence, Google Drive cloud sync, Watch Party
real-time WebSocket server, and static production bundle serving.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from runtime_instance import RUNTIME_API_CAPABILITIES

from .api.gdrive import router as gdrive_router
from .api.community_ratings import router as community_ratings_router
from .api.downloads import router as downloads_router
from .api.storage import router as storage_router
from .api.watch_party import router as party_router
from .api.kodik import close_kodik_services, router as kodik_router
from .api.yummy import close_yummy_services, router as yummy_router
from .config import settings


@asynccontextmanager
async def lifespan(_application: FastAPI):
    """Keep upstream pools alive for the process and close them predictably."""

    yield
    await asyncio.gather(
        close_yummy_services(),
        close_kodik_services(),
        return_exceptions=True,
    )

app = FastAPI(
    title="AnimeSoul API",
    version="0.2.5",
    description="FastAPI backend for the AnimeSoul desktop and web client.",
    lifespan=lifespan,
)


@app.middleware("http")
async def response_performance_headers(request, call_next):
    """Expose local backend time and safely cache fingerprinted UI assets."""

    started_at = time.perf_counter()
    response = await call_next(request)
    duration = (time.perf_counter() - started_at) * 1000
    response.headers["Server-Timing"] = f"animesoul;dur={duration:.1f}"
    if request.url.path.startswith("/assets/"):
        response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    elif not request.url.path.startswith("/api/downloads/media/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response

# Enable CORS for local Vite dev server (port 5173). Production uses same-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Server-Timing",
        "X-AnimeSoul-Yummy-Status",
        "X-AnimeSoul-Kodik-Status",
    ],
)

# Register API routers
app.include_router(yummy_router)
app.include_router(kodik_router)
app.include_router(downloads_router)
app.include_router(storage_router)
# The standalone Android product intentionally has no Watch Party surface.
if os.getenv("ANIMESOUL_MOBILE", "").casefold() != "android":
    app.include_router(party_router)
app.include_router(gdrive_router)
app.include_router(community_ratings_router)


@app.get("/api/health", summary="Health check", tags=["System"])
async def health() -> dict[str, object]:
    """Return backend health status and stack version."""
    payload: dict[str, object] = {
        "ok": True,
        "stack": "FastAPI + React",
        "version": app.version,
        "capabilities": sorted(RUNTIME_API_CAPABILITIES),
    }
    runtime_instance_id = os.getenv("ANIMESOUL_INSTANCE_ID", "").strip()
    if runtime_instance_id:
        payload["runtimeInstanceId"] = runtime_instance_id
    return payload


# Serve built React frontend assets in production mode
if settings.frontend_dist.exists():
    assets = settings.frontend_dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def react_application(path: str) -> FileResponse:
        """Serve client-side single page application routes."""
        candidate = settings.frontend_dist / path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(settings.frontend_dist / "index.html")
