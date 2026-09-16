[English](TECHNICAL_DOCUMENTATION.md) | [Русский](TECHNICAL_DOCUMENTATION.ru.md)

# Technical overview

This is the reading map for AnimeSoul **0.2.7**, schema **3**, checked against the maintained `app/` source on **2026-09-16**. File paths are repository-relative unless stated otherwise. Historical release notes and the archived legacy stack do not define the current runtime contract.

## System responsibilities

AnimeSoul combines catalogue discovery, personal library management, online/offline playback, tracking, ratings and optional sync. FastAPI runs locally; the client is a React SPA in a browser, PyWebView or Android WebView. Provider metadata and file operations go through backend services. Media streams, posters and provider iframe pages may load directly from third-party origins.

| Layer | Technologies | Entry point |
| --- | --- | --- |
| UI | React 19.2.6, TypeScript 5.9.3, Vite 8 | `frontend/src/main.tsx`, `App.tsx` |
| Playback | hls.js, HTML video, iframe adapter | `components/Player.tsx`, `features/player/AnimeSoulPlayer.tsx` |
| HTTP | FastAPI 0.116.1, Uvicorn 0.35.0, httpx 0.28.1 | `backend/app/main.py` |
| Desktop | PyWebView, PyInstaller, Inno Setup | `run.py`, `launcher.py`, `packaging/` |
| Android | Java, WebView, Chaquopy/Python, FFmpegKit, Cast SDK | `mobile/android/` |
| Persistence | JSON, localStorage mirror, SQLite | `JsonStorage`, `PersistentJsonCache`, `CommunityRatingStore` |

Versions above reflect manifests, not guaranteed versions of a previously built installer. Use the committed lockfile for frontend dependency installation.

## Read by task

| Question | Guide |
| --- | --- |
| How do I run/build/test it? | [Application README](../README.md), [Platforms](PLATFORMS.md) |
| Which layer owns this change? | [Architecture](../ARCHITECTURE.md), [Project map](PROJECT_MAP.md) |
| How do screens and UI events connect? | [UI](UI.md) |
| Which services run and where is I/O? | [Backend](BACKEND.md) |
| Which request calls which function? | [API](API_REFERENCE.md), [Route/model inventory](API_SCHEMA.md), [Flows](ENTRY_POINTS_AND_FLOWS.md) |
| What survives restart or export? | [Data model](DATA_MODEL.md), [Compatibility](../SAVE_COMPATIBILITY.md) |
| How are cloud conflicts resolved? | [Drive](GDRIVE_SYNC.md) |
| Which stylesheet wins? | [Styles](STYLES.md) |
| What remains to be refactored? | [Refactoring](REFACTORING_RECOMMENDATIONS.md) |

## Important invariants

1. `StorageDocument` is versioned; normal migration/save preserves unknown envelope, profile and snapshot fields.
2. Backend storage validates the profile envelope; frontend owns domain migration. Local save completion and confirmed cloud sync are separate states.
3. Hybrid catalogue fills missing information across Yummy/Kodik while retaining identity. It does not merge unrelated seasons just because their franchise-level external ID matches.
4. `originAnimeId` and `originEpisode` retain source identity when a franchise changes display numbering. Tracking repair requires successful source evidence.
5. Direct playback resolves temporary Kodik links for the selected episode/dub. Signed URLs are not portable profile fields.
6. Watch Party REST polling is authoritative for the React client. Android excludes its routes and UI.
7. Download jobs and rooms are process-local. Completed files/index persist separately.
8. Google Drive first-sync choice is enforced on the server. Full cloud restore validates data and creates a local backup.
9. Global CSS import order is part of the interface contract. Device zoom is separate from portable UI-size preferences.
10. Documentation language is separate from UI language; current screenshots show the Russian UI.

## Change checklist

For an HTTP change, update route/model inventory, examples, callers and both languages. For a data change, also update defaults, round-trip and merge behavior. For a UI change, update component ownership, CSS ownership and screenshots where visible behavior changes. Run the checks in the [application README](../README.md); use real device/integration checks where unit tests cannot cover playback or native lifecycle.
