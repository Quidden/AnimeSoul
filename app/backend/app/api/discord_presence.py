"""Only a local browser may control this computer's Discord."""
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request

from ..services.discord_presence import Update, presence

router = APIRouter(prefix="/api/discord", tags=["Discord"])
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def require_local(request: Request):
    origin = request.headers.get("origin")
    if (not request.client or request.client.host not in LOCAL_HOSTS
            or request.url.hostname not in LOCAL_HOSTS
            or (origin and urlsplit(origin).netloc not in {
                request.url.netloc, "127.0.0.1:5173", "localhost:5173"})):
        raise HTTPException(403, "Discord presence requires a local desktop or local server")


@router.get("/status")
def status(request: Request):
    require_local(request)
    return presence.status()


@router.post("/presence")
def update_presence(update: Update, request: Request):
    require_local(request)
    if "application/json" not in request.headers.get("content-type", ""):
        raise HTTPException(415, "JSON required")
    return presence.submit(update)
