"""Regression tests for the bidirectional YummyAnime/Kodik reserve."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any

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
