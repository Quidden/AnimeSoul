"""Optional, device-local Discord activity. No bot, account token or cloud state."""
from __future__ import annotations

import asyncio
import json
import os
import struct
import sys
import threading
import time
import uuid
from typing import Literal

from pydantic import BaseModel, Field


DEFAULT_APPLICATION_ID = "1554513653909422140"


def application_id() -> str:
    return os.getenv("ANIMESOUL_DISCORD_APPLICATION_ID", "").strip() or DEFAULT_APPLICATION_ID


def available() -> bool:
    return (sys.platform == "win32" and os.getenv("ANIMESOUL_MOBILE") != "android"
            and os.getenv("ANIMESOUL_DISCORD_ENABLED", "1") != "0")


class Preferences(BaseModel):
    enabled: bool = False
    applicationId: str = Field(default="", max_length=22, pattern=r"^\d{0,22}$")
    logo: bool = True
    title: bool = True
    season: bool = True
    episode: bool = True
    layout: Literal["title-first", "episode-first"] = "title-first"
    time: Literal["off", "elapsed", "remaining", "text"] = "elapsed"
    paused: Literal["show", "hide"] = "show"
    idle: bool = True


class Playback(BaseModel):
    title: str = Field(default="", max_length=256)
    season: str = Field(default="", max_length=64)
    episode: str = Field(default="", max_length=64)
    position: float = Field(default=0, ge=0, le=86400, allow_inf_nan=False)
    duration: float = Field(default=0, ge=0, le=86400, allow_inf_nan=False)
    playing: bool = False


class Update(BaseModel):
    session: str = Field(min_length=1, max_length=64)
    preferences: Preferences = Field(default_factory=Preferences)
    playback: Playback | None = None


def clock_text(seconds: float) -> str:
    minutes, seconds = divmod(int(seconds), 60)
    return f"{minutes:02d}:{seconds:02d}"


def activity_for(update: Update, now: float, session_started_at: int | None = None) -> dict | None:
    prefs, video = update.preferences, update.playback
    if not prefs.enabled or (video is None and not prefs.idle):
        return None
    if video and not video.playing and prefs.paused == "hide":
        return None
    activity: dict = {"type": 3, "details": "В библиотеке", "status_display_type": 0}
    # Without an explicit start Discord can restart its elapsed counter on
    # SET_ACTIVITY. Keep the app session stable when no video timer is used.
    if prefs.time != "off" and session_started_at is not None:
        activity["timestamps"] = {"start": session_started_at}
    if prefs.logo:
        activity["assets"] = {"large_image": "animesoul", "large_text": "AnimeSoul"}
    if video:
        title = video.title if prefs.title else "Смотрит аниме"
        parts = []
        if prefs.season and video.season:
            parts.append(video.season)
        if prefs.episode and video.episode:
            parts.append(video.episode)
        if not video.playing:
            parts.append("Пауза")
        if prefs.time == "text":
            parts.append(clock_text(video.position) + (f" / {clock_text(video.duration)}" if video.duration else ""))
        state = " · ".join(parts)
        if prefs.layout == "episode-first" and state:
            title, state = state, title
            title_field = 1  # Discord State
        else:
            title_field = 2  # Discord Details
        if prefs.title and video.title:
            activity["status_display_type"] = title_field
        activity["details"] = (title or "Смотрит аниме")[:128]
        if state:
            activity["state"] = state[:128]
        if video.playing and prefs.time == "elapsed":
            activity["timestamps"] = {"start": int(now - video.position)}
        elif video.playing and prefs.time == "remaining" and video.duration > video.position:
            activity["timestamps"] = {"end": int(now + video.duration - video.position)}
    return activity


