"""FastAPI application entry point for the Python + React experiment."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.storage import router as storage_router
from .api.watch_party import router as party_router
from .api.yummy import router as yummy_router
from .config import settings


app = FastAPI(
    title="AnimeSoul Python API",
    version="0.1.6-beta-python",
    description="Experimental FastAPI backend for the AnimeSoul React client.",
)

# Vite uses port 5173 during development. Production is same-origin on FastAPI.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(yummy_router)
app.include_router(storage_router)
app.include_router(party_router)


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {"ok": True, "stack": "FastAPI + React", "version": app.version}


if settings.frontend_dist.exists():
    assets = settings.frontend_dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def react_application(path: str) -> FileResponse:
        """Use the React entry point for client-side navigation."""

        candidate = settings.frontend_dist / path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(settings.frontend_dist / "index.html")
