"""Watch-party REST compatibility plus optional WebSocket transport."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..services.watch_party import WatchPartyService


router = APIRouter(tags=["Watch party"])
service = WatchPartyService()


@router.post("/watch-party/create")
async def create_room(body: dict[str, Any]) -> dict[str, str]:
    return await service.create(str(body.get("name") or "Хост"))


@router.post("/watch-party/join")
async def join_room(body: dict[str, Any]) -> dict[str, str]:
    result = await service.join(
        str(body.get("roomId") or ""),
        str(body.get("name") or "Участник"),
        str(body.get("mode") or "follow"),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    return result


@router.post("/watch-party/update")
async def update_room(body: dict[str, Any]) -> dict[str, bool]:
    if not await service.update(body):
        raise HTTPException(status_code=404, detail="Подключение к комнате потеряно")
    return {"ok": True}


@router.get("/watch-party/state")
async def room_state(room: str) -> dict[str, Any]:
    result = service.state(room)
    if not result:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    return result


@router.post("/watch-party/leave")
async def leave_room(body: dict[str, Any]) -> dict[str, bool]:
    await service.leave(str(body.get("roomId") or ""), str(body.get("token") or ""))
    return {"ok": True}


@router.websocket("/ws/watch-party/{room_id}")
async def watch_party_socket(socket: WebSocket, room_id: str) -> None:
    """WebSocket is available for future low-latency React synchronization."""

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
