"""Regression tests for the local download queue and library index."""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import Any

from backend.app.services.offline_library import (
    DownloadCancelled,
    KodikSourceResolver,
    OfflineLibraryService,
    _anime_folder_name,
    _decode_kodik_source,
    _is_kodik_url,
    _json_from_script,
    _kodik_media_id,
    _normalise_dubbing,
    _source_reference,
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
    def test_kodik_host_guard_and_direct_link_decoder(self) -> None:
        self.assertTrue(_is_kodik_url("//kodik.info/serial/1/hash/720p"))
        self.assertTrue(_is_kodik_url("https://player.kodik.info/serial/1/hash/720p"))
        self.assertFalse(_is_kodik_url("https://kodik.evil.example/serial/1"))
        self.assertFalse(_is_kodik_url("https://example.test/kodik.info"))
        self.assertEqual(_kodik_media_id("https://kodik.info/serial/73959/hash/720p"), "serial-73959")
        self.assertEqual(_kodik_media_id("https://kodik.info/video/12/hash/720p"), "movie-12")
        self.assertEqual(
            _source_reference(
                "https://kodikplayer.com/season/117533/hash/720p?episode=1",
                62927,
                "shikimori",
            ),
            ("62927", "shikimori"),
        )
        self.assertEqual(_normalise_dubbing("Озвучка AniStar & DEEP"), "anistar deep")
        class Parser:
            def api_request(self, _endpoint: str, _filters: dict[str, str]) -> dict[str, Any]:
                return {"results": [
                    {"translation": {"id": 910, "title": "AniStar"}},
                    {"translation": {"id": 911, "title": "AniStar & DEEP"}},
                ]}
        self.assertEqual(
            KodikSourceResolver._matching_translation_id(Parser(), "62927", "shikimori", "Озвучка AniStar & DEEP"),
            "911",
        )
        self.assertEqual(
            _decode_kodik_source("//cdn.example/video/720.mp4:hls:manifest.m3u8"),
            "https://cdn.example/video/720.mp4:hls:manifest.m3u8",
        )
        self.assertEqual(KodikSourceResolver._script_value('const hash = "signed";', "hash"), "signed")
        self.assertEqual(
            KodikSourceResolver._endpoint_from_script('$.ajax({url: "/ajax/get-video-info"})'),
            "/ajax/get-video-info",
        )
        self.assertEqual(
            KodikSourceResolver._endpoint_from_script('$.ajax({type:"POST",url:atob("L2Z0b3I=")})'),
            "/ftor",
        )
        self.assertEqual(
            _json_from_script('window.urlParams = {"d":"signed", "nested":{"token":"ok"}}\n', "urlParams"),
            {"d": "signed", "nested": {"token": "ok"}},
        )
        self.assertEqual(
            _json_from_script("var urlParams = '{\"d\":\"signed\", \"pd\":\"kodikplayer.com\"}';", "urlParams"),
            {"d": "signed", "pd": "kodikplayer.com"},
        )

    def test_queue_persists_media_and_deletion_removes_all_library_files(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")

            settings = await service.update_settings("downloads", kodik_api_token="local-test-token")
            self.assertTrue(settings["kodikApiTokenConfigured"])
            self.assertNotIn("local-test-token", settings.values())

            async def resolve(
                _url: str,
                _quality: int,
                _episode: object,
                _translation: object,
                token: str,
                _catalog_id: object = None,
                _catalog_id_type: object = None,
                _dubbing: object = None,
            ) -> tuple[str, int]:
                self.assertEqual(token, "local-test-token")
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

            service.resolver.resolve_via_api = resolve  # type: ignore[method-assign]
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

    def test_cancelling_active_transfer_cleans_partial_file(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")
            started = asyncio.Event()
            await service.update_settings("downloads", kodik_api_token="local-test-token")

            async def resolve(
                _url: str,
                _quality: int,
                _episode: object,
                _translation: object,
                _token: str,
                _catalog_id: object = None,
                _catalog_id_type: object = None,
                _dubbing: object = None,
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

            service.resolver.resolve_via_api = resolve  # type: ignore[method-assign]
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
