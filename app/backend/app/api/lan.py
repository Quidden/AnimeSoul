"""Loopback-only administration; the network listener exposes no general API."""
from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, validator
import httpx

from ..config import settings
from ..services.lan import LanService
from ..services.lan_models import ControlCommand
from ..services.lan_protocol import local_address
from ..services.lan_transfer import receive
from ..services.storage import validate_storage_document
from .downloads import offline_library
from .storage import storage


async def local_only(request: Request):
    if not request.client or request.client.host not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "Настройки устройств доступны только на самом устройстве.")
    if request.url.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(403, "Недопустимый адрес локального интерфейса.")
    origin = request.headers.get("origin")
    if origin and origin not in {str(request.base_url).rstrip("/"), "http://127.0.0.1:5173", "http://localhost:5173"}:
        raise HTTPException(403, "Недопустимый источник запроса.")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Межсайтовый доступ запрещён.")


router = APIRouter(tags=["Devices"], dependencies=[Depends(local_only)])
lan = LanService(settings.data_dir, storage, offline_library)


class SettingsPayload(BaseModel):
    enabled: bool
    name: str = Field(min_length=1, max_length=80)
    localPriority: bool = True


class PairPayload(BaseModel):
    host: str = Field(max_length=64)
    code: str = Field(min_length=4, max_length=4)


class PeerPayload(BaseModel):
    host: str = Field(max_length=64)
    saves: bool
    media: bool
    control: bool
    priority: int = Field(ge=0, le=100)

    @validator("host")
    def valid_host(cls, value):
        return local_address(value)


class TransferPayload(BaseModel):
    peerId: str
    episodeIds: list[str] = Field(min_items=1, max_items=1000)

    @validator("episodeIds")
    def valid_ids(cls, values):
        if any(len(v) != 24 or any(c not in "0123456789abcdef" for c in v) for v in values):
            raise ValueError("Некорректный ID серии.")
        return list(dict.fromkeys(values))


class Acknowledgement(BaseModel):
    id: str = Field(max_length=64)
    error: str = Field(max_length=300)


class PollPayload(BaseModel):
    player: dict = Field(default_factory=dict)
    activity: bool = False
    acknowledgements: list[Acknowledgement] = Field(default_factory=list, max_items=20)


def dump(value):
    return value.model_dump() if hasattr(value, "model_dump") else value.dict()


async def call(awaitable):
    try:
        return await awaitable
    except httpx.HTTPStatusError as error:
        detail = "Устройство отказало в запросе. Проверьте разрешения и привязку."
        try:
            await error.response.aread()
            detail = error.response.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(422, detail if isinstance(detail, str) else "Некорректный запрос к устройству.") from error
    except httpx.HTTPError as error:
        raise HTTPException(503, "Устройство недоступно. Проверьте адрес, Wi-Fi и запущено ли приложение.") from error
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(422, str(error)) from error


@router.get("/api/lan/status")
async def status():
    return await lan.status()


@router.put("/api/lan/settings")
async def configure(payload: SettingsPayload):
    return await call(lan.configure(payload.enabled, payload.name, payload.localPriority))


@router.post("/api/lan/invite")
async def invite():
    await lan.load()
    try:
        return lan.invite()
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.post("/api/lan/pair")
async def pair(payload: PairPayload):
    await lan.load()
    return await call(lan.pair(payload.host, payload.code))


@router.put("/api/lan/peers/{peer_id}")
async def update_peer(peer_id: str, payload: PeerPayload):
    await lan.load()
    return await call(lan.update_peer(peer_id, dump(payload)))


@router.delete("/api/lan/peers/{peer_id}")
async def revoke(peer_id: str):
    await lan.load()
    return await lan.revoke(peer_id)


@router.get("/api/lan/peers/{peer_id}/state")
async def remote_state(peer_id: str):
    await lan.load()
    return await call(lan.remote(peer_id, "GET", "/state"))


@router.get("/api/lan/peers/{peer_id}/library")
async def remote_library(peer_id: str):
    await lan.load()
    return await call(lan.remote(peer_id, "GET", "/library"))


@router.post("/api/lan/peers/{peer_id}/control")
async def remote_control(peer_id: str, payload: ControlCommand):
    await lan.load()
    return await call(lan.remote(peer_id, "POST", "/control", dump(payload)))


@router.post("/api/lan/transfers")
async def transfer(payload: TransferPayload):
    await lan.load()
    try:
        lan.peer(payload.peerId)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if len(lan.transfer_tasks) >= 5:
        raise HTTPException(409, "Дождитесь завершения текущих передач.")
    tid = uuid.uuid4().hex
    job = {"id": tid, "peerId": payload.peerId, "status": "queued", "title": "Передача серий",
           "total": len(payload.episodeIds), "completed": 0, "bytes": 0, "totalBytes": 0, "error": ""}
    lan.transfers = {k: v for k, v in list(lan.transfers.items())[-30:]}
    lan.transfers[tid] = job
    lan.transfer_tasks[tid] = asyncio.create_task(receive(lan, job, payload.episodeIds))
    return job


@router.delete("/api/lan/transfers/{transfer_id}")
async def cancel(transfer_id: str):
    if transfer_id in lan.transfer_tasks:
        lan.transfer_tasks[transfer_id].cancel()
    return {"cancelled": True}


@router.post("/api/lan/poll")
async def poll(payload: PollPayload):
    await lan.load()
    return lan.poll(payload.player, payload.activity, [dump(a) for a in payload.acknowledgements])


@router.post("/api/lan/merge")
async def merge(document: dict):
    await lan.load()
    if not validate_storage_document(document):
        raise HTTPException(422, "Некорректный документ сохранений.")
    # The Drive worker may have merged a cloud revision since the UI last read
    # the file. Include it before the next ordinary autosave publishes changes.
    return lan.merge(document, await storage.read())
