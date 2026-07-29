"""Regression tests for storage compatibility and watch-party parity."""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from backend.app.services.storage import JsonStorage
from backend.app.services.watch_party import WATCH_PARTY_PROTOCOL, WatchPartyService
from tools.transfer_saves import copy_document


def portable_document() -> dict[str, object]:
    return {
        "schemaVersion": 3,
        "activeProfile": "main",
        "profiles": [
            {
                "id": "main",
                "name": "Основной",
                "snapshot": {
                    "version": 3,
                    "progress": {"42": {"1": {"1": {"time": 93.5}}}},
                    "futureFeature": {"mustSurvive": True},
                },
            }
        ],
        "futureEnvelopeField": ["preserve", 7],
    }


class StorageTests(unittest.TestCase):
    def test_round_trip_preserves_profiles_and_unknown_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = JsonStorage(Path(directory))
            document = portable_document()
            asyncio.run(storage.write(document))
            self.assertEqual(asyncio.run(storage.read()), document)

    def test_first_read_copies_legacy_save_without_changing_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "legacy.json"
            source.write_text(
                __import__("json").dumps(portable_document(), ensure_ascii=False),
                encoding="utf-8",
            )
            original = source.read_bytes()
            storage = JsonStorage(root / "python-data", import_candidates=(source,))
            self.assertEqual(asyncio.run(storage.read()), portable_document())
            self.assertEqual(source.read_bytes(), original)

    def test_bidirectional_transfer_preserves_future_fields_and_creates_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy = root / "legacy.json"
            python = root / "python.json"
            legacy.write_text(
                __import__("json").dumps(portable_document(), ensure_ascii=False),
                encoding="utf-8",
            )
            python.write_text(
                __import__("json").dumps(
                    {
                        "schemaVersion": 3,
                        "activeProfile": "old",
                        "profiles": [],
                    }
                ),
                encoding="utf-8",
            )
            _, backup = copy_document(legacy, python)
            self.assertIsNotNone(backup)
            self.assertEqual(__import__("json").loads(python.read_text("utf-8")), portable_document())

            returned = root / "returned.json"
            copy_document(python, returned)
            self.assertEqual(__import__("json").loads(returned.read_text("utf-8")), portable_document())


class WatchPartyTests(unittest.TestCase):
    def test_all_authority_modes_and_host_transfer_match_legacy_protocol(self) -> None:
        async def scenario() -> None:
            manager = WatchPartyService()
            created = await manager.create("Host", "host")
            joined = await manager.join(created["roomId"], "Friend", "follow")
            self.assertEqual(created["protocol"], WATCH_PARTY_PROTOCOL)

            def playback(episode: str, position: float, playing: bool) -> dict[str, object]:
                return {
                    "animeId": 7,
                    "season": 2,
                    "episode": episode,
                    "dub": "AniLibria",
                    "player": "Kodik",
                    "position": position,
                    "duration": 1440,
                    "playing": playing,
                    "updatedAt": 1000,
                }

            await manager.update(
                {
                    "roomId": created["roomId"],
                    "token": created["token"],
                    "mode": "follow",
                    "roomMode": "host",
                    "control": True,
                    "playback": playback("1", 10, True),
                }
            )
            updated = await manager.update(
                {
                    "roomId": created["roomId"],
                    "token": joined["token"],
                    "mode": "follow",
                    "control": True,
                    "playback": playback("2", 20, False),
                    "action": {"type": "play"},
                }
            )
            self.assertEqual(updated, "OK")
            state = manager.state(created["roomId"])
            self.assertEqual(state["playback"]["episode"], "1")
            self.assertEqual(state["last_controller_id"] if "last_controller_id" in state else state["lastControllerId"], created["token"])

            await manager.update(
                {
                    "roomId": created["roomId"],
                    "token": created["token"],
                    "mode": "follow",
                    "roomMode": "shared",
                    "playback": playback("1", 10, True),
                }
            )
            await manager.update(
                {
                    "roomId": created["roomId"],
                    "token": joined["token"],
                    "mode": "follow",
                    "control": True,
                    "playback": playback("3", 81.5, False),
                    "action": {"type": "pause"},
                }
            )
            state = manager.state(created["roomId"])
            self.assertEqual(state["playback"]["episode"], "3")
            self.assertFalse(state["playback"]["playing"])
            self.assertEqual(state["lastControllerId"], joined["token"])
            self.assertEqual(state["lastAction"]["type"], "pause")

            await manager.update(
                {
                    "roomId": created["roomId"],
                    "token": joined["token"],
                    "mode": "free",
                    "control": True,
                    "playback": playback("4", 100, True),
                }
            )
            state = manager.state(created["roomId"])
            self.assertEqual(state["playback"]["episode"], "3")

            result, new_host = await manager.transfer_host(
                created["roomId"], created["token"], joined["token"]
            )
            self.assertEqual(result, "OK")
            self.assertEqual(new_host, joined["token"])
            roles = {item["id"]: item["role"] for item in manager.state(created["roomId"])["participants"]}
            self.assertEqual(roles[joined["token"]], "host")

            await manager.update(
                {
                    "roomId": created["roomId"],
                    "token": joined["token"],
                    "mode": "follow",
                    "roomMode": "host",
                    "control": True,
                    "playback": playback("5", 50, False),
                }
            )
            await manager.update(
                {
                    "roomId": created["roomId"],
                    "token": created["token"],
                    "mode": "follow",
                    "roomMode": "shared",
                    "control": True,
                    "playback": playback("6", 60, True),
                }
            )
            state = manager.state(created["roomId"])
            self.assertEqual(state["roomMode"], "host")
            self.assertEqual(state["playback"]["episode"], "5")

            await manager.leave(created["roomId"], joined["token"])
            state = manager.state(created["roomId"])
            self.assertEqual(
                next(item for item in state["participants"] if item["id"] == created["token"])["role"],
                "host",
            )

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
