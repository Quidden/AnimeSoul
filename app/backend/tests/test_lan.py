"""LAN authorization, replay protection, offline transfer and save convergence."""
from __future__ import annotations

import asyncio
import hashlib
import json
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from backend.app.services.lan import LanService, save_data
from backend.app.services.lan_models import EpisodeManifest
from backend.app.services.lan_protocol import Challenges, PeerClient, encode, local_address, signature
from backend.app.services.lan_transfer import export_episode, receive, register_episode
from backend.app.services.offline_library import OfflineLibraryService
from backend.app.services.storage import JsonStorage


def document(position, updated, reset=0):
    return {"schemaVersion": 3, "activeProfile": "default", "updatedAt": updated,
            "secret": "never export", "profiles": [{"id": "default", "name": "Основной", "snapshot": {
                "name": "Основной", "playerPrefs": {"private": "local"}, "theme": {"accent": "blue"},
                "fieldUpdatedAt": {"progress": updated, "theme": updated},
                "favorites": [5], "progress": {"5": {"season": 1, "episode": "1", "resetAt": reset,
                    "episodes": {"1:1": {"position": position, "duration": 1200, "updatedAt": updated,
                                            "watched": False}}}}}}]}


def metadata(episode="1"):
    return {"animeId": 5, "title": "Тест / Аниме", "year": 2024, "season": 2, "seasonLabel": "Продолжение",
            "episode": episode, "originAnimeId": 7, "originEpisode": "3", "dubbing": "Озвучка", "quality": 720,
            "duration": 1200, "skips": {"opening": {"time": 0, "length": 90}}}


class ProtocolTests(unittest.TestCase):
    def test_only_lan_literal_addresses(self):
        self.assertEqual(local_address("192.168.1.3"), "192.168.1.3")
        for value in ("127.0.0.1", "8.8.8.8", "localhost", "192.168.1.1:8000", "::1", "169.254.169.254.evil"):
            with self.assertRaises(ValueError):
                local_address(value)

    def test_challenge_is_single_use_and_expiring(self):
        challenges = Challenges()
        token = challenges.issue()
        self.assertTrue(challenges.consume(token))
        self.assertFalse(challenges.consume(token))
        token = challenges.issue()
        challenges.pending[token] = time.monotonic() - 1
        self.assertFalse(challenges.consume(token))

    def test_signatures_bind_context_and_content(self):
        signed = signature("key", "POST\n/control\nid\nnonce", b"play")
        self.assertNotEqual(signed, signature("key", "POST\n/control\nid\nnonce", b"pause"))
        self.assertNotEqual(signed, signature("key", "POST\n/control\nid\nother", b"play"))


class LanTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.library = OfflineLibraryService(self.root)
        self.storage = JsonStorage(self.root)
        self.lan = LanService(self.root, self.storage, self.library)
        await self.lan.load()
        self.lan.config["enabled"] = True
        self.pid = str(uuid.uuid4())
        self.key = "a" * 64
        self.lan.config["peers"][self.pid] = self.lan._new_peer("192.168.1.22", "Телефон", self.key)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.lan.remote_app, client=("192.168.1.22", 5000)),
                                       base_url="http://192.168.1.10")

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.lan.stop()
        self.temp.cleanup()

    async def headers(self, method, path, body=b"", key=None):
        nonce = (await self.client.get("/challenge")).json()["nonce"]
        return {"X-AS-Device": self.pid, "X-AS-Nonce": nonce,
                "X-AS-Signature": signature(key or self.key, f"{method}\n{path}\n{self.pid}\n{nonce}", body)}

    async def request(self, method, path, payload=None):
        raw = encode(payload) if payload is not None else b""
        return await self.client.request(method, path, content=raw, headers=await self.headers(method, path, raw))

    async def test_listener_has_no_general_storage_routes_and_requires_pairing(self):
        self.assertEqual((await self.client.get("/save")).status_code, 401)
        self.assertEqual((await self.request("GET", "/api/storage")).status_code, 404)
        self.assertEqual((await self.request("GET", "/docs")).status_code, 404)
        headers = await self.headers("GET", "/state")
        first = await self.client.get("/state", headers=headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers["X-AS-Signature"], signature(self.key, "response\n" + headers["X-AS-Nonce"], first.content))
        self.assertEqual((await self.client.get("/state", headers=headers)).status_code, 401)

    async def test_disabled_and_revoked_devices_cannot_read(self):
        headers = await self.headers("GET", "/state")
        await self.lan.revoke(self.pid)
        self.assertEqual((await self.client.get("/state", headers=headers)).status_code, 401)
        self.lan.config["enabled"] = False
        self.assertEqual((await self.client.get("/challenge")).status_code, 403)

    async def test_pair_invitation_single_use_and_persistent_id(self):
        invite = self.lan.invite()["code"]
        self.assertRegex(invite, r"^[0-9]{4}$")
        body = encode({"id": self.pid, "name": "Телефон"})
        headers = await self.headers("POST", "/pair", body, invite)
        response = await self.client.post("/pair", content=body, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.lan.config["peers"][self.pid]["key"], response.json()["key"])
        self.assertEqual(len(response.json()["key"]), 64)
        self.assertFalse(self.lan.config["peers"][self.pid]["control"])
        replay = await self.headers("POST", "/pair", body, invite)
        self.assertEqual((await self.client.post("/pair", content=body, headers=replay)).status_code, 401)
        other = LanService(self.root, self.storage, self.library)
        await other.load()
        self.assertEqual(other.config["id"], self.lan.config["id"])
        self.assertIn(self.pid, other.config["peers"])

    async def test_short_code_expires_and_limits_guesses(self):
        code = self.lan.invite()["code"]
        body = encode({"id": self.pid, "name": "Телефон"})
        for _ in range(5):
            headers = await self.headers("POST", "/pair", body, "9999" if code != "9999" else "9998")
            self.assertEqual((await self.client.post("/pair", content=body, headers=headers)).status_code, 401)
        headers = await self.headers("POST", "/pair", body, code)
        self.assertEqual((await self.client.post("/pair", content=body, headers=headers)).status_code, 401)
        self.lan.invite()
        self.lan.invitation["expires"] = time.monotonic() - 1
        headers = await self.headers("POST", "/pair", body, self.lan.invitation["key"])
        self.assertEqual((await self.client.post("/pair", content=body, headers=headers)).status_code, 401)

    async def test_two_devices_share_permanent_key_after_code_pairing(self):
        with tempfile.TemporaryDirectory() as local_dir:
            root = Path(local_dir)
            local = LanService(root, JsonStorage(root), OfflineLibraryService(root))
            await local.load()
            local.config["enabled"] = True
            code = self.lan.invite()["code"]
            original = httpx.AsyncClient

            def routed_client(*args, **kwargs):
                kwargs["transport"] = httpx.ASGITransport(
                    app=self.lan.remote_app, client=("192.168.1.33", 5000))
                return original(*args, **kwargs)

            with patch("backend.app.services.lan_protocol.httpx.AsyncClient", side_effect=routed_client):
                result = await local.pair("192.168.1.10", code)
            remote_id = self.lan.config["id"]
            local_id = local.config["id"]
            self.assertTrue(result["peers"][0]["online"])
            self.assertEqual(local.config["peers"][remote_id]["key"],
                             self.lan.config["peers"][local_id]["key"])
            self.assertEqual(len(local.config["peers"][remote_id]["key"]), 64)

    async def test_save_permissions_and_no_device_secrets(self):
        await self.storage.write(document(100, 1_800_000_000_000))
        response = await self.request("GET", "/save")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("secret", response.text)
        self.assertNotIn("playerPrefs", response.text)
        self.assertNotIn("theme", response.text)
        self.lan.config["peers"][self.pid]["saves"] = False
        self.assertEqual((await self.request("GET", "/save")).status_code, 403)

    async def test_merge_latest_seek_preserves_local_prefs_and_converges(self):
        local = document(800, 1_800_000_000_000)
        remote = document(120, 1_800_000_010_000)
        remote["profiles"][0]["snapshot"]["theme"] = {"accent": "red"}
        self.lan.remote_saves[self.pid] = save_data(remote)
        merged = self.lan.merge(local)
        snapshot = merged["profiles"][0]["snapshot"]
        self.assertEqual(snapshot["progress"]["5"]["episodes"]["1:1"]["position"], 120)
        self.assertEqual(snapshot["theme"], {"accent": "blue"})
        self.assertEqual(merged["activeProfile"], "default")
        self.assertEqual(self.lan.merge(merged), merged)
        # A newer Drive/local revision must beat a stale network copy.
        newer = document(30, 1_800_000_020_000)
        self.assertEqual(self.lan.merge(newer)["profiles"][0]["snapshot"]["progress"]["5"]["episodes"]["1:1"]["position"], 30)
        self.assertEqual(local, document(800, 1_800_000_000_000))

    async def test_merge_reset_and_disabled_peer(self):
        remote = document(1000, 1_800_000_000_000)
        remote["profiles"][0]["snapshot"]["progress"]["5"]["episodes"]["1:1"]["watched"] = True
        local = document(0, 1_800_000_010_000, reset=1_800_000_010_000)
        self.lan.remote_saves[self.pid] = save_data(remote)
        merged = self.lan.merge(local)
        episodes = merged["profiles"][0]["snapshot"]["progress"]["5"]["episodes"]
        self.assertEqual(episodes, {})
        self.lan.config["peers"][self.pid]["saves"] = False
        self.assertEqual(self.lan.merge(local), local)

    async def test_latest_drive_file_joins_lan_merge_without_overwriting_live_edits(self):
        local = document(50, 1_800_000_020_000)
        drive = document(100, 1_800_000_010_000)
        drive["profiles"][0]["snapshot"]["progress"]["6"] = {"episodes": {"1:1": {"position": 20, "updatedAt": 1_800_000_030_000}}}
        drive["profiles"][0]["snapshot"]["historyClearedAt"] = 1_800_000_030_000
        self.lan.remote_saves[self.pid] = save_data(document(800, 1_800_000_000_000))
        merged = self.lan.merge(local, drive)
        snapshot = merged["profiles"][0]["snapshot"]
        self.assertEqual(snapshot["progress"]["5"]["episodes"]["1:1"]["position"], 50)
        self.assertIn("6", snapshot["progress"])
        self.assertEqual(snapshot["historyClearedAt"], 1_800_000_030_000)

    async def test_administration_rejects_remote_clients_and_host_origin_rebinding(self):
        from backend.app.api.lan import router
        app = FastAPI()
        app.include_router(router)
        with patch("backend.app.api.lan.lan", self.lan):
            for client_host, base, origin, expected in (
                ("192.168.1.22", "http://127.0.0.1", "http://127.0.0.1", 403),
                ("127.0.0.1", "http://evil.example", "http://evil.example", 403),
                ("127.0.0.1", "http://127.0.0.1", "https://evil.example", 403),
                ("127.0.0.1", "http://127.0.0.1", "http://127.0.0.1", 200),
            ):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(client_host, 5000)), base_url=base) as client:
                    response = await client.get("/api/lan/status", headers={"Origin": origin})
                    self.assertEqual(response.status_code, expected)

    async def test_control_permissions_priority_ack_and_expiry(self):
        self.lan.poll({}, False, [])
        self.assertEqual((await self.request("POST", "/control", {"action": "play"})).status_code, 403)
        self.lan.config["peers"][self.pid]["control"] = True
        self.lan.poll({}, True, [])
        self.assertEqual((await self.request("POST", "/control", {"action": "play"})).status_code, 409)
        self.lan.local_activity = 0
        response = await self.request("POST", "/control", {"action": "play"})
        self.assertEqual(response.status_code, 200)
        cid = response.json()["id"]
        self.assertEqual(len(self.lan.poll({}, False, [])["commands"]), 1)
        self.assertEqual(self.lan.poll({}, False, [{"id": cid, "error": ""}])["commands"], [])
        other_id = str(uuid.uuid4())
        self.lan.config["peers"][other_id] = {**self.lan.config["peers"][self.pid], "priority": 0}
        with self.assertRaises(Exception) as caught:
            self.lan.enqueue_command(other_id, {"action": "pause"})
        self.assertEqual(caught.exception.status_code, 409)
        self.lan.config["peers"][other_id]["priority"] = 1
        self.lan.enqueue_command(other_id, {"action": "pause"})
        self.lan.commands[0]["expires"] = time.monotonic() - 1
        self.assertEqual(self.lan.poll({}, False, [])["commands"], [])
        self.assertEqual((await self.request("POST", "/control", {"action": "execute"})).status_code, 422)

    async def test_transfer_registers_metadata_assets_and_deduplicates(self):
        directory = await self.library._directory()
        source = self.root / "video.mp4"
        source.write_bytes(b"fake mp4 content")
        art = self.root / "poster.jpg"
        art.write_bytes(b"art")
        manifest = EpisodeManifest(episode=metadata(), files={
            "media": {"size": source.stat().st_size, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()},
            "poster": {"size": 3, "sha256": hashlib.sha256(b"art").hexdigest()}})
        eid = await register_episode(self.library, manifest, {"media": source, "poster": art}, directory)
        anime = await self.library.anime(5)
        row = anime["episodes"][0]
        self.assertEqual(row["originAnimeId"], 7)
        self.assertEqual(row["originEpisode"], "3")
        self.assertEqual(row["seasonLabel"], "Продолжение")
        self.assertEqual((await self.library.media_path(eid)).read_bytes(), b"fake mp4 content")
        exported = await export_episode(self.library, eid)
        self.assertNotIn("file", exported["episode"])
        self.assertEqual(exported["files"]["media"]["sha256"], manifest.files["media"].sha256)
        self.assertEqual(await register_episode(self.library, manifest, {}, directory), eid)
        self.assertEqual(len((await self.library.anime(5))["episodes"]), 1)

    async def test_concurrent_first_library_access_creates_one_valid_index(self):
        directories = await asyncio.gather(*(self.library._directory() for _ in range(25)))
        self.assertEqual(len(set(directories)), 1)
        index = await self.library._read_index(directories[0])
        self.assertEqual(index, {"version": 1, "episodes": []})

    async def test_stream_receive_rejects_corruption_and_can_retry(self):
        data = b"complete episode"
        manifest = {"episode": metadata(), "files": {"media": {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}}}
        corrupt = True

        def handler(request):
            if request.url.path == "/challenge":
                return httpx.Response(200, json={"nonce": "a" * 48})
            if request.url.path.startswith("/file/"):
                return httpx.Response(200, content=b"truncated" if corrupt else data)
            raw = encode(manifest)
            return httpx.Response(200, content=raw, headers={"X-AS-Signature": signature(self.key, "response\n" + "a" * 48, raw)})

        original_client = httpx.AsyncClient
        def factory(**kwargs):
            return original_client(transport=httpx.MockTransport(handler), **kwargs)
        job = {"id": "transfer", "peerId": self.pid, "completed": 0, "total": 1}
        with patch("backend.app.services.lan_protocol.httpx.AsyncClient", side_effect=factory):
            await receive(self.lan, job, ["a" * 24])
        self.assertEqual(job["status"], "error")
        self.assertIsNone(await self.library.anime(5))
        corrupt = False
        with patch("backend.app.services.lan_protocol.httpx.AsyncClient", side_effect=factory):
            await receive(self.lan, job, ["a" * 24])
        self.assertEqual(job["status"], "completed")
        self.assertEqual(len((await self.library.anime(5))["episodes"]), 1)

    async def test_peer_client_authenticates_actual_asgi_response(self):
        original_client = httpx.AsyncClient
        def factory(**kwargs):
            return original_client(transport=httpx.ASGITransport(app=self.lan.remote_app,
                                                                client=("192.168.1.22", 5000)), **kwargs)
        peer = {**self.lan.config["peers"][self.pid], "host": "192.168.1.10"}
        with patch("backend.app.services.lan_protocol.httpx.AsyncClient", side_effect=factory):
            async with PeerClient(self.pid, peer) as client:
                result = await client.json("GET", "/state")
        self.assertEqual(result["id"], self.lan.config["id"])

    async def test_android_uses_native_publication(self):
        directory = await self.library._directory()
        source = self.root / "source.mp4"
        source.write_bytes(b"mp4")
        manifest = EpisodeManifest(episode=metadata(), files={"media": {"size": 3, "sha256": hashlib.sha256(b"mp4").hexdigest()}})
        with patch("backend.app.services.lan_transfer._is_android_runtime", return_value=True), \
                patch.object(self.library, "_publish_android_video", return_value={"uri": "content://media/42", "path": "/storage/emulated/0/Movies/AnimeSoul/test.mp4"}) as publish:
            eid = await register_episode(self.library, manifest, {"media": source}, directory)
        publish.assert_called_once()
        index = await self.library._read_index(directory)
        row = next(row for row in index["episodes"] if row["id"] == eid)
        self.assertEqual(row["contentUri"], "content://media/42")
        self.assertFalse((directory / row["file"]).exists())


if __name__ == "__main__":
    unittest.main()
