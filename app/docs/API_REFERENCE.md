[English](API_REFERENCE.md) | [Русский](API_REFERENCE.ru.md)

# HTTP and WebSocket API reference

Version **0.2.7**, reviewed **2026-09-16**. URLs are relative to the local FastAPI origin. Development Vite proxies `/api`, `/watch-party` and `/ws` to `127.0.0.1:8000`.

**Complete route/handler list and every Pydantic request field:** [API_SCHEMA.md](API_SCHEMA.md), generated directly from Python. Live Swagger: `/docs`; ReDoc: `/redoc`; OpenAPI: `/openapi.json`. The generated inventory complements the dynamic response contracts below.

## HTTP conventions

- Send JSON bodies with `Content-Type: application/json`. Most routes return JSON; OAuth callback returns HTML, downloads return file bytes and WS emits JSON snapshots.
- FastAPI errors usually use `{"detail": ...}`; validation errors can contain a list. Party errors use `{"error":"...","code":"..."}`.
- `requestJson<T>` preserves status and optional error code in `ApiRequestError`; it prefers a string `detail`/`error`. The generic type does not validate response fields at runtime.
- Normal deployment is loopback/same-origin with no general user auth. Vite CORS allows `http://127.0.0.1:5173` and `http://localhost:5173`, including credentials. Party participant tokens and the rating cookie have narrower purposes.
- `Server-Timing: animesoul;dur=...` measures local backend handling. Hashed `/assets/` are immutable for one year; most other responses are `no-store`. Offline media/assets use private immutable caching.
- `X-AnimeSoul-Yummy-Status` and `X-AnimeSoul-Kodik-Status` identify source outcomes, also exposed as `_sources` in hybrid catalogue responses. CORS exposes these headers and `Server-Timing`.

## System

`GET /api/health`:

```json
{"ok":true,"stack":"FastAPI + React","version":"0.2.7","capabilities":["kodik-direct-stream-v1"],"runtimeInstanceId":"optional-instance-id"}
```

`runtimeInstanceId` exists only with `ANIMESOUL_INSTANCE_ID`. Launcher/runtime use identity plus capabilities before reusing/stopping a process. `GET /health` returns `{"ok":true,"watchPartyProtocol":2}` and is absent on Android.

## Storage

`GET /api/storage` returns the full `StorageDocument`. If absent after first legacy-import lookup: `404 {"detail":"Save file does not exist"}`. Only a missing document permits frontend bootstrap from the browser mirror; malformed data/server failures do not.

`PUT /api/storage` accepts the complete document. Query defaults: `auto_sync=true`, `folder_mode=visible` (`visible|appdata`), `prefer_watched=true`. Validation requires an object, a nonempty profiles array, nonempty string profile IDs, object snapshots, and a valid active profile if supplied. Unknown fields are retained. Invalid envelope: 422.

```json
{"saved":true,"path":"C:\\...\\data\\animesoul-storage.json","cloud_sync_scheduled":false,"cloud_sync_blocked":false}
```

The path is local diagnostic data. Write is atomic under a shared lock. Cloud work is queued only after local success, with tokens and no pending first-sync choice. Scheduled does not mean uploaded; poll Drive status. Frontend instant/interval/manual controls whether PUT requests cloud scheduling. [Data](DATA_MODEL.md), [Drive](GDRIVE_SYNC.md).

## Catalogue and YummyAnime credentials

`GET /api/yummy/credentials` → `{"configured":boolean}`; never returns the token. `POST /api/yummy/credentials` takes `{"token":"your-public-token"}` (1–512 characters), checks a minimal upstream request, atomically saves device credentials and clears the gateway cache. Success includes `configured`, `saved` and `checks[]` with field/label/status/detail. Rejected token: 422; unavailable validation: 502.

### `GET /api/yummy`

| Query | Default / limits | Meaning |
| --- | --- | --- |
| `mode` | `catalog` | `catalog`, `details`, `videos`, `trailers`, `schedule`, `ping`; unknown mode follows catalogue branch |
| `id` | optional integer | Required for videos/trailers; missing → 400 |
| `ids` | comma-separated, empty | Details takes the first 50 nonempty entries; it truncates rather than rejecting extra IDs |
| `limit` | 24, range 1–48 | Page size |
| `offset` | 0, nonnegative | Page offset |
| `q` | empty | Search query |
| `refresh` | false | Bypass fresh cache; stale data may still be used after upstream failure |

