[English](BACKEND.md) | [Русский](BACKEND.ru.md)

# Backend: services and lifecycle

All paths below start at `app/backend/app/`. [Architecture](../ARCHITECTURE.md) · [API](API_REFERENCE.md) · [Route/model inventory](API_SCHEMA.md)

## Application lifetime

1. `config.load_settings` resolves JSON/environment paths and credentials; `.env` fills only missing environment values.
2. Router imports create services bound to the configured data directory. `get_gdrive_service` shares cloud state/queue. `JsonStorage` shares a lock for each resolved save path, even across service objects.
3. `main.app` registers eight router modules on desktop; `ANIMESOUL_MOBILE=android` excludes Watch Party.
4. HTTP middleware adds `Server-Timing`. Hashed `/assets/` get a one-year immutable cache policy; most responses get `no-store`; offline media/assets set their own private immutable policy.
5. Existing frontend dist is served by `/assets` and a catch-all after API routes. A missing bundle must be built before starting the process.
6. Lifespan closes Yummy, Kodik and episode-date clients using `asyncio.gather(..., return_exceptions=True)`.

## Service map

| Service / file | Main operations | Boundary |
| --- | --- | --- |
| `HybridCatalogueService` / `catalog.py` | `catalogue`, `details`, `videos` | Coordinate Yummy/Kodik, fill missing fields, report source state |
| `AnimeIdentityRegistry` / `catalog.py` | `remember`, `get` | Persist identity mappings for fallback/recovery |
| `YummyAnimeGateway` / `yummy.py` | `request`, `search`, `clear_cache`, `close` | Token headers, query variants, pooled HTTP, dedup/cache |
| `KodikAnimeGateway` / `kodik.py` | Public catalogue/lookup/ping | Normalize metadata and playable episodes |
| `anime_identity.py`, `episode_links.py`, `kodik_helpers.py` | Matching and normalization helpers | Keep title identity separate from franchise display numbering |
| `PersistentJsonCache` / `response_cache.py` | Fresh/stale JSON cache | SQLite + memory hot layer; credential fingerprint in cache key |
| `EpisodeDatesGateway` / `episode_dates.py` | Episode-date fetch/cache | Jikan calendar dates independent of playback |
| `OfflineLibraryService` / `offline_library.py` | `settings`, `library`, `enqueue`, `cancel`, `playback_source`, deletion/scanning | Device settings, sequential queue, media index and files |
| `KodikSourceResolver` / `kodik_resolver.py` | `resolve_playback_api` | Resolve exact episode URL and sign private video-links request |
| `JsonStorage` / `storage.py` | `read`, `write`, `backup`, `replace_with_backup` | Validated, serialized, atomic JSON and legacy import |
| `GoogleDriveService` / `gdrive.py` | OAuth, cloud I/O, `schedule_write`, status | One shared background queue and pending auth |
| `gdrive_merge.py` | `merge_storage_documents`, profile/episode merge | Pure deterministic conflict policy |
| `CommunityRatingStore` / `community_ratings.py` | `replace`, `aggregate`, `list_anime_ids` | SQLite anonymous vote trees |
| `WatchPartyService` / `watch_party.py` | Create/join/update/state/leave/transfer | In-memory participants and playback; optional WS broadcast |

## Catalogue and provider failure

`api/yummy.py` retains the UI endpoint while calling the hybrid catalogue service. Yummy metadata can be supplemented with Kodik; `_sources` and diagnostic headers report outcomes. Strict stable-ID/title/year/type matching avoids joining unrelated parts. `episode_identity_version=1` lets tracking repair old numbering only with successful provider evidence.

Search can try up to four normalized variants concurrently. The shared persistent response cache provides fresh TTLs and stale-on-error data; request coordination coalesces identical in-flight work. A stale provider response is not a new profile save. Direct signed stream URLs are resolved for playback, not kept as portable catalogue data.

## Download lifecycle

`check_download_availability` validates the exact rendition before queue creation. `enqueue` validates credentials and selection, records a job, and starts sequential work. Status is `queued → downloading → completed`, with `paused`, `cancelled` and `error` branches. Queue positions and per-job counts are runtime data. A new selection can enqueue while an earlier job runs.

Desktop uses local files and FFmpeg support. Android uses FFmpegKit/native helpers and publishes completed seekable MP4 through MediaStore. The index, posters and settings remain private. Android network monitoring can pause disallowed mobile-data downloads; a foreground service monitors jobs and holds a scoped wake lock while work is active. The queue does not survive a killed process/reboot. Completed files can be rescanned.

Media endpoints resolve IDs through the library and serve files. They are not arbitrary filesystem-path inputs. HLS playlists/segments and MP4 have different MIME types. See [download contracts](API_REFERENCE.md).

## Storage and cloud concurrency

`validate_storage_document` requires an object with a nonempty profiles list, nonempty string profile IDs and object snapshots; a provided active profile must exist. `JsonStorage` retains opaque domain fields and uses a shared file lock plus temporary write/replace. `replace_with_backup` preserves the previous local save before cloud replacement.

Local `PUT` completes before optional Drive work. An unresolved `choice_pending` blocks automatic cloud scheduling on the backend. Explicit first sync requires `resolve_initial_choice=true` and a non-auto direction. The worker coalesces pending documents, rereads latest local data and avoids overwriting a newer local save after network I/O. [Exact merge rules](GDRIVE_SYNC.md).

## Runtime and trust limits

The normal server binds loopback and has no general login/authorization middleware. Vite CORS covers localhost/127.0.0.1:5173; it is not a network-access control. Credentials remain in backend/device storage. Source-status headers and `Server-Timing` are diagnostic data. Shared ratings belong to this server. Party tokens authorize participant actions but room state is retrievable by room ID; this is not a hardened public-room service.

## Verification

Use `python -m unittest discover -s backend/tests -v` from `app/`. Focused modules cover storage safety, sync/merge, runtime identity/startup, hybrid catalogue fallback, episode identity/dates/links, offline library, ratings, cache and search. Use `python tools/check_docs.py --write-api` after adding/changing a route, then review both language contracts. Runtime/media/device checks supplement unit tests.
