"""Optional metadata cannot break offline title pages."""
import unittest
from unittest.mock import patch

import httpx

from backend.app.services import shikimori


class ShikimoriTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        shikimori._cache.clear()
        shikimori._last_request = 0

    async def test_redirect_and_cache(self):
        calls = []

        def respond(request):
            calls.append(str(request.url))
            if request.url.host == "shikimori.one":
                return httpx.Response(301, headers={"Location": "https://shikimori.io/api/animes/59193"})
            return httpx.Response(200, json={"id": 59193, "status": "ongoing", "score": "8.5"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond), follow_redirects=True)
        with patch.object(shikimori.httpx, "AsyncClient", return_value=client):
            first = await shikimori.anime_details(59193)
            second = await shikimori.anime_details(59193)
        self.assertEqual(first["id"], 59193)
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 2)

    async def test_offline_preserves_stale_metadata(self):
        shikimori._cache[1] = (0, {"id": 1, "status": "released"})

        def respond(request):
            raise httpx.ConnectError("offline", request=request)

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch.object(shikimori.httpx, "AsyncClient", return_value=client):
            self.assertEqual(await shikimori.anime_details(1), {"id": 1, "status": "released"})

    async def test_missing_metadata_is_empty(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(404)))
        with patch.object(shikimori.httpx, "AsyncClient", return_value=client):
            self.assertEqual(await shikimori.anime_details(1), {})
