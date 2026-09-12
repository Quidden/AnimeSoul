"""Regressions for phantom episodes from fuzzy franchise search results."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from backend.app.services.anime_identity import anime_match_score
from backend.app.services.catalog import HybridCatalogueService, merge_catalogues
from backend.app.services.kodik import KodikAnimeGateway, kodik_releases_to_videos
from backend.app.services.kodik_helpers import _episode_link_from_results
from backend.app.services.kodik_resolver import KodikSourceResolver


def release(shikimori_id: int, title: str, count: int = 21, *, movie: bool = False) -> dict:
    return {
        "id": f"{'movie' if movie else 'serial'}-{shikimori_id}",
        "shikimori_id": str(shikimori_id),
        "kinopoisk_id": "1224030",
        "title": title,
        "type": "anime" if movie else "anime-serial",
        "translation": {"id": 610, "title": "AniLibria.TV"},
        "link": f"//kodik.info/{'video' if movie else 'serial'}/{shikimori_id}/hash/720p",
        "material_data": {"duration": 90 if movie else 24},
        "seasons": {} if movie else {"4": {"episodes": {
            str(number): {"link": f"//kodik.info/seria/{shikimori_id}-{number}/hash/720p"}
            for number in range(1, count + 1)
        }}},
    }


UPCOMING = {
    "anime_id": 25629,
    "title": "О моём перерождении в слизь 4 | Часть 2",
    "original": "Ранобэ",
    "remote_ids": {"shikimori_id": 63129, "kp_id": 0},
    "type": {"alias": "tv"},
}
CURRENT = {**UPCOMING, "anime_id": 15066, "title": "О моём перерождении в слизь 4",
           "remote_ids": {"shikimori_id": 59970, "kp_id": 1224030}}


class EpisodeIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def test_future_part_does_not_append_movie_and_old_episodes_after_episode_21(self) -> None:
        rows = [
            release(59971, "О моём перерождении в слизь: Слёзы синего моря", movie=True),
            release(59970, "О моём перерождении в слизь [ТВ-4]"),
            release(37430, "О моём перерождении в слизь [ТВ-1]", 24),
            release(48583, "Атака титанов [ТВ-4, часть 2]", 12),
        ]
        with tempfile.TemporaryDirectory() as directory:
            kodik = KodikAnimeGateway(Path(directory))
            # Simulate the broad response, including cached search payloads.
            kodik.request = AsyncMock(return_value={"results": rows})
            yummy = AsyncMock()
            yummy.request.side_effect = lambda path: [] if path.endswith("/videos") else (
                CURRENT if path == "/anime/15066" else UPCOMING
            )
            service = HybridCatalogueService(yummy, kodik, Path(directory))
            current, _ = await service.videos(15066)
            future, sources = await service.videos(25629)

        self.assertEqual(len(current["videos"]), 21)
        self.assertTrue(all("/seria/59970-" in video["iframe_url"] for video in current["videos"]))
        self.assertEqual(future["videos"], [])
        self.assertEqual(future["anime"]["title"], UPCOMING["title"])
        self.assertEqual(sources, {"yummy": "ok", "kodik": "ok"})
        self.assertEqual(future["episode_identity_version"], 1)
        self.assertFalse(any(call.args[1].get("title_orig") == "Ранобэ" for call in kodik.request.call_args_list))

    async def test_title_fallback_keeps_exact_title_and_all_its_translations(self) -> None:
        matching = release(77, "Exact title")
        other_voice = {**matching, "id": "serial-78", "translation": {"id": 20, "title": "Other voice"}}
        unrelated = release(88, "Exact title: Movie", movie=True)
        with tempfile.TemporaryDirectory() as directory:
            gateway = KodikAnimeGateway(Path(directory))
            gateway.request = AsyncMock(return_value={"results": [unrelated, matching, other_voice]})
            rows = await gateway.find_for_anime({"title": "Exact title", "type": {"alias": "tv"}})
        self.assertEqual(rows, [matching, other_voice])

    async def test_upload_date_uses_earliest_episode_upload_not_kodik_release_update(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            yummy = AsyncMock()
            uploads = [{"video_id": index, "number": "1", "date": stamp, "iframe_url": "https://player/1",
                        "data": {"dubbing": f"Voice {index}", "player": "Alloha"}}
                       for index, stamp in enumerate([1788537229, 1788530000, 0])]
            yummy.request.side_effect = lambda path: uploads if path.endswith("/videos") else CURRENT
            kodik = AsyncMock()
            kodik.find_for_anime.return_value = [{**release(59970, CURRENT["title"], 2),
                                                  "updated_at": "2026-09-10T12:00:00Z"}]
            service = HybridCatalogueService(yummy, kodik, Path(directory))
            payload, _ = await service.videos(CURRENT["anime_id"])
        first = [video for video in payload["videos"] if video["number"] == "1"]
        self.assertTrue(all(video["episode_added_at"] == 1788530000 for video in first))
        second = next(video for video in payload["videos"] if video["number"] == "2")
        self.assertNotIn("episode_added_at", second)

    async def test_reversible_kodik_only_id_keeps_all_translations(self) -> None:
        rows = [release(77, "Title"), release(88, "Other title")]
        with tempfile.TemporaryDirectory() as directory:
            gateway = KodikAnimeGateway(Path(directory))
            gateway.request = AsyncMock(return_value={"results": rows})
            self.assertEqual(await gateway.find_for_anime(None, anime_id=-77), rows[:1])

    def test_shared_franchise_id_never_merges_different_shikimori_titles(self) -> None:
        older = {**CURRENT, "remote_ids": {"shikimori_id": 37430, "kp_id": 1224030}}
        self.assertEqual(anime_match_score(CURRENT, older), 0)
        self.assertEqual(len(merge_catalogues([CURRENT], [older], 24)), 2)
        self.assertEqual(anime_match_score(
            {"title": "Season 1", "remote_ids": {"kp_id": 1}},
            {"title": "Season 2", "remote_ids": {"kp_id": 1}},
        ), 0)

    def test_adaptation_source_is_not_a_shared_title(self) -> None:
        self.assertEqual(anime_match_score(
            {"title": "One", "original": "Манга", "year": 2026},
            {"title": "Two", "original": "Манга", "year": 2026},
        ), 0)

    def test_title_only_match_respects_year_and_content_type(self) -> None:
        tv = {"title": "Same title", "year": 2026, "type": {"alias": "tv"}}
        self.assertEqual(anime_match_score(tv, {**tv, "year": 2018}), 0)
        self.assertEqual(anime_match_score(tv, {**tv, "type": {"alias": "movie"}}), 0)

    async def test_fresh_metadata_rejects_and_repairs_a_stale_registered_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            yummy = AsyncMock()
            yummy.request.side_effect = lambda path: [] if path.endswith("/videos") else UPCOMING
            kodik = AsyncMock()
            kodik.find_for_anime.return_value = [release(59970, CURRENT["title"])]
            service = HybridCatalogueService(yummy, kodik, Path(directory))
            await service.registry.remember([{**CURRENT, "anime_id": UPCOMING["anime_id"]}])
            payload, _ = await service.videos(UPCOMING["anime_id"])
            remembered = await service.registry.get(UPCOMING["anime_id"])
        self.assertEqual(payload["videos"], [])
        self.assertEqual(remembered["title"], UPCOMING["title"])
        self.assertEqual(remembered["remote_ids"]["shikimori_id"], 63129)

    def test_empty_serial_does_not_fabricate_episode_one_but_movie_stays_playable(self) -> None:
        self.assertEqual(kodik_releases_to_videos([release(77, "Upcoming", 0)]), [])
        movie = kodik_releases_to_videos([release(88, "Movie", movie=True)])
        self.assertEqual(len(movie), 1)
        self.assertEqual(movie[0]["duration"], 5400)

    def test_missing_voice_and_missing_season_do_not_resolve_other_episodes(self) -> None:
        row = release(77, "Current")
        self.assertIsNone(_episode_link_from_results([row], 4, 22, 610))
        self.assertIsNone(_episode_link_from_results([row], 4, 1, 999))
        self.assertIsNone(_episode_link_from_results([row], 4, 1, dubbing="Unavailable"))
        row["seasons"]["1"] = row["seasons"]["4"]
        self.assertIsNone(_episode_link_from_results([row], 5, 1, 610))
        self.assertIn("/seria/", _episode_link_from_results([row], 4, 1, 610))

    async def test_private_resolver_does_not_use_fuzzy_fallback_for_unreleased_part(self) -> None:
        client = AsyncMock()
        response = unittest.mock.MagicMock()
        response.json.return_value = {"results": [release(59970, "О моём перерождении в слизь [ТВ-4]")]}
        client.post.return_value = response
        link = await KodikSourceResolver._official_episode_link(
            client, "public-test", 63129, "shikimori", 5, "1", 610, "AniLibria.TV",
            UPCOMING["title"], "Ранобэ",
        )
        self.assertIsNone(link)


if __name__ == "__main__":
    unittest.main()
