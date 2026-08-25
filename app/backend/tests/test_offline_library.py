"""Regression tests for the local download queue and library index."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from backend.app.services.offline_library import (
    OfflineLibraryError,
    OfflineLibraryService,
    _anime_folder_name,
    _dpapi_protect,
    _dpapi_unprotect,
    _episode_link_from_results,
    _is_kodik_url,
    _kodik_player_candidates,
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
    def test_android_secret_uses_application_sandbox_format(self) -> None:
        with mock.patch.dict(os.environ, {"ANIMESOUL_MOBILE": "android"}):
            protected = _dpapi_protect("private-test-key")
            self.assertTrue(protected.startswith("android-sandbox:"))
            self.assertNotIn("private-test-key", protected)
            self.assertEqual(_dpapi_unprotect(protected), "private-test-key")

    def test_android_hls_package_mirrors_manifest_key_and_segments(self) -> None:
        responses = {
            "/master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n/media.m3u8\n",
            "/media.m3u8": (
                "#EXTM3U\n#EXT-X-TARGETDURATION:6\n"
                "#EXT-X-KEY:METHOD=AES-128,URI=\"/key.bin\"\n"
                "#EXTINF:6,\n/one.ts\n#EXTINF:6,\n/two.ts\n#EXT-X-ENDLIST\n"
            ),
            "/key.bin": b"0123456789abcdef",
            "/one.ts": b"segment-one",
            "/two.ts": b"segment-two",
        }

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
                body = responses.get(self.path)
                if body is None:
                    self.send_error(404)
                    return
                data = body.encode() if isinstance(body, str) else body
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        try:
            async def scenario(root: Path) -> None:
                service = OfflineLibraryService(root / "data")
                target = root / "episode.part.m3u8"
                job = {"progress": 0.0}
                await service._download_android_hls_package(
                    f"http://127.0.0.1:{server.server_port}/master.m3u8",
                    target,
                    job,
                    0,
                    1,
                    "job-1",
                    "episode-1",
                )
                manifest = target.read_text(encoding="utf-8")
                self.assertIn('/api/downloads/assets/episode-1/asset-00001.bin', manifest)
                self.assertIn('/api/downloads/assets/episode-1/asset-00002.ts', manifest)
                self.assertIn('/api/downloads/assets/episode-1/asset-00003.ts', manifest)
                assets = root / ".episode-1.assets"
                self.assertEqual((assets / "asset-00001.bin").read_bytes(), b"0123456789abcdef")
                self.assertEqual((assets / "asset-00002.ts").read_bytes(), b"segment-one")
                self.assertEqual((assets / "asset-00003.ts").read_bytes(), b"segment-two")
                self.assertGreaterEqual(job["progress"], .99)

            with tempfile.TemporaryDirectory() as directory:
                with mock.patch.dict(os.environ, {"ANIMESOUL_MOBILE": "android"}):
                    asyncio.run(scenario(Path(directory)))
        finally:
            server.shutdown()
            server.server_close()

    def test_android_hls_segment_paths_reuse_validated_episode_directory(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")
            await service.update_settings("downloads")
            directory = await service._directory()
            episode_id = "episode-cache"
            relative = Path("Anime") / "Season 01" / "episode.m3u8"
            media = directory / relative
            assets = media.parent / f".{episode_id}.assets"
            await asyncio.to_thread(assets.mkdir, parents=True)
            await asyncio.to_thread(media.write_text, "#EXTM3U\n", encoding="utf-8")
            await asyncio.to_thread((assets / "asset-00001.ts").write_bytes, b"one")
            await asyncio.to_thread((assets / "asset-00002.ts").write_bytes, b"two")
            await service._save_index(directory, {
                "version": 1,
                "episodes": [{"id": episode_id, "file": str(relative)}],
            })

            reads = 0
            original_read_index = service._read_index

            async def counted_read_index(target: Path) -> dict[str, Any]:
                nonlocal reads
                reads += 1
                return await original_read_index(target)

            service._read_index = counted_read_index  # type: ignore[method-assign]
            first = await service.asset_path(episode_id, "asset-00001.ts")
            second = await service.asset_path(episode_id, "asset-00002.ts")
            self.assertEqual(first.read_bytes(), b"one")
            self.assertEqual(second.read_bytes(), b"two")
            self.assertEqual(reads, 1)

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))

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
            _kodik_player_candidates(
                "//kodikplayer.com/seria/selected/hash/720p",
                "//kodikplayer.com/seria/catalogue-mismatch/hash/720p",
            ),
            [
                "//kodikplayer.com/seria/selected/hash/720p",
                "//kodikplayer.com/seria/catalogue-mismatch/hash/720p",
            ],
        )
        self.assertEqual(
            _kodik_player_candidates(
                "//kodikplayer.com/season/selected/hash/720p?episode=9",
                "//kodikplayer.com/seria/exact/hash/720p",
            ),
            [
                "//kodikplayer.com/season/selected/hash/720p?episode=9",
                "//kodikplayer.com/seria/exact/hash/720p",
                "//kodikplayer.com/season/selected/hash/720p",
            ],
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
            ) -> tuple[str, int, dict[str, dict[str, float]]]:
                self.assertEqual(public_key, "public-test-key")
                self.assertEqual(private_key, "private-test-key")
                return "https://cdn.example/video.mp4", 720, {
                    "opening": {"time": 12.0, "length": 85.0},
                    "ending": {"time": 1320.0, "length": 80.0},
                }

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
                _episode_id: str = "",
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
            self.assertGreater(entry["sizeBytes"], 0)
            self.assertGreater(library["anime"][0]["sizeBytes"], 0)
            self.assertEqual(entry["skips"]["opening"]["time"], 12.0)
            self.assertGreater(library["storage"]["freeBytes"], 0)
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
                _episode_id: str = "",
            ) -> None:
                await asyncio.to_thread(target.write_bytes, b"partial")
                started.set()
                # Simulate a socket read that cannot poll the cancellation set.
                # Service cancellation must interrupt the active task itself.
                await asyncio.sleep(60)

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
            partials = list((root / "data" / "downloads").rglob("*.part*"))
            self.assertEqual(partials, [])

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))

    def test_mobile_network_policy_blocks_and_resumes_without_changing_directory(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")
            await service.update_settings(
                "downloads",
                kodik_public_key="public-test-key",
                kodik_private_key="private-test-key",
            )
            await service.set_network_type("mobile")
            with self.assertRaisesRegex(OfflineLibraryError, "мобильную сеть"):
                await service.enqueue(request_for())

            job = {"status": "downloading", "pauseReason": "", "error": ""}
            waiter = asyncio.create_task(service._wait_for_network(job, "job-network"))
            await asyncio.sleep(.02)
            self.assertEqual(job["status"], "paused")
            settings = await service.update_settings("downloads", allow_mobile_downloads=True)
            self.assertTrue(settings["allowMobileDownloads"])
            await asyncio.wait_for(waiter, 1)
            self.assertEqual(job["status"], "downloading")
            self.assertEqual(job["pauseReason"], "")

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))

    def test_cancelling_after_media_rename_does_not_leave_orphan(self) -> None:
        async def scenario(root: Path) -> None:
            service = OfflineLibraryService(root / "data")
            preview_started = asyncio.Event()
            await service.update_settings(
                "downloads",
                kodik_public_key="public-test-key",
                kodik_private_key="private-test-key",
            )

            async def resolve(*_args: object, **_details: object) -> tuple[str, int]:
                return "https://cdn.example/video.mp4", 720

            async def artwork(*_args: object, **_details: object) -> None:
                return None

            async def stream(_source: str, target: Path, *_args: object, **_details: object) -> None:
                await asyncio.to_thread(target.write_bytes, b"complete-media")

            async def preview(*_args: object, **_details: object) -> str | None:
                preview_started.set()
                await asyncio.sleep(60)
                return None

            service.resolver.resolve_private_api = resolve  # type: ignore[method-assign]
            service._download_artwork = artwork  # type: ignore[method-assign]
            service._stream_to_file = stream  # type: ignore[method-assign]
            service._download_episode_preview = preview  # type: ignore[method-assign]

            job = await service.enqueue(request_for())
            await asyncio.wait_for(preview_started.wait(), 1)
            await service.cancel(job["id"])
            assert service._worker is not None
            await asyncio.wait_for(service._worker, 1)

            self.assertEqual(service.jobs()[0]["status"], "cancelled")
            self.assertEqual((await service.library())["anime"], [])
            media = list((root / "data" / "downloads").rglob("*.mp4"))
            self.assertEqual(media, [])

        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(scenario(Path(directory)))


if __name__ == "__main__":
    unittest.main()
