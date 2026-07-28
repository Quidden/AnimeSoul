"""Small regression tests for state that must survive frontend refactoring."""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from backend.app.services.storage import JsonStorage
from backend.app.services.watch_party import WatchPartyService


class StorageTests(unittest.TestCase):
    def test_round_trip_preserves_profiles(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = JsonStorage(Path(directory))
            document = {"schemaVersion": 1, "activeProfile": "main", "profiles": []}
            asyncio.run(storage.write(document))
            self.assertEqual(asyncio.run(storage.read()), document)


class WatchPartyTests(unittest.TestCase):
    def test_guest_can_join_and_host_can_update_playback(self) -> None:
        async def scenario() -> None:
            manager = WatchPartyService()
            created = await manager.create("Host")
            joined = await manager.join(created["roomId"], "Friend", "follow")
            updated = await manager.update({
                "roomId": created["roomId"],
                "token": created["token"],
                "playback": {"animeId": 7, "season": 2, "episode": "3", "time": 81.5},
            })
            self.assertEqual(joined["roomId"], created["roomId"])
            self.assertTrue(updated)
            state = manager.state(created["roomId"])
            self.assertEqual(state["playback"]["episode"], "3")
            self.assertEqual(len(state["participants"]), 2)

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
