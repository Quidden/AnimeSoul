"""In-memory watch-party rooms with REST compatibility and WebSocket events."""

from __future__ import annotations

import asyncio
import secrets
import string
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(slots=True)
class Participant:
    id: str
    name: str
    role: str
    mode: str
    updated_at: int = field(default_factory=now_ms)
    playback: dict[str, Any] | None = None
    buffering: bool = False


@dataclass(slots=True)
class Room:
    id: str
    host_token: str
    participants: dict[str, Participant]
    playback: dict[str, Any] | None = None
    last_action: dict[str, Any] | None = None
    action_seq: int = 0
    # The service deliberately avoids importing FastAPI. Socket objects only
    # need a send_json method, which keeps this domain layer easy to test.
    sockets: set[Any] = field(default_factory=set)


class WatchPartyService:
    """Own room lifecycle independently from HTTP transport."""

    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def create(self, name: str) -> dict[str, str]:
        async with self._lock:
            room_id = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
            token = str(uuid.uuid4())
            host = Participant(token, name[:32] or "Хост", "host", "follow")
            self.rooms[room_id] = Room(room_id, token, {token: host})
            return {"roomId": room_id, "token": token, "role": "host"}

    async def join(self, room_id: str, name: str, mode: str) -> dict[str, str] | None:
        room = self.rooms.get(room_id.upper())
        if not room:
            return None
        token = str(uuid.uuid4())
        room.participants[token] = Participant(
            token, name[:32] or "Участник", "guest", "free" if mode == "free" else "follow"
        )
        await self.broadcast(room)
        return {"roomId": room.id, "token": token, "role": "guest"}

    async def update(self, body: dict[str, Any]) -> bool:
        room = self.rooms.get(str(body.get("roomId", "")).upper())
        participant = room.participants.get(str(body.get("token"))) if room else None
        if not room or not participant:
            return False
        participant.name = str(body.get("name") or participant.name)[:32]
        participant.mode = "free" if body.get("mode") == "free" else "follow"
        participant.playback = body.get("playback") or participant.playback
        participant.buffering = bool(body.get("buffering"))
        participant.updated_at = now_ms()
        if participant.id == room.host_token and body.get("playback"):
            room.playback = {**body["playback"], "sentAt": now_ms()}
            if body.get("action"):
                room.action_seq += 1
                room.last_action = {**body["action"], "seq": room.action_seq}
        await self.broadcast(room)
        return True

    def state(self, room_id: str) -> dict[str, Any] | None:
        room = self.rooms.get(room_id.upper())
        if not room:
            return None
        current = now_ms()
        return {
            "roomId": room.id,
            "playback": room.playback,
            "lastAction": room.last_action,
            "participants": [
                {
                    "id": item.id,
                    "name": item.name,
                    "role": item.role,
                    "mode": item.mode,
                    "playback": item.playback,
                    "buffering": item.buffering,
                    "online": current - item.updated_at < 6000,
                }
                for item in room.participants.values()
            ],
        }

    async def leave(self, room_id: str, token: str) -> None:
        room = self.rooms.get(room_id.upper())
        if not room:
            return
        if token == room.host_token:
            self.rooms.pop(room.id, None)
            return
        room.participants.pop(token, None)
        await self.broadcast(room)

    async def broadcast(self, room: Room) -> None:
        """Push the latest state to WebSocket clients; REST polling still works."""

        payload = self.state(room.id)
        stale: list[Any] = []
        for socket in room.sockets:
            try:
                await socket.send_json(payload)
            except RuntimeError:
                stale.append(socket)
        for socket in stale:
            room.sockets.discard(socket)
