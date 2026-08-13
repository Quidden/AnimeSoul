"""Regression tests for tolerant YummyAnime catalog search."""

from __future__ import annotations

import unittest
from typing import Any

from backend.app.services.yummy import YummyAnimeGateway, anime_search_queries


class SearchQueryTests(unittest.TestCase):
    def test_wrong_keyboard_layout_is_corrected_in_both_directions(self) -> None:
        self.assertIn("наруто", anime_search_queries("yfhenj"))
        self.assertIn("naruto", anime_search_queries("тфкгещ"))

    def test_transliteration_and_common_aliases_are_bounded(self) -> None:
        variants = anime_search_queries("аот")
        self.assertIn("attack on titan", variants)
        self.assertIn("атака титанов", variants)
        self.assertLessEqual(len(variants), 4)

        slang = anime_search_queries("магичка")
        self.assertIn("магическая битва", slang)
        self.assertIn("jujutsu kaisen", slang)


class GatewaySearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_returns_first_useful_variant_and_caches_it(self) -> None:
        gateway = YummyAnimeGateway("test-token")
        calls: list[str] = []

        async def request(
            _client: object,
            _path: str,
            params: dict[str, Any] | None = None,
        ) -> Any:
            query = str((params or {}).get("q", ""))
            calls.append(query)
            if query == "yfhenj":
                return []
            if query == "наруто":
                return [{"anime_id": 2, "title": "Наруто"}]
            return []

        gateway._request = request  # type: ignore[method-assign]
        result = await gateway.search("yfhenj", limit=10)
        first_call_count = len(calls)
        cached = await gateway.search("YFHENJ", limit=10)

        self.assertIn("наруто", calls)
        self.assertEqual([anime["anime_id"] for anime in result], [2])
        self.assertEqual(cached, result)
        self.assertEqual(len(calls), first_call_count)


if __name__ == "__main__":
    unittest.main()
