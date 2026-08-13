"""Unit tests for Google Drive document merge and OAuth safety logic."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock

from backend.app.services.gdrive import (
    GoogleDriveService,
    merge_storage_documents,
    merge_snapshot,
)


class GDriveMergeTests(unittest.TestCase):
    def test_merge_ratings_keeps_latest_edit_per_anime(self) -> None:
        local = {
            "ratings": {
                "1": {"anime": 7, "seasons": {}, "episodes": {}, "updatedAt": 10},
                "2": {"anime": 8, "seasons": {}, "episodes": {}, "updatedAt": 30},
            }
        }
        cloud = {
            "ratings": {
                "1": {"anime": 9, "seasons": {}, "episodes": {}, "updatedAt": 20},
                "3": {"anime": 6, "seasons": {}, "episodes": {}, "updatedAt": 15},
            }
        }

        merged = merge_snapshot(local, cloud)

        self.assertEqual(merged["ratings"]["1"]["anime"], 9)
        self.assertEqual(merged["ratings"]["2"]["anime"], 8)
        self.assertEqual(merged["ratings"]["3"]["anime"], 6)

    def test_merge_favorites_union(self) -> None:
        local_snap = {"favorites": [1, 2, 3]}
        cloud_snap = {"favorites": [3, 4, 5]}
        merged = merge_snapshot(local_snap, cloud_snap)
        self.assertEqual(merged["favorites"], [1, 2, 3, 4, 5])

    def test_merge_watched_episodes_prefer_watched(self) -> None:
        local_snap = {
            "progress": {
                "100": {
                    "episode": "2",
                    "episodes": {
                        "s1e1": {"completed": True, "time": 120},
                        "s1e2": {"completed": False, "time": 500},
                    },
                }
            }
        }
        cloud_snap = {
            "progress": {
                "100": {
                    "episode": "3",
                    "episodes": {
                        "s1e2": {"completed": True, "time": 1400},
                        "s1e3": {"completed": True, "time": 1440},
                    },
                }
            }
        }

        # With prefer_watched=True
        merged = merge_snapshot(local_snap, cloud_snap, prefer_watched=True)
        eps = merged["progress"]["100"]["episodes"]
        self.assertTrue(eps["s1e1"]["completed"])
        self.assertTrue(eps["s1e2"]["completed"])  # Cloud has it completed -> kept completed!
        self.assertTrue(eps["s1e3"]["completed"])
        self.assertEqual(eps["s1e2"]["time"], 1400)

    def test_merge_documents_combines_profiles(self) -> None:
        local_doc = {
            "schemaVersion": 1,
            "activeProfile": "p1",
            "profiles": [
                {
                    "id": "p1",
                    "name": "Local Profile",
                    "snapshot": {"favorites": [10]},
                }
            ],
        }
        cloud_doc = {
            "schemaVersion": 1,
            "activeProfile": "p1",
            "profiles": [
                {
                    "id": "p1",
                    "name": "Cloud Profile",
                    "snapshot": {"favorites": [20]},
                },
                {
                    "id": "p2",
                    "name": "Only Cloud Profile",
                    "snapshot": {"favorites": [30]},
                },
            ],
        }

        merged = merge_storage_documents(local_doc, cloud_doc, prefer_watched=True)
        self.assertEqual(len(merged["profiles"]), 2)
        p1 = next(p for p in merged["profiles"] if p["id"] == "p1")
        self.assertEqual(p1["snapshot"]["favorites"], [10, 20])
        p2 = next(p for p in merged["profiles"] if p["id"] == "p2")
        self.assertEqual(p2["snapshot"]["favorites"], [30])

    def test_newer_document_controls_collections_without_losing_progress(self) -> None:
        local_doc = {
            "schemaVersion": 2,
            "updatedAt": "2026-08-08T12:00:00Z",
            "activeProfile": "p1",
            "profiles": [{
                "id": "p1",
                "name": "Main",
                "snapshot": {
                    "favorites": [10],
                    "folders": [],
                    "tracked": [],
                    "progress": {
                        "10": {
                            "title": "Readable title",
                            "episodes": {
                                "1:1": {
                                    "position": 30,
                                    "duration": 1440,
                                    "updatedAt": 200,
                                }
                            },
                        }
                    },
                    "animeTitles": {"10": "Readable title"},
                },
            }],
        }
        cloud_doc = {
            "schemaVersion": 2,
            "updatedAt": "2026-08-08T11:00:00Z",
            "activeProfile": "p1",
            "profiles": [{
                "id": "p1",
                "name": "Main",
                "snapshot": {
                    "favorites": [10, 20],
                    "folders": [{"id": "deleted", "name": "Old", "animeIds": [20]}],
                    "tracked": [{"animeId": 20, "knownEpisodes": 1}],
                    "progress": {
                        "10": {
                            "episodes": {
                                "1:2": {
                                    "position": 50,
                                    "duration": 1440,
                                    "updatedAt": 100,
                                }
                            },
                        }
                    },
                },
            }],
        }

        merged = merge_storage_documents(local_doc, cloud_doc)
        snapshot = merged["profiles"][0]["snapshot"]
        self.assertEqual(snapshot["favorites"], [10])
        self.assertEqual(snapshot["folders"], [])
        self.assertEqual(snapshot["tracked"], [])
        self.assertEqual(set(snapshot["progress"]["10"]["episodes"]), {"1:1", "1:2"})
        self.assertEqual(snapshot["animeTitles"]["10"], "Readable title")

    def test_latest_episode_update_controls_resume_position(self) -> None:
        local = {
            "progress": {
                "5": {
                    "episodes": {
                        "1:1": {"position": 40, "duration": 100, "updatedAt": 20}
                    }
                }
            }
        }
        cloud = {
            "progress": {
                "5": {
                    "episodes": {
                        "1:1": {"position": 90, "duration": 100, "updatedAt": 10}
                    }
                }
            }
        }

        merged = merge_snapshot(local, cloud)
        self.assertEqual(merged["progress"]["5"]["episodes"]["1:1"]["position"], 40)

    def test_get_auth_url_valid_format(self) -> None:
        from pathlib import Path
        from backend.app.services.gdrive import GoogleDriveService
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            svc = GoogleDriveService(Path(tmp))
            svc.save_client_credentials("test-client.apps.googleusercontent.com", "secret")
            url, state = svc.get_auth_url("http://127.0.0.1:8000/api/gdrive/oauth2callback")
            self.assertIn("client_id=test-client.apps.googleusercontent.com", url)
            self.assertNotIn("client_id=client_id=", url)
            self.assertIn("response_type=code", url)
            self.assertIn(f"state={state}", url)
            self.assertTrue(svc.consume_oauth_state(state))
            self.assertFalse(svc.consume_oauth_state(state))

    def test_saving_client_id_preserves_omitted_secret(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = GoogleDriveService(Path(tmp))
            service.save_client_credentials("old.apps.googleusercontent.com", "existing-secret")

            service.save_client_credentials("new.apps.googleusercontent.com", None)

            client_id, client_secret = service.get_client_credentials()
            self.assertEqual(client_id, "new.apps.googleusercontent.com")
            self.assertEqual(client_secret, "existing-secret")

            service.save_client_credentials("newer.apps.googleusercontent.com", "   ")

            client_id, client_secret = service.get_client_credentials()
            self.assertEqual(client_id, "newer.apps.googleusercontent.com")
            self.assertEqual(client_secret, "existing-secret")


class GDriveAutosaveTests(unittest.IsolatedAsyncioTestCase):
    async def test_schedule_write_compares_document_timestamps(self) -> None:
        """Autosave must not fail when it compares queued and current saves."""

        with tempfile.TemporaryDirectory() as tmp:
            service = GoogleDriveService(Path(tmp))
            document = {
                "schemaVersion": 2,
                "updatedAt": "2026-08-11T10:00:00Z",
                "profiles": [],
            }
            local_reader = AsyncMock(return_value=document)
            local_writer = AsyncMock()
            service.read_cloud_storage = AsyncMock(return_value=({}, None))
            service.write_cloud_storage = AsyncMock(return_value="cloud-file")

            service.schedule_write(
                document,
                local_reader=local_reader,
                local_writer=local_writer,
            )
            self.assertIsNotNone(service._sync_task)
            await service._sync_task

            self.assertEqual(service.last_sync_error, "")
            service.write_cloud_storage.assert_awaited_once()
            local_writer.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
