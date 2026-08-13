"""Tests for persistent anonymous community rating aggregation."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient
from fastapi import HTTPException

from backend.app.api import community_ratings as community_ratings_api
from backend.app.main import app
from backend.app.services.community_ratings import CommunityRatingStore


class CommunityRatingStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.store = CommunityRatingStore(Path(self.temporary_directory.name))

    async def asyncTearDown(self) -> None:
        self.temporary_directory.cleanup()

    async def test_aggregates_anime_season_and_episode_votes(self) -> None:
        await self.store.replace(
            "voter-a",
            42,
            "Demo",
            9,
            {"1": 7},
            {"1:1": 10, "1:2": 8},
        )
        await self.store.replace(
            "voter-b",
            42,
            "Demo",
            7,
            {"1": 9},
            {"1:1": 6},
        )

        rating = (await self.store.aggregate([42]))["42"]

        self.assertEqual(rating["anime"], {"average": 8.0, "count": 2})
        self.assertEqual(rating["seasons"]["1"], {"average": 8.0, "count": 2})
        self.assertEqual(rating["episodes"]["1:1"], {"average": 8.0, "count": 2})
        self.assertEqual(rating["episodes"]["1:2"], {"average": 8.0, "count": 1})
        self.assertEqual(rating["title"], "Demo")

    async def test_replacing_and_deleting_a_vote_does_not_duplicate_it(self) -> None:
        await self.store.replace("voter-a", 7, "First", 5, {}, {})
        await self.store.replace("voter-b", 7, "First", 9, {}, {})
        await self.store.replace("voter-a", 7, "Updated", 7, {}, {})

        rating = (await self.store.aggregate([7]))["7"]
        self.assertEqual(rating["anime"], {"average": 8.0, "count": 2})

        await self.store.replace("voter-b", 7, "First", None, {}, {})
        rating = (await self.store.aggregate([7]))["7"]
        self.assertEqual(rating["anime"], {"average": 7.0, "count": 1})

        await self.store.replace("voter-a", 7, "Updated", None, {}, {})
        self.assertEqual(await self.store.aggregate([7]), {})

    async def test_public_export_lists_only_anime_with_votes(self) -> None:
        await self.store.replace("voter-a", 10, "Ten", 8, {}, {})
        await self.store.replace("voter-a", 20, "Twenty", None, {"1": 9}, {})
        await self.store.replace("voter-a", 30, "Deleted", None, {}, {})

        anime_ids = await self.store.list_anime_ids(limit=100, offset=0)

        self.assertEqual(set(anime_ids), {10, 20})
        self.assertEqual(len(await self.store.list_anime_ids(limit=1, offset=0)), 1)


class CommunityRatingApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_store = community_ratings_api.store
        community_ratings_api.store = CommunityRatingStore(
            Path(self.temporary_directory.name)
        )
        self.first_browser = TestClient(app)
        self.second_browser = TestClient(app)

    def tearDown(self) -> None:
        self.first_browser.close()
        self.second_browser.close()
        community_ratings_api.store = self.original_store
        self.temporary_directory.cleanup()

    def test_anonymous_cookie_replaces_vote_and_public_endpoints_return_aggregate(self) -> None:
        first = self.first_browser.put(
            "/api/community-ratings/55",
            json={
                "title": "Public demo",
                "anime": 8,
                "seasons": {"1": 9},
                "episodes": {"1:1": 10},
            },
        )
        self.assertEqual(first.status_code, 200)
        self.assertIn(community_ratings_api.COOKIE_NAME, self.first_browser.cookies)

        second = self.second_browser.put(
            "/api/community-ratings/55",
            json={"title": "Public demo", "anime": 10, "seasons": {}, "episodes": {}},
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["rating"]["anime"], {"average": 9.0, "count": 2})

        replacement = self.first_browser.put(
            "/api/community-ratings/55",
            json={"title": "Public demo", "anime": 6, "seasons": {}, "episodes": {}},
        )
        self.assertEqual(
            replacement.json()["rating"]["anime"],
            {"average": 8.0, "count": 2},
        )

        single = self.first_browser.get("/api/community-ratings/55")
        public_export = self.first_browser.get("/api/community-ratings?limit=10&offset=0")
        bulk = self.first_browser.get("/api/community-ratings?ids=55")

        self.assertEqual(single.json()["rating"]["anime"]["average"], 8.0)
        self.assertEqual(public_export.json()["ratings"]["55"]["anime"]["count"], 2)
        self.assertEqual(bulk.json()["ratings"]["55"]["anime"]["average"], 8.0)

    def test_non_finite_scores_are_rejected(self) -> None:
        with self.assertRaises(HTTPException):
            community_ratings_api._optional_score(float("nan"))


if __name__ == "__main__":
    unittest.main()
