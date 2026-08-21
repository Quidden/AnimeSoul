"""Regression tests for the local download queue and library index."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import tempfile
import unittest
from pathlib import Path
from typing import Any

from backend.app.services.offline_library import (
    DownloadCancelled,
    OfflineLibraryError,
    OfflineLibraryService,
    _anime_folder_name,
    _episode_link_from_results,
    _is_kodik_url,
    _kodik_signature,
    _normalise_kodik_skips,
    _normalise_kodik_sources,
    _normalise_kodik_subtitles,
    _private_player_link,
    _select_kodik_source,
)


def request_for(anime_id: int = 101, title: str = "Тестовое аниме") -> dict[str, Any]:
    return {
        "animeId": anime_id,
        "title": title,
        "year": 2025,
        "posterUrl": "https://images.example.test/poster.jpg",
        "quality": 720,
        "episodes": [
            {
                "videoId": 1,
                "season": 1,
                "episode": "1",
                "originAnimeId": anime_id,
                "originEpisode": "1",
                "dubbing": "AniLibria",
                "translationId": 7,
                "iframeUrl": "https://kodik.info/serial/1/hash/720p?episode=1",
                "duration": 1440,
            }
        ],
    }


class OfflineLibraryTests(unittest.TestCase):
    def test_kodik_private_api_helpers(self) -> None:
        self.assertTrue(_is_kodik_url("//kodik.info/serial/1/hash/720p"))
        self.assertTrue(_is_kodik_url("https://player.kodik.info/serial/1/hash/720p"))
        self.assertFalse(_is_kodik_url("https://kodik.evil.example/serial/1"))
        self.assertFalse(_is_kodik_url("https://example.test/kodik.info"))
        self.assertEqual(
            _private_player_link("https://kodikplayer.com/season/117533/hash/720p?episode=1"),
            "//kodikplayer.com/season/117533/hash/720p?episode=1",
        )
        self.assertEqual(
            _private_player_link("//kodikplayer.com/seria/117534/hash/720p"),
            "//kodikplayer.com/seria/117534/hash/720p",
        )
        self.assertEqual(
            _kodik_signature("//kodikplayer.com/video/1/hash/720p", "1.1.1.1", "2026082100", "private-test"),
            hmac.new(
                b"private-test",
                b"//kodikplayer.com/video/1/hash/720p:1.1.1.1:2026082100",
                hashlib.sha256,
            ).hexdigest(),
        )
        self.assertEqual(
            _select_kodik_source(
                {
                    "1080": [{"src": "https://cdn.example/1080.m3u8"}],
                    # Private API replies use title-case field names.
                    "720": {"Src": "//cdn.example/720.m3u8", "Type": "hls"},
                },
                900,
            ),
            ("https://cdn.example/720.m3u8", 720),
        )
        self.assertEqual(
            _episode_link_from_results(
                [
                    {
                        "translation": {"id": 2, "title": "Другая озвучка"},
                        "seasons": {"1": {"episodes": {"7": {"link": "//kodikplayer.com/seria/other/hash/720p"}}}},
                    },
                    {
                        "translation": {"id": 7, "title": "AniStar & DEEP"},
                        "seasons": {"3": {"episodes": {"7": {"link": "//kodikplayer.com/seria/right/hash/720p"}}}},
                    },
                ],
                # UI group 5 contains season 3 because two specials are
                # inserted before it. The resolver must trust Kodik's season.
                5,
                "7",
                7,
                "Озвучка AniStar & DEEP",
            ),
            "//kodikplayer.com/seria/right/hash/720p",
        )
        self.assertEqual(
            _normalise_kodik_sources({"1080": {"Src": "//cdn.example/1080.m3u8", "Type": "hls"}}),
            [{"quality": 1080, "src": "https://cdn.example/1080.m3u8", "type": "hls"}],
        )
        self.assertEqual(
            _normalise_kodik_subtitles({"ru": "//cdn.example/ru.vtt", "en": {"Src": "https://cdn.example/en.vtt"}}),
            [
                {"src": "https://cdn.example/ru.vtt", "label": "ru", "language": "ru"},
                {"src": "https://cdn.example/en.vtt", "label": "en", "language": "en", "default": False},
            ],
        )
        self.assertEqual(
            _normalise_kodik_skips({"skip_segments": {"opening": [12, 97], "ending": {"time": 1310, "length": 90}}}),
            {
                "opening": {"time": 12.0, "length": 85.0},
                "ending": {"time": 1310.0, "length": 90.0},
            },
        )
        self.assertEqual(
            _normalise_kodik_skips({"segments": {"ad": [], "skip": [[18, 103], [1320, 1400]]}}),
            {
                "opening": {"time": 18.0, "length": 85.0},
                "ending": {"time": 1320.0, "length": 80.0},
            },
        )

    def test_queue_persists_media_and_deletion_removes_all_library_files(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")

            settings = await service.update_settings(
                "downloads",
                kodik_public_key="public-test-key",
                kodik_private_key="private-test-key",
            )
            self.assertTrue(settings["kodikPublicKeyConfigured"])
            self.assertTrue(settings["kodikPrivateKeyConfigured"])
            self.assertNotIn("private-test-key", settings.values())
            self.assertEqual(await service._kodik_private_credentials(), ("public-test-key", "private-test-key"))

            async def resolve(
                _url: str,
                _quality: int,
                public_key: str,
                private_key: str,
                **_details: object,
            ) -> tuple[str, int]:
                self.assertEqual(public_key, "public-test-key")
                self.assertEqual(private_key, "private-test-key")
                return "https://cdn.example/video.mp4", 720

            async def artwork(directory: Path, request: dict[str, Any], _kind: str) -> None:
                path = service._path_within(directory, str(Path(_anime_folder_name(request)) / "poster.jpg"))
                await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(path.write_bytes, b"poster")

            async def stream(
                _source: str,
                target: Path,
                job: dict[str, Any],
                done_before: int,
                total: int,
                _job_id: str,
                _duration: float = 0,
            ) -> None:
                await asyncio.to_thread(target.write_bytes, b"video")
                job["progress"] = (done_before + 1) / total

            service.resolver.resolve_private_api = resolve  # type: ignore[method-assign]
            service._download_artwork = artwork  # type: ignore[method-assign]
            service._stream_to_file = stream  # type: ignore[method-assign]

            job = await service.enqueue(request_for())
            assert service._worker is not None
            await asyncio.wait_for(service._worker, 1)
            self.assertEqual(service.jobs()[0]["status"], "completed")
            self.assertEqual(service.jobs()[0]["progress"], 1)

            library = await service.library()
            self.assertEqual(len(library["anime"]), 1)
            entry = library["anime"][0]["episodes"][0]
            self.assertTrue((await service.media_path(entry["id"])).is_file())
            self.assertTrue((await service.poster_path(101)).is_file())

            await service.delete_anime(101)
            self.assertEqual((await service.library())["anime"], [])
            self.assertFalse((root / "data" / "downloads" / _anime_folder_name(request_for())).exists())

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))

    def test_enqueue_requires_official_kodik_keys(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")
            await service.update_settings("downloads")
            with self.assertRaisesRegex(OfflineLibraryError, "публичный и приватный ключи"):
                await service.enqueue(request_for())
            self.assertEqual(service.jobs(), [])

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))

    def test_playback_source_returns_all_direct_player_metadata(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")
            await service.update_settings(
                "downloads",
                kodik_public_key="public-test-key",
                kodik_private_key="private-test-key",
            )

            async def resolve(
                _url: str,
                public_key: str,
                private_key: str,
                **details: object,
            ) -> dict[str, object]:
                self.assertEqual((public_key, private_key), ("public-test-key", "private-test-key"))
                self.assertEqual(details["dubbing"], "AniLibria")
                return {
                    "sources": [{"quality": 720, "src": "https://cdn.example/video.m3u8", "type": "hls"}],
                    "subtitles": [{"src": "https://cdn.example/ru.vtt", "label": "Русские", "language": "ru"}],
                    "skips": {"opening": {"time": 12, "length": 85}},
                }

            service.resolver.resolve_playback_api = resolve  # type: ignore[method-assign]
            episode = request_for()["episodes"][0]
            result = await service.playback_source(episode)
            self.assertEqual(result["sources"][0]["quality"], 720)
            self.assertEqual(result["subtitles"][0]["language"], "ru")
            self.assertEqual(result["skips"]["opening"]["time"], 12)

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))

    def test_cancelling_active_transfer_cleans_partial_file(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")
            started = asyncio.Event()
            await service.update_settings(
                "downloads",
                kodik_public_key="public-test-key",
                kodik_private_key="private-test-key",
            )

            async def resolve(
                _url: str,
                _quality: int,
                _public_key: str,
                _private_key: str,
                **_details: object,
            ) -> tuple[str, int]:
                return "https://cdn.example/video.mp4", 720

            async def artwork(_directory: Path, _request: dict[str, Any], _kind: str) -> None:
                return None

            async def stream(
                _source: str,
                target: Path,
                _job: dict[str, Any],
                _done_before: int,
                _total: int,
                job_id: str,
                _duration: float = 0,
            ) -> None:
                await asyncio.to_thread(target.write_bytes, b"partial")
                started.set()
                while job_id not in service._cancelled:
                    await asyncio.sleep(.01)
                raise DownloadCancelled

            service.resolver.resolve_private_api = resolve  # type: ignore[method-assign]
            service._download_artwork = artwork  # type: ignore[method-assign]
            service._stream_to_file = stream  # type: ignore[method-assign]

            job = await service.enqueue(request_for())
            await asyncio.wait_for(started.wait(), 1)
            await service.cancel(job["id"])
            assert service._worker is not None
            await asyncio.wait_for(service._worker, 1)

            self.assertEqual(service.jobs()[0]["status"], "cancelled")
            self.assertEqual((await service.library())["anime"], [])
            partials = list((root / "data" / "downloads").rglob("*.part"))
            self.assertEqual(partials, [])

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))


if __name__ == "__main__":
    unittest.main()