| Mode | Response | Caller / work |
| --- | --- | --- |
| catalogue | `{anime: Anime[], hasMore, _sources}` | `features/catalog/api.ts` → `HybridCatalogueService.catalogue` |
| details | `{anime: Anime[], _sources}` | Saved ID/family hydration → hybrid details |
| videos | `{anime, videos: Video[], episode_identity_version: 1, _sources}` | Player/tracking → hybrid videos |
| trailers | `{trailers: ...}` | Hero/resume → Yummy `/anime/{id}/trailers` |
| schedule | `{schedule: ...}` | Release schedule → Yummy `/anime/schedule` |
| ping | `{ok:true, upstreamMs:number}` | Provider health → fresh minimal Yummy catalogue request |

`hasMore` is `len(anime) == limit`, not an upstream total. Search constructs up to four variants (original, layout, transliteration, aliases), runs them concurrently and picks the first nonempty page. Frontend first-page search cache is five minutes/up to 40 entries; the Yummy search cache is five minutes/up to 128 entries. Persistent provider caching adds fresh/stale behavior across restarts.

Hybrid catalogue uses both sources to fill missing fields and maintains an identity registry. Strict ID matching rejects incompatible Shikimori IDs; a shared Kinopoisk/IMDb franchise ID alone does not prove the same title. Name fallback checks available year/type and does not treat an adaptation-source label such as “Manga” as an original title. Empty serials do not fabricate episode 1. Tracking's one-time identity repair requires version 1 and successful source evidence.

Catalogue unavailable: 502 with source diagnostic headers. Missing provider configuration can produce 503; upstream HTTP failure produces 502. Catalogue fallback means a missing Yummy token does not necessarily prevent a Kodik-backed catalogue. Ping/trailers/schedule use Yummy directly. Unknown query parameters such as `silent=1` are ignored.

Yummy upstream headers: `X-Application: <Public token>`, `Lang: ru`, `Accept: application/json`. The gateway unwraps `response` and recursively converts protocol-relative media URLs to HTTPS.

## Episode dates

`GET /api/episode-dates/{mal_id}?page=1` → `{"dates":{"1":"2026-04-03"},"hasNextPage":false}`. `mal_id` is positive; page is 1–100. Caller `useEpisodeAirDates` uses the specific part's `remote_ids.myanimelist_id` and original episode number. Jikan `aired` is kept as calendar `YYYY-MM-DD`, without device timezone conversion.

Date loading is independent of videos and starts for expanded seasons. Requests are deduplicated/rate-limited (1.05 seconds), cached for an hour and retained on transient error; unavailable uncached source → 503. Retry after failure waits at least one minute. Yummy `episode_added_at` is a separate added-date fallback; Kodik `updated_at` is not an episode release date.

## Kodik direct playback

`GET /api/kodik?mode=ping` → `{ok:true,upstreamMs}`. Unsupported mode → 400, unconfigured → 503, upstream error → 502.

`POST /api/kodik/stream` accepts `KodikStreamPayload` (see [all fields/constraints](API_SCHEMA.md)):

```json
{"videoId":123,"season":1,"episode":"7","originEpisode":"7","dubbing":"Demo dub","translationId":610,"iframeUrl":"https://kodik.example/seria/example","sourceId":"77","sourceIdType":"shikimori","sourceTitle":"Example title","sourceOriginalTitle":"Original title"}
```

This is a structural example: replace IDs and iframe URL with a real selected provider record. Caller: `lib/kodikStream.ts::fetchKodikStream`. Backend: `kodik_stream → OfflineLibraryService.playback_source → KodikSourceResolver.resolve_playback_api`.

```json
{"sources":[{"quality":720,"src":"https://cdn.example/video.m3u8","type":"hls"}],"subtitles":[{"src":"https://cdn.example/ru.vtt","label":"Russian","language":"ru"}],"skips":{"opening":{"time":12,"length":85},"ending":{"time":1320,"length":80}}}
```

