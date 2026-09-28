"""Ongoing pages must filter before pagination and retain independent offsets."""
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, Response
from backend.app.api import yummy


class OngoingCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_filter_and_offset_are_sent_to_provider(self):
        rows = [{"anime_id": index, "title": f"Ongoing {index}"} for index in range(48)]
        with patch.object(yummy.gateway, "request", AsyncMock(return_value=rows)) as request, \
             patch.object(yummy.catalogue_service.registry, "remember", AsyncMock()) as remember, \
             patch.object(yummy.catalogue_service, "catalogue", AsyncMock()) as general:
            result = await yummy.yummy_proxy(Response(), limit=48, offset=48, status="airing")
        request.assert_awaited_once_with("/anime", {"limit": 48, "offset": 48, "status": "ongoing"}, refresh=False)
        remember.assert_awaited_once_with(rows)
        general.assert_not_awaited()
        self.assertTrue(result["hasMore"])
        self.assertEqual(len(result["anime"]), 48)

    async def test_end_and_search(self):
        with patch.object(yummy.gateway, "request", AsyncMock(return_value=[])) as request, \
             patch.object(yummy.catalogue_service.registry, "remember", AsyncMock()):
            result = await yummy.yummy_proxy(Response(), limit=48, offset=96, status="airing", q="  test  ")
        self.assertFalse(result["hasMore"])
        self.assertEqual(request.call_args.args[1]["q"], "test")

    async def test_provider_failure_is_not_an_empty_success(self):
        with patch.object(yummy.gateway, "request", AsyncMock(side_effect=RuntimeError("unavailable"))):
            with self.assertRaises(HTTPException) as raised:
                await yummy.yummy_proxy(Response(), limit=48, offset=0, status="airing")
        self.assertEqual(raised.exception.status_code, 503)
