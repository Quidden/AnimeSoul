"""Regression tests for the cross-platform provider response cache."""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from backend.app.services.response_cache import PersistentJsonCache
from backend.app.services.yummy import YummyAnimeGateway


class PersistentResponseCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_sqlite_value_survives_process_cache_and_becomes_stale(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "responses.sqlite3"
            first = PersistentJsonCache(database, "test")
            with patch("backend.app.services.response_cache.time.time", return_value=1000.0):
                await first.set("anime:1", {"title": "Cached"}, ttl=10, stale_ttl=20)

            second = PersistentJsonCache(database, "test")
            with patch("backend.app.services.response_cache.time.time", return_value=1005.0):
                fresh = await second.get("anime:1")
            self.assertIsNotNone(fresh)
            self.assertTrue(fresh.fresh)
            self.assertEqual(fresh.value["title"], "Cached")

            third = PersistentJsonCache(database, "test")
            with patch("backend.app.services.response_cache.time.time", return_value=1015.0):
                stale = await third.get("anime:1")
            self.assertIsNotNone(stale)
            self.assertFalse(stale.fresh)

            fourth = PersistentJsonCache(database, "test")
            with patch("backend.app.services.response_cache.time.time", return_value=1031.0):
                self.assertIsNone(await fourth.get("anime:1"))

    async def test_refresh_uses_cached_yummy_response_when_upstream_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gateway = YummyAnimeGateway("token", Path(directory))
            calls = 0

            async def success(
                _client: object,
                _path: str,
                _params: dict[str, Any] | None = None,
            ) -> Any:
                nonlocal calls
                calls += 1
                return {"anime_id": 7, "title": "Reserve"}

            gateway._request = success  # type: ignore[method-assign]
            expected = await gateway.request("/anime/7")

            async def failure(
                _client: object,
                _path: str,
                _params: dict[str, Any] | None = None,
            ) -> Any:
                nonlocal calls
                calls += 1
                raise RuntimeError("temporary outage")

            gateway._request = failure  # type: ignore[method-assign]
            actual = await gateway.request("/anime/7", refresh=True)
            await gateway.close()

            self.assertEqual(actual, expected)
            self.assertEqual(calls, 2)

    async def test_identical_yummy_requests_share_one_inflight_call(self) -> None:
        gateway = YummyAnimeGateway("token")
        release = asyncio.Event()
        calls = 0

        async def request(
            _client: object,
            _path: str,
            _params: dict[str, Any] | None = None,
        ) -> Any:
            nonlocal calls
            calls += 1
            await release.wait()
            return [{"anime_id": 1}]

        gateway._request = request  # type: ignore[method-assign]
        first = asyncio.create_task(gateway.request("/anime", {"limit": 1}))
        second = asyncio.create_task(gateway.request("/anime", {"limit": 1}))
        await asyncio.sleep(0)
        release.set()
        left, right = await asyncio.gather(first, second)
        await gateway.close()

        self.assertEqual(left, right)
        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
