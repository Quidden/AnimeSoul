"""Watch-party REST protocol plus an optional WebSocket state stream."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from ..services.watch_party import WATCH_PARTY_PROTOCOL, WatchPartyService


router = APIRouter(tags=["Watch party"])
service = WatchPartyService()


def room_error(code: str) -> JSONResponse:
    """Return the flat error contract consumed by the shared React client."""

    messages = {
        "ROOM_NOT_FOUND": "Комната не найдена",
        "PARTICIPANT_NOT_FOUND": "Подключение участника потеряно",
        "NOT_HOST": "Передать роль может только текущий хост",
    }
    status = 403 if code == "NOT_HOST" else 404
    return JSONResponse(
        status_code=status,
        content={"error": messages.get(code, "Ошибка совместного просмотра"), "code": code},
    )


@router.post("/watch-party/create")
async def create_room(body: dict[str, Any]) -> dict[str, Any]:
    return await service.create(
        str(body.get("name") or "Хост"),
        str(body.get("roomMode") or "host"),
    )


@router.post("/watch-party/join")
async def join_room(body: dict[str, Any]) -> Any:
    result = await service.join(
        str(body.get("roomId") or ""),
        str(body.get("name") or "Участник"),
        str(body.get("mode") or "follow"),
    )
    return result if result else room_error("ROOM_NOT_FOUND")


@router.post("/watch-party/update")
async def update_room(body: dict[str, Any]) -> Any:
    result = await service.update(body)
    return {"ok": True} if result == "OK" else room_error(result)


@router.post("/watch-party/transfer-host")
async def transfer_host(body: dict[str, Any]) -> Any:
    code, host_id = await service.transfer_host(
        str(body.get("roomId") or ""),
        str(body.get("token") or ""),
        str(body.get("participantId") or ""),
    )
    return {"ok": True, "hostId": host_id} if code == "OK" else room_error(code)


@router.get("/watch-party/state")
async def room_state(room: str) -> Any:
    result = service.state(room)
    return result if result else room_error("ROOM_NOT_FOUND")


@router.post("/watch-party/leave")
async def leave_room(body: dict[str, Any]) -> dict[str, bool]:
    await service.leave(str(body.get("roomId") or ""), str(body.get("token") or ""))
    return {"ok": True}


@router.get("/health")
async def watch_party_health() -> dict[str, Any]:
    return {"ok": True, "watchPartyProtocol": WATCH_PARTY_PROTOCOL}


@router.websocket("/ws/watch-party/{room_id}")
async def watch_party_socket(socket: WebSocket, room_id: str) -> None:
    room = service.rooms.get(room_id.upper())
    if not room:
        await socket.close(code=4404)
        return
    await socket.accept()
    room.sockets.add(socket)
    await socket.send_json(service.state(room.id))
    try:
        while True:
            await socket.receive_text()
    except WebSocketDisconnect:
        room.sockets.discard(socket)
