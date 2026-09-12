"""Safety tests for the shared atomic profile storage."""

from __future__ import annotations

import asyncio
from pathlib import Path
import tempfile
import unittest

from backend.app.services.storage import JsonStorage, validate_storage_document


def document(profile_id: str, marker: int) -> dict[str, object]:
    return {
        "schemaVersion": 3,
        "updatedAt": f"2026-08-24T12:00:0{marker}Z",
        "activeProfile": profile_id,
        "profiles": [{"id": profile_id, "name": "Main", "snapshot": {"marker": marker}}],
    }


class StorageValidationTests(unittest.TestCase):
    def test_rejects_empty_or_malformed_restore_documents(self) -> None:
        self.assertFalse(validate_storage_document({}))
        self.assertFalse(validate_storage_document({"profiles": []}))
        self.assertFalse(validate_storage_document({"profiles": [{"id": "p1"}]}))
        self.assertTrue(validate_storage_document(document("p1", 1)))


class JsonStorageSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_instances_share_atomic_replacement_and_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            first = JsonStorage(Path(temporary))
            second = JsonStorage(Path(temporary))

            await asyncio.gather(
                first.write(document("p1", 1)),
                second.write(document("p2", 2)),
            )

            saved = await first.read()
            self.assertTrue(validate_storage_document(saved))
            self.assertFalse(list(Path(temporary).glob("*.tmp")))

            original = first.file.read_bytes()
            backup = await second.replace_with_backup(
                document("p3", 3),
                "before-cloud-restore",
            )
            self.assertIsNotNone(backup)
            self.assertEqual(backup.read_bytes(), original)
            self.assertEqual((await first.read())["activeProfile"], "p3")


if __name__ == "__main__":
    unittest.main()