Successful sources are nonempty and sorted by descending quality; subtitles/skips may be empty. The resolver signs an exact `/seria/`, `/video/` or `/movie/` URL, never a whole `/serial/` or `/season/`. It requests `auto_proxy=true` and `skip_segments=true`, not `force_proxy`. Keys, signing data and IP are not response fields. Each online launch obtains temporary sources; frontend does not persist them. Missing credentials/resolution errors → 422 with a safe detail. Provider iframe remains a fallback.

## Offline library and downloads

Caller: `lib/downloads.ts`, `useDownloadManager`, `useOfflinePlayback`, `DownloadsPage` and Android network/foreground helpers. Backend owner: `api/downloads.py::offline_library`.

| Method and path | Input | Result / effect |
| --- | --- | --- |
| `GET /api/downloads/settings` | none | directory, `allowMobileDownloads`, public/private configured flags |
| `PUT /api/downloads/settings` | directory; optional Kodik keys, explicit clear flags, mobile-data preference | Updated public settings; keys are not returned |
| `POST /api/downloads/credentials/validate` | optional public/private keys | `{canSave,checks[]}`; validate before saving |
| `GET /api/downloads/library` | none | `{directory,storage,anime,jobs}` |
| `GET /api/downloads/anime/{anime_id}` | anime ID | `{anime: OfflineAnime|null}` |
| `POST /api/downloads/scan` | no body | `{scanned,imported,existing,ignored}`; reconcile existing media |
| `POST /api/downloads/availability` | `DownloadJobPayload` | `{available,issues[]}` for exact requested rendition |
| `GET /api/downloads/jobs` | none | `{jobs: DownloadJob[]}` |
| `POST /api/downloads/jobs` | `DownloadJobPayload` | New job object, not a `{job:...}` wrapper |
| `DELETE /api/downloads/jobs/{job_id}` | job ID | `{cancelled:true}` |
| `POST /api/downloads/network` | `{type}` | `{type}` normalized to wifi/mobile/ethernet/vpn/none/unknown |
| `DELETE /api/downloads/episodes/{episode_id}` | episode ID | `{deleted:true}` |
| `POST /api/downloads/episodes/delete` | `{episodeIds:[...]}` | `{deleted:number}` |
| `DELETE /api/downloads/anime/{anime_id}` | anime ID | `{deleted:number}` |
| `GET /api/downloads/media/{episode_id}` | episode ID | MP4 or HLS playlist bytes, inline |
| `GET /api/downloads/assets/{episode_id}/{asset_name}` | ID/asset | TS segment or binary bytes |
| `GET /api/downloads/previews/{episode_id}` | episode ID | Preview file |
| `GET /api/downloads/posters/{anime_id}` | anime ID | Poster file |

Job request: `animeId`, nonempty `title` (≤300), optional year/poster, quality default 720 (144–2160), 1–1000 `episodes`. An episode needs `videoId`, season 1–99, nonempty episode (≤40), dubbing (≤160), iframe URL (8–4096); optional origin/translation/source IDs, titles, season label, duration and preview. Bulk deletion allows 1–1000 IDs. Exact models are in the generated inventory.

`OfflineAnime` contains animeId/title, optional year/poster/posterUrl, episodes and sizeBytes. `OfflineEpisode` includes identity, season/episode/dub, quality/size, local URLs and optional metadata; source of truth is [downloads.ts](../frontend/src/lib/downloads.ts). `storage` contains totalBytes/usedBytes/freeBytes/libraryBytes. Job fields include id/animeId/title/quality, status, total/completed/progress/current/error/createdAt, optional pauseReason/queuePosition/items. Statuses: queued/downloading/paused/completed/cancelled/error. Mobile pause reason: `mobile-network`.

Missing job/file → 404 where the route catches KeyError; library/service validation → 422. File responses use `application/vnd.apple.mpegurl`, `video/mp4`, `video/mp2t` or `application/octet-stream` as appropriate. Jobs live in memory; completed media/index persist. Android network policy and Cast are described in [Platforms](PLATFORMS.md).

## Community ratings

