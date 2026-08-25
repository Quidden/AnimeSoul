"""Profile and progress persistence endpoints."""

from __future__ import annotations

from typing import Any, Literal
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..services.gdrive import get_gdrive_service
from ..services.storage import JsonStorage, validate_storage_document


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
    folder_mode: Literal["visible", "appdata"] = "visible",
    prefer_watched: bool = True,
) -> dict[str, object]:
    """The frontend owns schema migration; backend guarantees atomic writes."""

    if not validate_storage_document(document):
        raise HTTPException(status_code=422, detail="Invalid storage document")
    await storage.write(document)

    # Coalesce rapid saves through the shared Drive service. A second service
    # instance would have a separate lock/queue and could upload stale data last.
    tokens = gdrive_service.load_tokens()
    # The server is authoritative here: an old browser tab or an interval
    # timer must not bypass the first-sync choice and replace cloud data.
    choice_pending = bool(tokens.get("choice_pending")) if isinstance(tokens, dict) else False
    if auto_sync and tokens and not choice_pending:
        gdrive_service.schedule_write(
            document,
            mode=folder_mode,
            prefer_watched=prefer_watched,
            local_reader=storage.read,
            local_writer=storage.write,
        )

    return {
        "saved": True,
        "path": str(storage.file),
        "cloud_sync_scheduled": bool(auto_sync and tokens and not choice_pending),
        "cloud_sync_blocked": bool(auto_sync and choice_pending),
    }
