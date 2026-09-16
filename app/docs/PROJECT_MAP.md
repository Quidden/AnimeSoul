[English](PROJECT_MAP.md) | [Русский](PROJECT_MAP.ru.md)

# Project map

All paths are repository-relative. Maintained code is under `app/`; `legacy-old-stack/` is archived. [UI owners](UI.md) · [Backend owners](BACKEND.md) · [Calls](ENTRY_POINTS_AND_FLOWS.md).

## Runtime and packaging

| Path | Purpose |
| --- | --- |
| `Start AnimeSoul.bat` | Delegates to the current app |
| `app/run.py` | CLI configuration, port selection, browser/PyWebView, Uvicorn and desktop zoom |
| `app/launcher.py` | Installed launcher HTML and `LauncherApi` bridge; runtime launch/status/stop |
| `app/runtime_instance.py` | Runtime state, free-port lookup, identity/capability checks |
| `app/animesoul.python.example.json` | Non-secret example config |
| `app/tools/prepare_runtime.py` | Changed-only dependency/frontend preparation |
| `app/tools/transfer_saves.py` | Full document migration/backup between fixed source paths |
| `app/tools/check_docs.py` | Bilingual/local-link validation and static API inventory generation |
| `app/packaging/build_windows.ps1` | Windows build coordinator |
| `app/packaging/launcher.spec`, `runtime.spec`, `AnimeSoul.iss` | PyInstaller launcher/runtime and Inno Setup installer |
| `app/mobile/build_android.ps1`, `mobile/android/` | Gradle/Chaquopy Android packaging |
| `app/mobile/android/app/src/main/python/mobile_runtime.py` | Embedded backend bootstrap |
| `.github/workflows/quality.yml` | Windows backend/frontend quality gates |
| `release-work/`, `app/build/`, `app/dist/` | Local build output, not maintained source |

## Frontend `app/frontend/`

| Path | Responsibility |
| --- | --- |
| `index.html`, `src/main.tsx`, `src/App.tsx` | DOM, bootstrap, application composition |
| `vite.config.ts` | API/WS proxy, desktop/Android output separation, chunks and source maps |
| `src/version.ts`, `lib/changelog.ts` | Displayed version and in-app release history |
| `src/pages/` | Home, catalogue, ratings, statistics, folder view |
| `src/pages/home/` | Hero, dashboard widgets, library cards/tabs and pagination |
| `src/components/` | Reusable cards/toggles/ratings; Header, Watch/Player, SettingsCenter; debug/changelog and overlays |
| `src/features/catalog/` | API, query/filter controller and franchise/card presentation |
| `src/features/library/` | Pure history/statistics/progress selectors; folder management |
| `src/features/navigation/` | Screen/native-back actions |
| `src/features/storage/` | Snapshot/document builders, profile lifecycle and autosave |
| `src/features/player/` | HLS player/menus, toolbar, seasons, watch metadata, dates, previews, party, downloads/offline and Cast |
| `src/features/downloads/` | Download picker and offline library page |
| `src/features/settings/` | Settings catalogue, row primitives, appearance/playback/profile/credentials/offline/cloud/party groups |
| `src/features/ratings/`, `tracking/`, `watch-party/`, `header/` | Feature transport and lifecycle boundaries |
| `src/hooks/` | Watch Party loop, release tracking, API activity and published save status |
| `src/lib/types.ts`, `settings.ts`, `events.ts` | Domain contracts, defaults/storage keys, typed events |
| `src/lib/http.ts`, `apiCredentials.ts`, `downloads.ts`, `gdrive.ts`, `episodeDates.ts` | Transport adapters and error translation |
| `src/lib/anime.ts`, `tracking.ts`, `ratings.ts`, `playerProgress.ts`, `watchPartyLogic.ts` | Domain normalization and pure rules |
| `src/lib/kodik.ts`, `kodikStream.ts`, `cast.ts`, `platform.ts` | Playback/provider/native adapters |
| `src/lib/storage.ts`, `storageSafety.ts` | Migration, storage I/O, field revisions and overwrite guards |
| `src/lib/debugLog.ts`, `sourceDiagnostics.ts` | Diagnostic journal and provider status |
| `src/lib/trailer.ts`, `playerPreferences.ts`, `modalAccessibility.ts` | Trailer normalization, preference rules and modal/back lifecycle |
| `src/globals.css`, `src/styles/` | Ordered global cascade; [stylesheet owners](STYLES.md) |
| `tests/critical-logic.test.ts` | Domain characterization tests |
| `tests/player-browser.*`, `tests/cast-harness.*` | Browser integration harnesses |

## Backend `app/backend/`

`app/main.py` creates the server; `app/config.py` loads settings. `app/api/` contains eight transport adapters. Each handler and its request model is linked in [API_SCHEMA](API_SCHEMA.md).

| Services | Responsibility |
| --- | --- |
| `catalog.py`, `anime_identity.py` | Hybrid catalogue and identity mapping/matching |
| `yummy.py`, `kodik.py`, `http_client.py` | Upstream gateways and reusable HTTP behavior |
| `episode_links.py`, `kodik_helpers.py` | Exact episode URL/number/metadata normalization |
| `kodik_resolver.py` | Private signed direct-video resolution |
| `offline_library.py` | Settings, download worker, index, file access and MediaStore coordination |
| `episode_dates.py` | Jikan dates, rate limit and cache |
| `response_cache.py` | Persistent SQLite JSON cache and hot memory layer |
| `storage.py` | Envelope validation, path-shared locks, atomic writes and backups |
| `gdrive.py`, `gdrive_merge.py` | OAuth/cloud I/O and pure per-field/episode merge policy |
| `community_ratings.py`, `watch_party.py` | Shared rating storage and in-memory room protocol |

Tests cover runtime/startup, services, storage safety, Drive, offline library, cache, hybrid catalogue fallback, episode identity/dates/links, ratings and Yummy search. `requirements.txt` is runtime; `requirements-dev.txt` adds development tools.

## Android native owners

Under `app/mobile/android/app/src/main/java/com/animesoul/mobile/`:

- `MainActivity.java`: WebView, embedded runtime, navigation, native bridges and lifecycle/PiP integration.
- `PlaybackSessionController.java`, `PlaybackControlReceiver.java`: MediaSession and playback notifications/actions.
- `DownloadForegroundService.java`: queue monitoring and wake lock while active.
- `DownloadNetworkMonitor.java`: connectivity reporting to Python.
- `NativeDownloadSupport.java`: native media/download helpers and MediaStore/FFmpeg integration.
- `CastController.java`, `CastOptionsProvider.java`: Cast session bridge and receiver configuration.

Manifest/resources define permissions, network policy, backup/extraction rules and appearance. `CastSmokeTest.java` is under androidTest. Signing data and toolchain caches are Git-ignored. [Build/platform guide](PLATFORMS.md).

## Choosing a change location

HTTP request → feature/lib adapter and backend router. Provider behavior → gateway/resolver. Merge conflict → pure gdrive_merge. Persistent field → type/default/migration/builder/merge/docs. Player lifetime → Watch/controller, not a library card. Visual override → stylesheet owner and cascade audit. Update both language guides and regenerate API inventory when contracts move.
