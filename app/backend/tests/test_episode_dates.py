"""Air dates, upload dates, caching and unavailable-provider regressions."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from backend.app.services.episode_dates import EpisodeDatesGateway, EpisodeDatesUnavailable, episode_air_dates


class EpisodeDatesTests(unittest.IsolatedAsyncioTestCase):
    def test_only_episode_air_dates_are_used_and_calendar_day_is_preserved(self) -> None:
        payload = {"updated_at": "2026-09-10", "data": [
            {"mal_id": 1, "aired": "2018-10-02T00:00:00+09:00"},
            {"mal_id": 2, "aired": "2018-10-09T00:00:00+00:00"},
            {"mal_id": 3, "aired": None, "created_at": "2026-09-10"},
            {"mal_id": 4, "aired": "2026-02-30"},
            {"mal_id": True, "aired": "2026-09-10"},
        ]}
        self.assertEqual(episode_air_dates(payload), {"1": "2018-10-02", "2": "2018-10-09"})

    async def test_identical_requests_share_call_and_cache_keeps_page_boundaries(self) -> None:
        gateway = EpisodeDatesGateway()
        client = AsyncMock()
        client.get.return_value = httpx.Response(200, request=httpx.Request("GET", "https://api.jikan.moe"), json={
            "data": [{"mal_id": 101, "aired": "2026-09-04T00:00:00+00:00"}],
            "pagination": {"has_next_page": True},
        })
        gateway.http.get = AsyncMock(return_value=client)
        one, two = await asyncio.gather(gateway.dates(77, 2), gateway.dates(77, 2))
        self.assertEqual(one, {"dates": {"101": "2026-09-04"}, "hasNextPage": True})
        self.assertEqual(one, two)
        self.assertEqual(await gateway.dates(77, 2), one)
        client.get.assert_awaited_once()
        self.assertEqual(client.get.call_args.kwargs["params"], {"page": 2})

    async def test_outage_uses_persisted_dates_and_throttles_further_requests(self) -> None:
        gateway = EpisodeDatesGateway()
        dates = {"dates": {"1": "2018-10-02"}, "hasNextPage": False}
        with patch("backend.app.services.response_cache.time.time", return_value=100):
            await gateway.cache.set("77:1", dates, ttl=10, stale_ttl=10_000_000_000)
        client = AsyncMock()
        client.get.side_effect = httpx.ConnectError("unavailable")
        gateway.http.get = AsyncMock(return_value=client)
        self.assertEqual(await gateway.dates(77), dates)
        with self.assertRaises(EpisodeDatesUnavailable):
            await gateway.dates(88)
        client.get.assert_awaited_once()

    async def test_unknown_title_returns_no_dates_without_creating_episodes(self) -> None:
        gateway = EpisodeDatesGateway()
        client = AsyncMock()
        client.get.return_value = httpx.Response(404, request=httpx.Request("GET", "https://api.jikan.moe"))
        gateway.http.get = AsyncMock(return_value=client)
        self.assertEqual(await gateway.dates(77), {"dates": {}, "hasNextPage": False})
