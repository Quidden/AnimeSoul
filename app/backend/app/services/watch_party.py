"""In-memory watch-party rooms shared by browser and desktop clients.

The response contract intentionally mirrors the legacy watch-party server.
Keeping the protocol identical allows a main client and a legacy client to
join the same room without special compatibility branches in React.
"""

from __future__ import annotations

import asyncio
import secrets
import string
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


WATCH_PARTY_PROTOCOL = 2
PARTICIPANT_RETENTION_MS = 5 * 60_000
PARTICIPANT_ONLINE_MS = 8_000


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
    room_mode: str
    participants: dict[str, Participant]
    created_at: int = field(default_factory=now_ms)
    updated_at: int = field(default_factory=now_ms)
    playback: dict[str, Any] | None = None
    last_controller_id: str | None = None
    last_action: dict[str, Any] | None = None
    action_seq: int = 0
    sockets: set[Any] = field(default_factory=set)


class WatchPartyService:
    """Own room lifecycle independently from FastAPI transport."""

    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def create(self, name: str, room_mode: str = "host") -> dict[str, Any]:
        async with self._lock:
            while True:
                room_id = "".join(
                    secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6)
                )
                if room_id not in self.rooms:
                    break
            token = str(uuid.uuid4())
            host = Participant(token, name[:32] or "Хост", "host", "follow")
            self.rooms[room_id] = Room(
                room_id,
                token,
                "shared" if room_mode == "shared" else "host",
                {token: host},
            )
            return {
                "roomId": room_id,
                "token": token,
                "role": "host",
                "protocol": WATCH_PARTY_PROTOCOL,
            }

    async def join(
        self,
        room_id: str,
        name: str,
        mode: str,
    ) -> dict[str, Any] | None:
        room = self.rooms.get(room_id.upper())
        if not room:
            return None
        token = str(uuid.uuid4())
        room.participants[token] = Participant(
            token,
            name[:32] or "Участник",
            "guest",
            "free" if mode == "free" else "follow",
        )
        room.updated_at = now_ms()
        await self.broadcast(room)
        return {
            "roomId": room.id,
            "token": token,
            "role": "guest",
            "protocol": WATCH_PARTY_PROTOCOL,
        }

    async def update(self, body: dict[str, Any]) -> str:
        """Apply a heartbeat and return a stable error code or ``OK``."""

        room = self.rooms.get(str(body.get("roomId", "")).upper())
        if not room:
            return "ROOM_NOT_FOUND"
        participant = room.participants.get(str(body.get("token")))
        if not participant:
            return "PARTICIPANT_NOT_FOUND"

        participant.name = str(body.get("name") or participant.name)[:32]
        participant.mode = "free" if body.get("mode") == "free" else "follow"
        participant.playback = body.get("playback") or participant.playback
        participant.buffering = bool(body.get("buffering"))
        participant.updated_at = now_ms()

        if participant.id == room.host_token and body.get("roomMode") in {"host", "shared"}:
            room.room_mode = str(body["roomMode"])

        host_controls = (
            room.room_mode == "host"
            and participant.id == room.host_token
            and participant.mode == "follow"
        )
        shared_control = (
            room.room_mode == "shared"
            and participant.mode == "follow"
            and body.get("control") is True
        )
        seed_shared_room = (
            room.room_mode == "shared"
            and room.playback is None
            and participant.id == room.host_token
        )
        if (host_controls or shared_control or seed_shared_room) and body.get("playback"):
            room.playback = {**body["playback"], "sentAt": now_ms()}
            room.last_controller_id = participant.id
            if body.get("action"):
                room.action_seq += 1
                room.last_action = {**body["action"], "seq": room.action_seq}

        room.updated_at = now_ms()
        await self.broadcast(room)
        return "OK"

    async def transfer_host(
        self,
        room_id: str,
        token: str,
        participant_id: str,
    ) -> tuple[str, str | None]:
        room = self.rooms.get(room_id.upper())
        if not room:
            return "ROOM_NOT_FOUND", None
        if token != room.host_token:
            return "NOT_HOST", None
        next_host = room.participants.get(participant_id)
        if not next_host:
            return "PARTICIPANT_NOT_FOUND", None
        current_host = room.participants.get(room.host_token)
        if current_host:
            current_host.role = "guest"
        next_host.role = "host"
        room.host_token = next_host.id
        room.updated_at = now_ms()
        await self.broadcast(room)
        return "OK", next_host.id

    def state(self, room_id: str) -> dict[str, Any] | None:
        room = self.rooms.get(room_id.upper())
        if not room:
            return None
        current = now_ms()
        stale = [
            token
            for token, participant in room.participants.items()
            if token != room.host_token
            and current - participant.updated_at > PARTICIPANT_RETENTION_MS
        ]
        for token in stale:
            room.participants.pop(token, None)
        return {
            "protocol": WATCH_PARTY_PROTOCOL,
            "roomId": room.id,
            "roomMode": room.room_mode,
            "playback": room.playback,
            "lastControllerId": room.last_controller_id,
            "lastAction": room.last_action,
            "participants": [
                {
                    "id": item.id,
                    "name": item.name,
                    "role": item.role,
                    "mode": item.mode,
                    "playback": item.playback,
                    "buffering": item.buffering,
                    "online": current - item.updated_at < PARTICIPANT_ONLINE_MS,
                }
                for item in room.participants.values()
            ],
        }

    async def leave(self, room_id: str, token: str) -> None:
        room = self.rooms.get(room_id.upper())
        if not room:
            return
        room.participants.pop(token, None)
        if token == room.host_token:
            next_host = max(
                room.participants.values(),
                key=lambda participant: participant.updated_at,
                default=None,
            )
            if next_host:
                next_host.role = "host"
                room.host_token = next_host.id
            else:
                self.rooms.pop(room.id, None)
                return
        await self.broadcast(room)

    async def broadcast(self, room: Room) -> None:
        """Push state to WebSockets while REST polling remains authoritative."""

        payload = self.state(room.id)
        stale: list[Any] = []
        for socket in room.sockets:
            try:
                await socket.send_json(payload)
            except RuntimeError:
                stale.append(socket)
        for socket in stale:
            room.sockets.discard(socket)
