"""Profile and progress persistence endpoints."""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..services.gdrive import get_gdrive_service
from ..services.storage import JsonStorage


router = APIRouter(tags=["Storage"])
storage = JsonStorage(
    settings.data_dir,
    import_candidates=(settings.legacy_storage_file,),
)
gdrive_service = get_gdrive_service(settings.data_dir)


@router.get("/api/storage")
async def read_storage() -> dict[str, Any]:
    document = await storage.read()
    if document is None:
        raise HTTPException(status_code=404, detail="Save file does not exist")
    return document


@router.put("/api/storage")
async def write_storage(
    document: dict[str, Any],
    auto_sync: bool = True,
) -> dict[str, object]:
    """The frontend owns schema migration; backend guarantees atomic writes."""

    if not isinstance(document.get("profiles"), list):
        raise HTTPException(status_code=422, detail="Invalid storage document")
    await storage.write(document)

    # Coalesce rapid saves through the shared Drive service. A second service
    # instance would have a separate lock/queue and could upload stale data last.
    if auto_sync and gdrive_service.load_tokens():
        gdrive_service.schedule_write(
            document,
            local_reader=storage.read,
            local_writer=storage.write,
        )

    return {"saved": True, "path": str(storage.file)}
