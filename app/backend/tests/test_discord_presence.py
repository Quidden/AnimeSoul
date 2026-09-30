import asyncio
import json
import struct
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.api.discord_presence import router
from backend.app.services.discord_presence import (
    DiscordPipe, Playback, Preferences, PresenceService, Update, activity_for,
)


class ActivityTests(unittest.TestCase):
    def update(self, **preferences):
        return Update(session="test", preferences=Preferences(enabled=True, **preferences),
                      playback=Playback(title="Аниме", season="Сезон 2", episode="Серия 5",
                                        position=754, duration=1450, playing=True))

    def test_privacy_and_layout(self):
        update = self.update(title=False, season=False, episode=False, logo=False, time="off")
        activity = activity_for(update, 2000)
        self.assertEqual(activity, {"type": 3, "details": "Смотрит аниме", "status_display_type": 0})
        activity = activity_for(self.update(layout="episode-first", time="text"), 2000)
        self.assertEqual(activity["state"], "Аниме")
        self.assertIn("12:34 / 24:10", activity["details"])

    def test_member_list_displays_anime_independent_of_card_layout(self):
        for preferences in [{}, {"layout": "episode-first"},
                            {"layout": "episode-first", "season": False, "episode": False}]:
            with self.subTest(preferences=preferences):
                update = self.update(**preferences)
                activity = activity_for(update, 2000)
                field = {1: "state", 2: "details"}[activity["status_display_type"]]
                self.assertEqual(activity[field], "Аниме")
                update.playback.title = "Другое аниме"
                activity = activity_for(update, 2000)
                self.assertEqual(activity[field], "Другое аниме")
        update.playback = None
        self.assertEqual(activity_for(update, 2000)["status_display_type"], 0)
        self.assertEqual(activity_for(self.update(title=False), 2000)["status_display_type"], 0)

    def test_seek_pause_and_idle(self):
        update = self.update()
        self.assertEqual(activity_for(update, 2000)["timestamps"], {"start": 1246})
        update.playback.position = 100
        self.assertEqual(activity_for(update, 2000)["timestamps"], {"start": 1900})
        update.preferences.time = "remaining"
        self.assertEqual(activity_for(update, 2000)["timestamps"], {"end": 3350})
        update.playback.playing = False
        self.assertNotIn("timestamps", activity_for(update, 2000))
        update.preferences.paused = "hide"
        self.assertIsNone(activity_for(update, 2000))
        update.playback = None
        self.assertEqual(activity_for(update, 2000)["details"], "В библиотеке")
        update.preferences.idle = False
        self.assertIsNone(activity_for(update, 2000))
        self.assertIsNone(activity_for(Update(session="test"), 2000))

    def test_invalid_values(self):
        for value in [float("nan"), float("inf"), -1]:
            with self.assertRaises(ValidationError):
                Playback(position=value)
        with self.assertRaises(ValidationError):
            Preferences(applicationId="not-a-token")

    def test_app_timer_survives_text_updates_pause_and_library(self):
        update = self.update(time="text")
        for now in [2000, 2015, 2030]:
            update.playback.position += 15
            self.assertEqual(activity_for(update, now, 1900)["timestamps"], {"start": 1900})
        update.playback.playing = False
        self.assertEqual(activity_for(update, 2045, 1900)["timestamps"], {"start": 1900})
        update.playback = None
        self.assertEqual(activity_for(update, 2060, 1900)["timestamps"], {"start": 1900})
        update.preferences.time = "off"
        self.assertNotIn("timestamps", activity_for(update, 2075, 1900))
        self.assertEqual(activity_for(self.update(), 2000, 1900)["timestamps"], {"start": 1246})

    def test_local_api_boundary(self):
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app, base_url="http://localhost", client=("127.0.0.1", 1234))
        self.assertEqual(client.get("/api/discord/status").status_code, 200)
        self.assertEqual(client.get("/api/discord/status", headers={"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(client.get("/api/discord/status", headers={"Host": "public.example"}).status_code, 403)
        remote = TestClient(app, base_url="http://localhost", client=("192.168.1.2", 1234))
        self.assertEqual(remote.get("/api/discord/status").status_code, 403)


class PipeTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_keeps_start_across_updates_and_deduplicates_idle(self):
        service = PresenceService()
        service._update = Update(session="test", preferences=Preferences(enabled=True, time="text"))
        tick = 0
        service._received = 100
        updates = []

        class FakePipe:
            async def connect(self, app_id):
                pass
            def connected(self):
                return True
            async def update(self, activity):
                if activity is not None:
                    updates.append(activity)
            def close(self):
                pass

        async def advance(_delay):
            nonlocal tick
            tick += 1
            service._received = 100 + tick * 15
            if tick in (2, 3):
                service._update.playback = Playback(title="Аниме", position=tick * 15, playing=True)
            if tick == 4:
                service._stop.set()

        clock = SimpleNamespace(monotonic=lambda: 100 + tick * 15, time=lambda: 2000 + tick * 15)
        runtime = SimpleNamespace(sleep=advance, wait_for=asyncio.wait_for)
        module = "backend.app.services.discord_presence"
        with patch(f"{module}.DiscordPipe", FakePipe), patch(f"{module}.time", clock), patch(f"{module}.asyncio", runtime):
            await service._run()
        # Two idle heartbeats produce one update; changing video time still
        # updates the text without restarting the application's elapsed timer.
        self.assertEqual(len(updates), 3)
        self.assertEqual([value["timestamps"] for value in updates], [{"start": 2000}] * 3)
        self.assertNotEqual(updates[1]["state"], updates[2]["state"])

    async def test_unicode_frames_ping_and_nonce(self):
        pipe = DiscordPipe()
        pipe.reader = asyncio.StreamReader()
        frames = []

        def feed(opcode, data):
            raw = json.dumps(data).encode()
            frame = struct.pack("<II", opcode, len(raw)) + raw
            pipe.reader.feed_data(frame[:3])
            pipe.reader.feed_data(frame[3:])

        class Transport:
            def write(self, frame):
                opcode, length = struct.unpack("<II", frame[:8])
                self_outer.assertEqual(length, len(frame[8:]))
                data = json.loads(frame[8:])
                frames.append((opcode, data))
                if opcode == 1:
                    feed(3, {"ping": True})
                    feed(1, {"evt": "OTHER"})
                    feed(1, {"nonce": data["nonce"]})

        self_outer = self
        pipe.transport = Transport()
        await asyncio.wait_for(pipe.update({"details": "Аниме"}), 1)
        self.assertEqual(frames[0][1]["args"]["activity"]["details"], "Аниме")
        self.assertEqual(frames[1], (4, {"ping": True}))

    async def test_service_expiry_and_shutdown(self):
        service = PresenceService()
        service._update = Update(session="test", preferences=Preferences(enabled=True, applicationId="123"))
        import time
        service._received = time.monotonic()
        updates = []

        class FakePipe:
            async def connect(self, app_id):
                pass
            def connected(self):
                return True
            async def update(self, activity):
                updates.append(activity)
            def close(self):
                pass

        with patch("backend.app.services.discord_presence.DiscordPipe", FakePipe):
            task = asyncio.create_task(service._run())
            await asyncio.sleep(.1)
            self.assertEqual(service.status()["state"], "connected")
            service._received -= 46
            await asyncio.sleep(.6)
            self.assertIsNone(updates[-1])
            service._stop.set()
            await task


if __name__ == "__main__":
    unittest.main()