`GET /api/community-ratings?ids=...` accepts up to 100 unique positive IDs. Without IDs, `limit=100` (1–100) and `offset=0` select a page ordered by last publication then anime ID. Response: `{ratings: Record<string,Aggregate>,hasMore,offset}`. With IDs, hasMore is false. `GET /api/community-ratings/{anime_id}` returns `{rating: Aggregate|null}`.

`PUT /api/community-ratings/{anime_id}` replaces the browser's entire vote tree:

```json
{"title":"Example","anime":8.5,"seasons":{"1":8},"episodes":{"1:3":9}}
```

Scores are finite numbers 1–10, never booleans; null removes a score. Title is trimmed to 300 characters, seasons allow 200 positive-integer keys, episodes 5000 keys matching `^\d+:.{1,40}$`. Empty tree deletes this browser/anime record. Response: `{rating: Aggregate|null,anonymous:true}`. An aggregate has animeId/title/updatedAt and anime/seasons/episodes entries `{average,count}`.

The UUID cookie `animesoul_rating_voter` is HttpOnly, SameSite=Lax, one year, Secure on HTTPS only. Voter IDs are never returned. Aggregates are per backend instance, not a global service. Caller `useCommunityRatings` batches reads, debounces publication 500 ms and retries offline publication after 30 seconds; deletions use a local tombstone queue.

## Watch Party (desktop/browser)

