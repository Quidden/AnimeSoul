"""Opt-in paired device exchange on a separate, deliberately narrow listener."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
import copy
import hmac
import json
import re
import secrets
import socket
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import ValidationError
import httpx
import uvicorn

from .gdrive_merge import merge_storage_documents
from .lan_protocol import Challenges, MAX_JSON, PORT, PeerClient, encode, local_address, signature
from .storage import validate_storage_document


SAVE_FIELDS = {"favorites", "folders", "progress", "ratings", "tracked", "animeTitles",
               "historyClearedAt", "watchingHidden"}


def save_data(document: dict) -> dict:
    """Never export credentials, device preferences, or arbitrary envelope fields."""
    profiles = []
    for profile in document.get("profiles", []):
        snapshot = profile.get("snapshot", {})
        clean = {k: copy.deepcopy(v) for k, v in snapshot.items() if k in SAVE_FIELDS}
        clean["fieldUpdatedAt"] = {k: v for k, v in snapshot.get("fieldUpdatedAt", {}).items() if k in SAVE_FIELDS}
        clean["name"] = str(profile.get("name", "Профиль"))[:200]
        profiles.append({"id": profile["id"], "name": clean["name"], "snapshot": clean})
    return {"schemaVersion": document.get("schemaVersion", 3), "updatedAt": document.get("updatedAt"),
            "activeProfile": document.get("activeProfile"), "profiles": profiles}


class LanServer(uvicorn.Server):
    # A second listener shares the primary server's event loop and signal owner.
    def install_signal_handlers(self):
        pass

    @contextmanager
    def capture_signals(self):
        yield


class LanService:
    def __init__(self, data_dir, storage, library):
        self.path = data_dir / "animesoul-devices.json"
        self.storage = storage
        self.library = library
        self.config = None
        self.lock = asyncio.Lock()
        self.challenges = Challenges()
        self.invitation = None
        self.server = None
        self.server_task = None
        self.sync_task = None
        self.remote_saves = {}
        self.presence = {}
        self.commands = []
        self.player = {}
        self.player_at = 0.0
        self.local_activity = 0.0
        self.lease = None
        self.command_results = {}
        self.transfers = {}
        self.transfer_tasks = {}
        self.transfer_lock = asyncio.Lock()
        self.remote_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        self._routes()

    async def load(self):
        if self.config is not None:
            return
        async with self.lock:
            if self.config is not None:
                return
            if self.path.exists():
                self.config = json.loads(await asyncio.to_thread(self.path.read_text, encoding="utf-8"))
            else:
                self.config = {"id": str(uuid.uuid4()), "name": socket.gethostname()[:80],
                               "enabled": False, "localPriority": True, "peers": {}}
                await self._save()

    async def _save(self):
        await asyncio.to_thread(self.path.parent.mkdir, parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        await asyncio.to_thread(temporary.write_bytes, encode(self.config))
        await asyncio.to_thread(temporary.replace, self.path)

    async def start(self):
        await self.load()
        if not self.config["enabled"] or self.server_task:
            return
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("0.0.0.0", PORT))
            sock.listen(32)
            sock.setblocking(False)
        except BaseException:
            sock.close()
            raise
        self.server = LanServer(uvicorn.Config(self.remote_app, log_config=None, log_level="warning",
                                              access_log=False, lifespan="off", loop="asyncio", ws="none",
                                              timeout_graceful_shutdown=5))
        self.server_task = asyncio.create_task(self.server.serve(sockets=[sock]))
        self.sync_task = asyncio.create_task(self._sync())

    async def stop(self):
        self.invitation = None
        self.remote_saves.clear()
        self.commands.clear()
        self.lease = None
        tasks = list(self.transfer_tasks.values())
        if self.sync_task:
            tasks.append(self.sync_task)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.sync_task = None
        if self.server:
            self.server.should_exit = True
        if self.server_task:
            await self.server_task
        self.server_task = self.server = None

    async def status(self):
        await self.load()
        addresses = []
        try:
            for item in await asyncio.to_thread(socket.getaddrinfo, socket.gethostname(), None, socket.AF_INET):
                try:
                    addresses.append(local_address(item[4][0]))
                except ValueError:
                    pass
        except OSError:
            pass
        # Android often reports the hostname as "localhost" even on Wi-Fi.
        # UDP connect chooses a local interface without sending a packet.
        for target in ("192.168.1.1", "10.0.0.1", "172.16.0.1"):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                    probe.connect((target, 9))
                    addresses.append(local_address(probe.getsockname()[0]))
            except (OSError, ValueError):
                pass
        return {"id": self.config["id"], "name": self.config["name"], "enabled": self.config["enabled"],
                "listening": bool(self.server and self.server.started), "port": PORT,
                "addresses": sorted(set(addresses)), "localPriority": self.config["localPriority"],
                "peers": [{**{k: v for k, v in p.items() if k != "key"}, "id": pid,
                           **self.presence.get(pid, {})} for pid, p in self.config["peers"].items()],
                "transfers": list(self.transfers.values())}

    async def configure(self, enabled: bool, name: str, local_priority: bool):
        await self.load()
        async with self.lock:
            self.config.update(enabled=enabled, name=name, localPriority=local_priority)
            try:
                if enabled:
                    await self.start()
            except OSError as error:
                self.config["enabled"] = False
                await self._save()
                raise ValueError(f"Не удалось открыть LAN-порт {PORT}: {error}") from error
            await self._save()
        if not enabled:
            await self.stop()
        return await self.status()

    def peer(self, peer_id):
        if not self.config["enabled"]:
            raise ValueError("Обмен по локальной сети выключен.")
        peer = self.config["peers"].get(peer_id)
        if not peer:
            raise ValueError("Устройство не связано или доступ отозван.")
        return peer

    def invite(self):
        if not self.config["enabled"]:
            raise ValueError("Сначала включите обмен по локальной сети.")
        code = f"{secrets.randbelow(10_000):04d}"
        self.invitation = {"key": code, "expires": time.monotonic() + 300, "attempts": 0}
        return {"code": code, "expiresIn": 300}

    async def pair(self, host: str, code: str):
        if not self.config["enabled"]:
            raise ValueError("Сначала включите обмен по локальной сети.")
        if not re.fullmatch(r"[0-9]{4}", code):
            raise ValueError("Введите код из четырёх цифр.")
        peer = self._new_peer(host, "Устройство", code)
        try:
            async with PeerClient(self.config["id"], peer) as client:
                result = await client.json("POST", "/pair", {"id": self.config["id"], "name": self.config["name"]})
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 401:
                raise ValueError("Неверный или просроченный код. Покажите новый код на другом устройстве.") from error
            raise
        peer_id = str(uuid.UUID(result["id"]))
        if peer_id == self.config["id"] or not re.fullmatch(r"[0-9a-f]{64}", result["key"]):
            raise ValueError("Ответ устройства не прошёл проверку.")
        peer["key"] = result["key"]
        peer["name"] = str(result["name"])[:80]
        async with self.lock:
            self.config["peers"][peer_id] = peer
            await self._save()
        self.presence[peer_id] = {"online": True, "error": "", "lastSeen": int(time.time() * 1000)}
        return await self.status()

    @staticmethod
    def _new_peer(host, name, key):
        return {"host": local_address(host), "port": PORT, "name": name, "key": key,
                "saves": True, "media": True, "control": False, "priority": 0}

    async def update_peer(self, peer_id, values):
        async with self.lock:
            peer = self.peer(peer_id)
            peer.update(values)
            self.remote_saves.pop(peer_id, None)
            self.commands = [c for c in self.commands if c["peerId"] != peer_id]
            if self.lease and self.lease[0] == peer_id:
                self.lease = None
            await self._save()
        return await self.status()

    async def revoke(self, peer_id):
        async with self.lock:
            self.config["peers"].pop(peer_id, None)
            self.remote_saves.pop(peer_id, None)
            self.presence.pop(peer_id, None)
            self.commands = [c for c in self.commands if c["peerId"] != peer_id]
            await self._save()
        for tid, transfer in self.transfers.items():
            if transfer["peerId"] == peer_id and tid in self.transfer_tasks:
                self.transfer_tasks[tid].cancel()
        return await self.status()

    async def _sync(self):
        while True:
            for pid, peer in list(self.config["peers"].items()):
                try:
                    async with PeerClient(self.config["id"], peer) as client:
                        state = await client.json("GET", "/state")
                        if state.get("id") != pid:
                            raise ValueError("ID устройства изменился.")
                        if peer["saves"] and state.get("saves"):
                            document = await client.json("GET", "/save")
                            if document is not None:
                                if not validate_storage_document(document):
                                    raise ValueError("Некорректное сохранение устройства.")
                                if self.config["peers"].get(pid) is peer and peer["saves"]:
                                    self.remote_saves[pid] = save_data(document)
                        else:
                            self.remote_saves.pop(pid, None)
                    self.presence[pid] = {"online": True, "error": "", "lastSeen": int(time.time() * 1000)}
                except Exception as error:
                    self.remote_saves.pop(pid, None)
                    self.presence[pid] = {"online": False, "error": str(error)[:200]}
            await asyncio.sleep(10)

    def merge(self, document, persisted=None):
        result = copy.deepcopy(document)
        if not self.config["enabled"]:
            return result
        sources = dict(self.remote_saves)
        if persisted and validate_storage_document(persisted):
            sources["__disk__"] = save_data(persisted)
        for pid in sorted(sources):
            peer = self.config["peers"].get(pid)
            if pid == "__disk__" or peer and peer["saves"]:
                merged = merge_storage_documents(result, sources[pid], prefer_watched=False, anime_only=True)
                # Only shared anime data may change. UI preferences stay device-local.
                existing = {p["id"]: p for p in result["profiles"]}
                source_profiles = {p["id"]: p for p in sources[pid]["profiles"]}
                for profile in merged["profiles"]:
                    old = existing.get(profile["id"])
                    if old:
                        snap = profile["snapshot"]
                        profile.update({k: v for k, v in old.items() if k != "snapshot"})
                        profile["snapshot"] = {**old["snapshot"], **{k: v for k, v in snap.items() if k in SAVE_FIELDS}}
                        revisions = dict(old["snapshot"].get("fieldUpdatedAt", {}))
                        revisions.update({k: v for k, v in snap.get("fieldUpdatedAt", {}).items() if k in SAVE_FIELDS})
                        profile["snapshot"]["fieldUpdatedAt"] = revisions
                        profile["snapshot"]["historyClearedAt"] = max(
                            float(old["snapshot"].get("historyClearedAt") or 0),
                            float(source_profiles.get(profile["id"], {}).get("snapshot", {}).get("historyClearedAt") or 0),
                        )
                result["profiles"] = merged["profiles"]
        return result

    async def remote(self, pid, method, path, value=None):
        async with PeerClient(self.config["id"], self.peer(pid)) as client:
            return await client.json(method, path, value)

    def enqueue_command(self, pid, value):
        from .lan_models import ControlCommand

        command = ControlCommand(**value)
        peer = self.peer(pid)
        if not peer["control"]:
            raise HTTPException(403, "Управление с этого устройства запрещено в настройках получателя.")
        now = time.monotonic()
        if now - self.player_at > 6:
            raise HTTPException(409, "Интерфейс получателя неактивен. Откройте приложение.")
        if self.config["localPriority"] and now - self.local_activity < 10:
            raise HTTPException(409, "Приоритет у локального управления. Повторите через 10 секунд.")
        if self.lease and self.lease[1] > now and self.lease[0] != pid:
            owner = self.config["peers"].get(self.lease[0], {})
            if peer["priority"] <= owner.get("priority", 0):
                raise HTTPException(409, "Плеером управляет устройство с равным или большим приоритетом.")
        self.commands = [c for c in self.commands if c["expires"] > now]
        if len(self.commands) >= 20:
            raise HTTPException(429, "Плеер ещё выполняет предыдущие команды.")
        cid = uuid.uuid4().hex
        payload = command.model_dump() if hasattr(command, "model_dump") else command.dict()
        self.commands.append({"id": cid, "peerId": pid, "expires": now + 8, **payload})
        self.lease = (pid, now + 15)
        return {"id": cid, "status": "queued"}

    def poll(self, player, activity, acknowledgements):
        now = time.monotonic()
        self.player, self.player_at = player, now
        if activity:
            self.local_activity = now
            if self.config["localPriority"]:
                self.commands.clear()
                self.lease = None
        for ack in acknowledgements:
            self.command_results[ack["id"]] = ack["error"]
        self.command_results = dict(list(self.command_results.items())[-100:])
        acknowledged = {a["id"] for a in acknowledgements}
        self.commands = [c for c in self.commands if c["expires"] > now and c["id"] not in acknowledged
                         and self.config["peers"].get(c["peerId"], {}).get("control")]
        return {"commands": self.commands if self.config["enabled"] else [],
                "localPriority": self.config["localPriority"]}

    def _routes(self):
        app = self.remote_app

        @app.exception_handler(ValidationError)
        @app.exception_handler(ValueError)
        async def invalid_payload(_request, _error):
            return Response(encode({"detail": "Некорректный запрос устройства."}), status_code=422,
                            media_type="application/json")

        @app.middleware("http")
        async def authenticate(request: Request, call_next):
            if not self.config or not self.config["enabled"]:
                return Response(status_code=403)
            try:
                local_address(request.client.host)
            except ValueError:
                return Response(status_code=403)
            if request.method == "GET" and request.url.path == "/challenge":
                try:
                    return Response(encode({"nonce": self.challenges.issue()}), media_type="application/json")
                except ValueError:
                    return Response(status_code=429)
            pid = request.headers.get("X-AS-Device", "")
            nonce = request.headers.get("X-AS-Nonce", "")
            if request.url.path == "/pair":
                invite = self.invitation
                key = invite["key"] if invite and invite["expires"] > time.monotonic() and invite["attempts"] < 5 else None
            else:
                key = self.config["peers"].get(pid, {}).get("key")
            if not key or not self.challenges.consume(nonce):
                return Response(status_code=401)
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > MAX_JSON:
                    return Response(status_code=413)
            body = bytes(raw)
            context = f"{request.method}\n{request.url.path}\n{pid}\n{nonce}"
            if not hmac.compare_digest(signature(key, context, body), request.headers.get("X-AS-Signature", "")):
                if request.url.path == "/pair" and invite:
                    invite["attempts"] += 1
                return Response(status_code=401)
            request.state.peer_id, request.state.body = pid, body
            request.state.key, request.state.nonce = key, nonce
            return await call_next(request)

        def reply(request, value):
            raw = encode(value)
            return Response(raw, media_type="application/json", headers={
                "X-AS-Signature": signature(request.state.key, "response\n" + request.state.nonce, raw)})

        def permission(request, name):
            if not self.peer(request.state.peer_id)[name]:
                raise HTTPException(403, "Доступ запрещён в настройках получателя.")

        @app.post("/pair")
        async def pair(request: Request):
            from .lan_models import PairIdentity
            value = PairIdentity(**json.loads(request.state.body))
            if value.id != request.state.peer_id or value.id == self.config["id"]:
                raise HTTPException(422, "Некорректный ID.")
            async with self.lock:
                if not self.invitation or self.invitation["key"] != request.state.key:
                    raise HTTPException(409, "Приглашение уже использовано.")
                session_key = secrets.token_hex(32)
                self.invitation = None
                self.config["peers"][value.id] = self._new_peer(request.client.host, value.name, session_key)
                await self._save()
            self.presence[value.id] = {"online": True, "error": "", "lastSeen": int(time.time() * 1000)}
            return reply(request, {"id": self.config["id"], "name": self.config["name"], "key": session_key})

        @app.get("/state")
        async def state(request: Request):
            peer = self.peer(request.state.peer_id)
            return reply(request, {"id": self.config["id"], "name": self.config["name"],
                                   "saves": peer["saves"], "media": peer["media"], "control": peer["control"],
                                   "player": self.player if peer["control"] and time.monotonic() - self.player_at < 6 else {},
                                   "results": self.command_results if peer["control"] else {}})

        @app.get("/save")
        async def save(request: Request):
            permission(request, "saves")
            doc = await self.storage.read()
            return reply(request, save_data(doc) if doc else None)

        @app.get("/library")
        async def library(request: Request):
            permission(request, "media")
            result = await self.library.library()
            return reply(request, {"anime": result["anime"]})

        @app.get("/episode/{episode_id}")
        async def episode(request: Request, episode_id: str):
            permission(request, "media")
            from .lan_transfer import export_episode
            return reply(request, await export_episode(self.library, episode_id))

        @app.get("/file/{episode_id}/{kind}")
        async def media(request: Request, episode_id: str, kind: str):
            permission(request, "media")
            from .lan_transfer import export_path
            path = await export_path(self.library, episode_id, kind)

            async def chunks():
                with path.open("rb") as stream:
                    while self.config["enabled"] and not (self.server and self.server.should_exit):
                        if not self.config["peers"].get(request.state.peer_id, {}).get("media"):
                            return
                        chunk = await asyncio.to_thread(stream.read, 1024 * 1024)
                        if not chunk:
                            return
                        yield chunk

            return StreamingResponse(chunks(), media_type="application/octet-stream")

        @app.post("/control")
        async def control(request: Request):
            return reply(request, self.enqueue_command(request.state.peer_id, json.loads(request.state.body)))
