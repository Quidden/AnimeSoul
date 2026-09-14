"""Regressions for single specials polluted by a provider's TV playlist."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from backend.app.services.catalog import HybridCatalogueService
from backend.app.services.episode_links import normalize_episode_links


def video(number, provider_episode=None, source="dub-a", player="Kodik", **extra):
    return {
        "video_id": extra.pop("video_id", 1),
        "number": str(number),
        "iframe_url": f"https://kodik.example/season/{source}?episode={provider_episode}"
        if provider_episode is not None else f"https://other.example/video/{source}",
        "data": {"player": player, "dubbing": source},
        **extra,
    }


SPECIAL = {"anime_id": 11493, "type": {"alias": "special"}, "episodes": {"count": 1}}


class EpisodeLinkTests(unittest.TestCase):
    def test_fitz_keeps_episode_zero_as_one_and_rejects_tv_playlist(self):
        original = video(1, 0, date=1704434892)
        rows = [video(0, 0, date=1787990123), original,
                *[video(n, n) for n in range(1, 13)],
                video(0, 0, "dub-b"), video(1, 1, "dub-b"),
                video(1, source="aksor", player="Aksor")]
        unchanged = copy.deepcopy(rows)
        result = normalize_episode_links(SPECIAL, rows)
        self.assertEqual(len(result["videos"]), 3)
        self.assertEqual({row["number"] for row in result["videos"]}, {"1"})
        self.assertEqual(result["videos"][0], original)
        self.assertEqual(result["videos"][-1]["iframe_url"], rows[-3]["iframe_url"])
        self.assertEqual(set(result["invalidEpisodeNumbers"]), {"0", *map(str, range(2, 13))})
        self.assertEqual(rows, unchanged)

    def test_special_at_end_of_tv_playlist_keeps_provider_number(self):
        rows = [video(1, 24), video(24, 24), video(2, 2)]
        self.assertEqual(normalize_episode_links(SPECIAL, rows)["videos"], rows[:1])

    def test_regular_single_episode_keeps_all_players_and_dubs(self):
        rows = [video(1, 1), video(1, 1, "dub-b"), video(1, source="aksor", player="Aksor")]
        self.assertEqual(normalize_episode_links(SPECIAL, rows)["videos"], rows)

    def test_multi_episode_ova_tv_and_missing_metadata_are_not_truncated(self):
        rows = [video(n, n) for n in range(13, 25)]
        for anime in [{}, {"type": {"alias": "ova"}},
                      {"type": {"alias": "ova"}, "episodes": {"count": 12}},
                      {"type": {"alias": "tv"}, "episodes": {"count": 1}}]:
            with self.subTest(anime=anime):
                self.assertEqual(normalize_episode_links(anime, rows),
                                 {"videos": rows, "invalidEpisodeNumbers": []})


class VideosApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_videos_endpoint_filters_links_for_player_and_tracker(self):
        async def request(path):
            return [video(1, 0), video(2, 2)] if path.endswith("/videos") else SPECIAL

        with tempfile.TemporaryDirectory() as directory:
            yummy = AsyncMock()
            yummy.request.side_effect = request
            kodik = AsyncMock()
            kodik.find_for_anime.return_value = []
            service = HybridCatalogueService(yummy, kodik, Path(directory))
            result, _ = await service.videos(11493)
        self.assertEqual(result["anime"], SPECIAL)
        self.assertEqual(result["videos"], [video(1, 0)])
        self.assertEqual(result["invalidEpisodeNumbers"], ["2"])
