"""Regression tests for the bidirectional YummyAnime/Kodik reserve."""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from backend.app.services.catalog import (
    HybridCatalogueService,
    merge_catalogues,
    merge_missing_fields,
    merge_videos,
)
from backend.app.services.kodik import (
    kodik_lookup_from_anime_id,
    kodik_release_to_anime,
    kodik_releases_to_videos,
)
from backend.app.services.kodik_helpers import _episode_link_from_results


def kodik_release(
    *,
    translation: str = "AniLibria",
    translation_id: int = 10,
    translation_type: str = "voice",
) -> dict[str, Any]:
    return {
        "id": "serial-700",
        "type": "anime-serial",
        "title": "Тестовое аниме",
        "title_orig": "Test Anime",
        "year": 2024,
        "shikimori_id": "77",
        "translation": {"id": translation_id, "title": translation, "type": translation_type},
        "material_data": {
            "anime_description": "Описание из Kodik",
            "anime_poster_url": "//img.example/poster.jpg",
            "anime_genres": ["Экшен", "Приключения"],
            "shikimori_rating": "8.4",
            "anime_status": "ongoing",
            "anime_kind": "tv",
        },
        "seasons": {
            "1": {
                "episodes": {
                    "1": {"link": "//kodik.info/seria/700/hash/720p"},
                    "2": {"link": "//kodik.info/seria/701/hash/720p"},
                },
            },
        },
    }


class CatalogueMergeTests(unittest.TestCase):
    def test_missing_fields_are_filled_recursively_without_overwriting_primary(self) -> None:
        merged = merge_missing_fields(
            {"title": "Yummy title", "description": "", "poster": {"big": "yummy.jpg"}},
            {"title": "Kodik title", "description": "Kodik description", "poster": {"fullsize": "kodik.jpg"}},
        )
        self.assertEqual(merged["title"], "Yummy title")
        self.assertEqual(merged["description"], "Kodik description")
        self.assertEqual(merged["poster"], {"big": "yummy.jpg", "fullsize": "kodik.jpg"})

    def test_catalogue_match_keeps_yummy_id_and_uses_kodik_fields(self) -> None:
        yummy = {
            "anime_id": 501,
            "title": "Тестовое аниме",
            "year": 2024,
            "description": "",
            "remote_ids": {"shikimori_id": 77},
        }
        kodik = kodik_release_to_anime(kodik_release())
        merged = merge_catalogues([yummy], [kodik], 24)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["anime_id"], 501)
        self.assertEqual(merged[0]["description"], "Описание из Kodik")
        self.assertEqual(merged[0]["poster"]["big"], "https://img.example/poster.jpg")

    def test_kodik_only_id_is_stable_and_reversible(self) -> None:
        anime = kodik_release_to_anime(kodik_release())
        self.assertEqual(anime["anime_id"], -77)
        self.assertEqual(kodik_lookup_from_anime_id(anime["anime_id"]), {"shikimori_id": "77"})

    def test_kodik_episodes_fill_broken_yummy_row_and_add_missing_dub(self) -> None:
        broken = {
            "video_id": 1,
            "number": "1",
            "iframe_url": "",
            "data": {"dubbing": "AniLibria", "player": "Kodik"},
        }
        releases = [
            kodik_release(),
            kodik_release(translation="Studio Band", translation_id=20),
        ]
        direct = kodik_releases_to_videos(releases)
        merged = merge_videos([broken], direct)
        repaired = next(item for item in merged if item["number"] == "1" and item["data"]["dubbing"] == "AniLibria")
        self.assertTrue(repaired["iframe_url"].startswith("https://kodik.info/"))
        self.assertTrue(any(item["data"]["dubbing"] == "Studio Band" for item in merged))

    def test_broad_yummy_kodik_row_is_replaced_with_exact_translation_episode(self) -> None:
        broad = {
            "video_id": 1,
            "number": "1",
            "iframe_url": "https://kodik.info/season/55/hash/720p?episode=1",
            "data": {"dubbing": "Озвучка AniLibria", "player": "Плеер Kodik"},
        }
        [exact] = kodik_releases_to_videos([kodik_release()])[:1]
        merged = merge_videos([broad], [exact])

        self.assertEqual(len(merged), 1)
        self.assertIn("/seria/700/", merged[0]["iframe_url"])
        self.assertEqual(merged[0]["data"]["translation_id"], 10)

    def test_anilibria_alias_repairs_broad_link_without_merging_old_voice(self) -> None:
        broad = {
            "video_id": 1, "number": "1",
            "iframe_url": "https://kodik.info/season/55/hash/720p?episode=1",
            "data": {"dubbing": "Озвучка AniLibria", "player": "Плеер Kodik"},
        }
        exact = kodik_releases_to_videos([kodik_release(translation="AniLibria.TV")])[0]
        old = kodik_releases_to_videos([
            kodik_release(translation="AniLibria.TV Old", translation_id=20),
        ])[0]
        merged = merge_videos([broad], [exact, old])
        self.assertEqual(len(merged), 2)
        self.assertIn("/seria/700/", merged[0]["iframe_url"])
        self.assertEqual(merged[0]["data"]["translation_id"], 10)
        self.assertEqual(merged[1]["data"]["dubbing"], "AniLibria.TV Old")

    def test_private_episode_lookup_accepts_alias_but_rejects_other_translation(self) -> None:
        current = kodik_release(translation="AniLibria.TV")
        old = kodik_release(translation="AniLibria.TV Old", translation_id=20)
        self.assertEqual(
            _episode_link_from_results([old, current], 1, "1", dubbing="Озвучка AniLibria"),
            "//kodik.info/seria/700/hash/720p",
        )
        self.assertIsNone(_episode_link_from_results([old], 1, "1", dubbing="AniLibria"))
        self.assertIsNone(_episode_link_from_results([current], 1, "1", translation_id=20, dubbing="AniLibria"))

    def test_voice_and_subtitle_translations_remain_separate(self) -> None:
        direct = kodik_releases_to_videos([
            kodik_release(translation="Crunchyroll", translation_id=11),
            kodik_release(
                translation="Crunchyroll.Subtitles",
                translation_id=12,
                translation_type="subtitles",
            ),
        ])
        merged = merge_videos([], direct)

        kinds = {item["data"]["translation_type"] for item in merged if item["number"] == "1"}
        self.assertEqual(kinds, {"voice", "subtitles"})


class HybridServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_detail_batch_starts_each_reserve_without_waiting_for_siblings(self) -> None:
        blocked = asyncio.Event()
        reserve_started = asyncio.Event()

        class Yummy:
            async def request(self, path, **kwargs):
                if path == "/anime/502":
                    await blocked.wait()
                return {"anime_id": int(path.rsplit("/", 1)[1]), "title": "Тестовое аниме"}

        class Kodik:
            async def find_for_anime(self, anime, **kwargs):
                if kwargs["anime_id"] == 501:
                    reserve_started.set()
                return [kodik_release()]

        with tempfile.TemporaryDirectory() as directory:
            service = HybridCatalogueService(Yummy(), Kodik(), Path(directory))
            task = asyncio.create_task(service.details(["501", "502"]))
            try:
                await asyncio.wait_for(reserve_started.wait(), .5)
            finally:
                blocked.set()
                anime, sources = await task
            self.assertEqual([item["anime_id"] for item in anime], [501, 502])
            self.assertEqual(sources, {"yummy": "ok", "kodik": "ok"})

    async def test_cached_details_start_both_sources_before_either_finishes(self) -> None:
        release = asyncio.Event()
        reserve_started = asyncio.Event()

        class Yummy:
            async def request(self, path, **kwargs):
                await release.wait()
                return {"anime_id": 501, "title": "Тестовое аниме", "remote_ids": {"shikimori_id": 77}}

        class Kodik:
            async def find_for_anime(self, anime, **kwargs):
                reserve_started.set()
                await release.wait()
                return [kodik_release()]

        with tempfile.TemporaryDirectory() as directory:
            service = HybridCatalogueService(Yummy(), Kodik(), Path(directory))
            await service.registry.remember([{"anime_id": 501, "title": "Тестовое аниме", "remote_ids": {"shikimori_id": 77}}])
            task = asyncio.create_task(service.details(["501"]))
            try:
                await asyncio.wait_for(reserve_started.wait(), .5)
            finally:
                release.set()
                anime, sources = await task
            self.assertEqual(anime[0]["anime_id"], 501)
            self.assertEqual(sources, {"yummy": "ok", "kodik": "ok"})

    async def test_kodik_virtual_ids_never_request_yummy(self) -> None:
        class Yummy:
            async def request(self, *args, **kwargs):
                self.failures += 1
                raise AssertionError("Virtual IDs must never be sent to Yummy")
            failures = 0

        class Kodik:
            async def find_for_anime(self, anime, **kwargs):
                return [kodik_release()]

        with tempfile.TemporaryDirectory() as directory:
            yummy = Yummy()
            service = HybridCatalogueService(yummy, Kodik(), Path(directory))
            anime, sources = await service.details(["-77"])
            payload, video_sources = await service.videos(-77)
            self.assertEqual(anime[0]["anime_id"], -77)
            self.assertEqual(len(payload["videos"]), 2)
            self.assertEqual(sources, {"yummy": "unused", "kodik": "ok"})
            self.assertEqual(video_sources, sources)
            self.assertEqual(yummy.failures, 0)

    async def test_stalled_kodik_does_not_hide_yummy_episodes(self) -> None:
        class ReadyYummy:
            async def request(self, path, **kwargs):
                if path.endswith("/videos"):
                    return [{"video_id": 1, "number": "1", "iframe_url": "https://example.com/video"}]
                return {"anime_id": 501, "title": "Тестовое аниме"}

        class StalledKodik:
            async def find_for_anime(self, anime, **kwargs):
                await asyncio.Event().wait()

        with tempfile.TemporaryDirectory() as directory:
            service = HybridCatalogueService(ReadyYummy(), StalledKodik(), Path(directory))
            with patch("backend.app.services.catalog.VIDEO_PROVIDER_TIMEOUT", .01):
                payload, sources = await asyncio.wait_for(service.videos(501), .5)
            self.assertEqual(sources, {"yummy": "ok", "kodik": "error"})
            self.assertEqual(len(payload["videos"]), 1)

    async def test_stalled_yummy_does_not_hide_kodik_episodes(self) -> None:
        class StalledYummy:
            async def request(self, path, **kwargs):
                await asyncio.Event().wait()

        class ReadyKodik:
            async def find_for_anime(self, anime, **kwargs):
                return [kodik_release()]

        for cached_identity in (False, True):
            with tempfile.TemporaryDirectory() as directory:
                service = HybridCatalogueService(StalledYummy(), ReadyKodik(), Path(directory))
                if cached_identity:
                    await service.registry.remember([{"anime_id": 501, "title": "Тестовое аниме"}])
                with patch("backend.app.services.catalog.VIDEO_PROVIDER_TIMEOUT", .01):
                    payload, sources = await asyncio.wait_for(service.videos(501), .5)
                self.assertEqual(sources, {"yummy": "error", "kodik": "ok"})
                self.assertEqual(len(payload["videos"]), 2)

    async def test_video_sources_start_in_parallel_when_identity_is_cached(self) -> None:
        release = asyncio.Event()
        kodik_started = asyncio.Event()

        class SlowYummy:
            async def request(self, path: str, _params: dict[str, object] | None = None) -> object:
                await release.wait()
                if path.endswith("/videos"):
                    return []
                return {"anime_id": 501, "title": "Тестовое аниме"}

        class SlowKodik:
            async def find_for_anime(
                self,
                _anime: dict[str, Any] | None,
                *,
                anime_id: int | None = None,
                with_episodes: bool = False,
            ) -> list[dict[str, Any]]:
                self.seen = (anime_id, with_episodes)
                kodik_started.set()
                await release.wait()
                return [kodik_release()]

        with tempfile.TemporaryDirectory() as directory:
            service = HybridCatalogueService(SlowYummy(), SlowKodik(), Path(directory))  # type: ignore[arg-type]
            await service.registry.remember([{
                "anime_id": 501,
                "title": "Тестовое аниме",
                "remote_ids": {"shikimori_id": 77},
            }])
            task = asyncio.create_task(service.videos(501))
            await asyncio.wait_for(kodik_started.wait(), .25)
            release.set()
            payload, sources = await asyncio.wait_for(task, 1)

            self.assertEqual(sources, {"yummy": "ok", "kodik": "ok"})
            self.assertEqual(len(payload["videos"]), 2)

    async def test_kodik_supplies_catalogue_when_yummy_is_down(self) -> None:
        class YummyDown:
            async def search(self, _query: str, limit: int, offset: int = 0) -> list[dict[str, Any]]:
                raise RuntimeError("down")

        class KodikUp:
            async def catalogue(self, _query: str, limit: int, offset: int = 0) -> list[dict[str, Any]]:
                return [kodik_release()]

        with tempfile.TemporaryDirectory() as directory:
            service = HybridCatalogueService(YummyDown(), KodikUp(), Path(directory))  # type: ignore[arg-type]
            anime, sources = await service.catalogue("test", 24, 0)
            self.assertEqual(sources, {"yummy": "error", "kodik": "ok"})
            self.assertEqual(anime[0]["anime_id"], -77)
            self.assertEqual(anime[0]["description"], "Описание из Kodik")
            self.assertTrue((Path(directory) / "animesoul-anime-identities.json").is_file())

    async def test_yummy_supplies_catalogue_when_kodik_is_down(self) -> None:
        class YummyUp:
            async def request(self, _path: str, _params: dict[str, object]) -> list[dict[str, Any]]:
                return [{"anime_id": 501, "title": "Yummy only"}]

        class KodikDown:
            async def catalogue(self, _query: str, limit: int, offset: int = 0) -> list[dict[str, Any]]:
                raise RuntimeError("down")

        with tempfile.TemporaryDirectory() as directory:
            service = HybridCatalogueService(YummyUp(), KodikDown(), Path(directory))  # type: ignore[arg-type]
            anime, sources = await service.catalogue("", 24, 0)
            self.assertEqual(sources, {"yummy": "ok", "kodik": "error"})
            self.assertEqual(anime, [{"anime_id": 501, "title": "Yummy only"}])

    async def test_saved_yummy_id_is_restored_from_kodik_identity_index(self) -> None:
        class YummyDown:
            async def request(self, _path: str, _params: dict[str, object] | None = None) -> object:
                raise RuntimeError("down")

        class KodikUp:
            async def find_for_anime(
                self,
                anime: dict[str, Any] | None,
                *,
                anime_id: int | None = None,
                with_episodes: bool = False,
            ) -> list[dict[str, Any]]:
                self.seen = (anime, anime_id, with_episodes)
                return [kodik_release()]

        with tempfile.TemporaryDirectory() as directory:
            kodik = KodikUp()
            service = HybridCatalogueService(YummyDown(), kodik, Path(directory))  # type: ignore[arg-type]
            await service.registry.remember([{
                "anime_id": 501,
                "title": "Тестовое аниме",
                "remote_ids": {"shikimori_id": 77},
            }])
            anime, sources = await service.details(["501"])
            self.assertEqual(sources, {"yummy": "error", "kodik": "ok"})
            self.assertEqual(anime[0]["anime_id"], 501)
            self.assertEqual(kodik.seen[0]["remote_ids"]["shikimori_id"], 77)


if __name__ == "__main__":
    unittest.main()
