"""Profile and progress persistence endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..services.storage import JsonStorage


router = APIRouter(tags=["Storage"])
storage = JsonStorage(settings.data_dir)


@router.get("/api/storage")
async def read_storage() -> dict[str, Any]:
    document = await storage.read()
    if document is None:
        raise HTTPException(status_code=404, detail="Save file does not exist")
    return document


@router.put("/api/storage")
async def write_storage(document: dict[str, Any]) -> dict[str, object]:
    """The frontend owns schema migration; backend guarantees atomic writes."""

    if not isinstance(document.get("profiles"), list):
        raise HTTPException(status_code=422, detail="Invalid storage document")
    await storage.write(document)
    return {"saved": True, "path": str(storage.file)}