class DiscordPipe:
    """Bounded IPC exchanges on the worker's Windows Proactor loop."""
    def __init__(self):
        self.reader = None
        self.transport = None

    async def connect(self, application_id: str):
        loop = asyncio.get_running_loop()
        for index in range(10):
            reader = asyncio.StreamReader()
            protocol = asyncio.StreamReaderProtocol(reader)
            try:
                transport, _ = await loop.create_pipe_connection(
                    lambda: protocol, rf"\\?\pipe\discord-ipc-{index}")
            except OSError:
                continue
            self.reader, self.transport = reader, transport
            self.send(0, {"v": 1, "client_id": application_id})
            response = await self.receive()
            if response.get("evt") != "READY":
                raise ValueError("Discord rejected application ID")
            return
        raise ConnectionError("Discord is not running")

    def send(self, opcode: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.transport.write(struct.pack("<II", opcode, len(data)) + data)

    async def receive(self):
        while True:
            opcode, length = struct.unpack("<II", await self.reader.readexactly(8))
            if length > 1024 * 1024:
                raise ValueError("Oversized Discord frame")
            data = json.loads(await self.reader.readexactly(length))
            if opcode == 3:
                self.send(4, data)
            elif opcode == 2 or data.get("evt") == "ERROR":
                raise ConnectionError("Discord rejected the activity")
            elif opcode == 1:
                return data

    async def update(self, activity):
        nonce = uuid.uuid4().hex
        self.send(1, {"cmd": "SET_ACTIVITY", "args": {"pid": os.getpid(), "activity": activity}, "nonce": nonce})
        while (await self.receive()).get("nonce") != nonce:
            pass

    def close(self):
        if self.transport:
            self.transport.close()

    def connected(self):
        return self.transport is not None and not self.transport.is_closing() and not self.reader.at_eof()


class PresenceService:
    def __init__(self):
        self._lock = threading.Lock()
        self._update: Update | None = None
        self._received = 0.0
        self._thread = None
        self._stop = threading.Event()
        self._state = "disabled"

    def status(self):
        return {"available": available(), "state": self._state,
                "applicationId": application_id()}

    def submit(self, update: Update):
        if not available():
            return self.status()
        with self._lock:
            # Another tab cannot clear an active owner's presence.
            if (self._update and self._update.session != update.session
                    and time.monotonic() - self._received < 45
                    and self._update.playback and not update.playback):
                return self.status()
            self._update, self._received = update, time.monotonic()
            if self._thread is None:
                self._thread = threading.Thread(target=lambda: asyncio.run(self._run()), daemon=True)
                self._thread.start()
        return self.status()

    async def _run(self):
        pipe, connected_id, last_sent, retry_at = None, "", 0.0, 0.0
        session_started_at = None
        last_activity = None
        try:
            while not self._stop.is_set():
                with self._lock:
                    update, received = self._update, self._received
                now = time.monotonic()
                fresh = update is not None and now - received < 45
                if not fresh or not update.preferences.enabled:
                    session_started_at = None
                elif session_started_at is None:
                    session_started_at = int(time.time())
                if fresh and update.playback and update.playback.playing:
                    video = update.playback
                    position = min(video.duration or 86400, video.position + now - received)
                    update = update.model_copy(update={"playback": video.model_copy(update={"position": position})})
                activity = activity_for(update, time.time(), session_started_at) if fresh else None
                app_id = (update.preferences.applicationId or application_id()) if update else ""
                if activity is None or not app_id or app_id != connected_id:
                    if pipe:
                        try:
                            await asyncio.wait_for(pipe.update(None), 2)
                        except Exception:
                            pass
                        pipe.close()
                        pipe = None
                        last_activity = None
                    self._state = "needs_application_id" if activity and not app_id else "disabled"
                if activity and app_id and now >= retry_at:
                    try:
                        if pipe is None:
                            pipe = DiscordPipe()
                            await asyncio.wait_for(pipe.connect(app_id), 3)
                            connected_id, last_sent = app_id, 0.0
                            last_activity = None
                        if not pipe.connected():
                            raise ConnectionError("Discord disconnected")
                        if now - last_sent >= 15 and activity != last_activity:
                            await asyncio.wait_for(pipe.update(activity), 3)
                            last_sent = now
                            last_activity = activity
                        self._state = "connected"
                    except Exception:
                        if pipe:
                            pipe.close()
                        pipe = None
                        retry_at = now + 15
                        self._state = "unavailable"
                await asyncio.sleep(.5)
        finally:
            if pipe:
                try:
                    await asyncio.wait_for(pipe.update(None), 2)
                except Exception:
                    pass
                pipe.close()

    def close(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=6)


presence = PresenceService()


class DesktopDiscordBridge:
    """Local IPC stays on the desktop even when its UI uses a hosted server."""
    def discord_presence(self, payload=None):
        return presence.status() if payload is None else presence.submit(Update.model_validate(payload))