Protocol **2**. Session `{roomId,token,role}` is stored under `animesoul:watch-party-session` in sessionStorage. These HTTP/WS routes are excluded when `ANIMESOUL_MOBILE=android`.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /watch-party/create` | name (≤32), roomMode host/shared | `{roomId,token,role:"host",protocol:2}` |
| `POST /watch-party/join` | roomId, name (≤32), mode follow/free | Same session shape, guest role |
| `POST /watch-party/update` | roomId, token, name, mode, roomMode, playback, buffering, optional control/action | `{ok:true}` |
| `GET /watch-party/state?room=...` | room ID | Protocol, roomId/roomMode, playback, lastControllerId/lastAction, participants |
| `POST /watch-party/transfer-host` | roomId, host token, participantId | `{ok:true,hostId}` |
| `POST /watch-party/leave` | roomId, token | `{ok:true}` |
| `WS /ws/watch-party/{room_id}` | Room path | Initial and broadcast JSON states; incoming text ignored |

Playback fields: animeId, season, episode, dub, player, position, duration, playing, updatedAt (client ms); accepted room playback gets server sentAt. Participants expose id/name/role/mode/playback/buffering/online. Online means heartbeat within 8 seconds. Guests inactive for over 5 minutes are pruned when state is read; host is not automatically pruned. Host departure transfers to the most recently active participant; empty rooms are deleted.

Host-mode room playback accepts the host in follow mode. Shared-mode accepts follow participants with `control:true`; host can seed the initial state. `action` gets monotonic seq. Codes: ROOM_NOT_FOUND/404, PARTICIPANT_NOT_FOUND/404, NOT_HOST/403. WS missing room closes 4404.

`useWatchParty` sends update then reads state every second; WS is a compatibility/push contract and is not opened by the current React client. Revision and 12-second remote-control suppression guards prevent feedback loops. Rooms disappear on restart.

## Google Drive

| Endpoint | Input | Output / condition |
| --- | --- | --- |
| `GET /api/gdrive/status` | none | connected, oauth_pending, user_email/user_name, has_credentials/client_id, has_cloud_file/choice_pending and sync status |
| `GET /api/gdrive/network-check` | none | `{reachable:true,status_code}`; no credentials sent; failure 502 |
| `POST /api/gdrive/credentials` | client_id, optional client_secret | `{saved,checks[]}`; HTTP success alone does not imply saved |
| `GET /api/gdrive/auth-url` | optional redirect_uri | `{url,redirect_uri}`; missing Client ID 400 |
| `GET /api/gdrive/oauth2callback` | required code/state | HTML result; Android can defer exchange |
| `POST /api/gdrive/complete-auth` | no body | `{pending:false,connected,...}`; Android foreground completion, transient network 503, terminal error 400 |
| `POST /api/gdrive/sync` | mode, prefer_watched, folder_mode, resolve_initial_choice | uploaded/downloaded/merged result with document and optional file_id/backup |
| `POST /api/gdrive/disconnect` | no body | `{disconnected:true,revoked:boolean}`; best-effort Google revocation and local cleanup |

Sync-status fields: sync_state idle/syncing/synced/error, sync_running, sync_pending, last_sync_at, last_sync_started_at and last_sync_error. Status never returns client secret or OAuth tokens.

Credential checks probe Google; only all-valid checks are saved. Blank/null secret preserves the existing secret; changing resolved credentials disconnects old tokens. OAuth uses authorization code and one-use in-memory state (10-minute TTL), without PKCE. Scopes: drive.file, drive.appdata, userinfo.email, offline access and consent. Desktop success sends `GDRIVE_AUTH_SUCCESS` to the opener's strict origin; callback failures are HTML and must be checked via status. Android stores a pending code for exchange after foregrounding and serializes completion to avoid double use.

Sync defaults: mode auto, prefer_watched true, folder_mode visible, resolve_initial_choice false. Modes: local uploads/replaces cloud; cloud replaces local with backup; merge combines both; anime_only merges while keeping local theme/playerPrefs; auto uploads if cloud is empty, otherwise merges when both exist. Result status is uploaded/downloaded/merged with document, optional file_id, and optional backup for restoration.

Errors: no tokens 401; unresolved first choice 409; first choice with auto 422; absent local upload source 409; invalid local document 500; cloud restore without file 444. Pending choice is server-enforced for both autosave and explicit sync. Pass `resolve_initial_choice:true` only for the user's explicit first-choice action. [Full merge and OAuth rules](GDRIVE_SYNC.md).

## Consumed provider fields

The proxy forwards extra fields; the UI relies on these subsets. [Type definitions](../frontend/src/lib/types.ts) are the code contract.

| Object | Fields | Use |
| --- | --- | --- |
| Anime | anime_id, title, original, other_titles, title_en/title_ru, description | Identity, labels and search; adaptation-source labels are not title identities |
| Anime | year, season, type.name/shortname/alias/value, anime_status.value/title/alias | Filters, format/status and franchise composition |
| Anime | poster.big/fullsize, genres[].title/alias, views | Cards, genre selectors and sort |
| Anime | rating.average, kp_rating, imdb_rating, anidub_rating, myanimelist_rating, worldart_rating, shikimori_rating | Score sources; counters are excluded; positive unknown *rating* keys may be shown |
| Anime | data.index/text, viewing_order[], remote_ids.myanimelist_id | Family order and episode-date lookup |
| Screenshot | time, id, episode, sizes.small/full | Episode preview/frame selection |
| Video | video_id, iframe_url, number, date, duration, episode_added_at | Provider/episode identity, playback/progress and added-date fallback |
| Video.data | dubbing, player, player_id, translation_id, translation_type | Dub/provider identity and type |
| Video.skips | opening/ending.time/length | Skip segments |
| Schedule | anime_id, episodes.aired/count/next_date/prev_date | Release schedule |

`franchiseCount/franchiseEntries` enrich UI presentation. `originAnimeId/originNumber/contentKind/contentTitle` are added while composing family videos; providers need not supply them.

`normalizeTrailers` recursively recognizes youtube_id/youtubeId/video_id; iframe_url/embed_url/trailer_url/youtube_url/url/link/video/src; title/name; poster/image/thumbnail. YouTube uses youtube-nocookie embed and i.ytimg.com poster fallback. MP4/WebM/OGG URLs are video; other accepted URLs are embeds; image-only URLs are discarded.

## Example reads

From PowerShell against your development backend:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/api/health'
Invoke-RestMethod 'http://127.0.0.1:8000/api/yummy?mode=catalog&limit=12&offset=0'
Invoke-RestMethod 'http://127.0.0.1:8000/api/downloads/library'
Invoke-RestMethod 'http://127.0.0.1:8000/api/gdrive/status'
```

## Static output

If frontend dist exists at import, FastAPI mounts `/assets`, serves existing dist files and falls back to index.html for other GET paths. The catch-all is after API registration and excluded from OpenAPI. Do not mistake an HTML SPA fallback for a JSON endpoint response.
