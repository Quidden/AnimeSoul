"""Unit tests for Google Drive document merge and OAuth safety logic."""

from __future__ import annotations

import unittest
from backend.app.services.gdrive import merge_storage_documents, merge_snapshot


class GDriveMergeTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
