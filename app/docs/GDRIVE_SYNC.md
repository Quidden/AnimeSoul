[English](GDRIVE_SYNC.md) | [Русский](GDRIVE_SYNC.ru.md)

# Google Drive: OAuth, synchronization and merge

Owners: `api/gdrive.py`, shared `services/gdrive.py::get_gdrive_service`, pure `gdrive_merge.py`, `lib/gdrive.ts`, `useGoogleDriveSettings`, `useHeaderCloudSync`. [API](API_REFERENCE.md) · [Data](DATA_MODEL.md).

## Files and credentials

Visible storage is `AnimeSoul/animesoul-storage.json`; appdata mode uses Drive appDataFolder. Saved `gdrive-credentials.json` takes precedence over environment/config fallback, including Google installed-client JSON. Empty secret preserves an existing secret. Credential API saves only when probe checks are all valid; changes to resolved credentials disconnect old tokens. Secrets/tokens never appear in profile export or status.

## Authorization lifecycle

1. Save/check your OAuth client in Settings → Keys.
2. Request auth-url with the actual callback URI; default is backend origin + `/api/gdrive/oauth2callback`.
3. Browser opens Google consent with drive.file, drive.appdata and userinfo.email scopes, offline access and consent.
4. Callback consumes a one-use in-memory state with a 10-minute TTL. Current code uses authorization code without PKCE.
5. Desktop exchanges code, obtains userinfo, inspects cloud data and stores tokens. HTML sends `GDRIVE_AUTH_SUCCESS` to the opener's strict origin.
6. Android can save code/redirect as pending OAuth and exchange on foreground through `/complete-auth`. A lock serializes deep-link and foreground attempts; transient transport failure retains a valid pending code for retry.
7. Status reports connected/oauth_pending/choice_pending and sync outcome. Browser callback HTTP success is not itself proof of successful OAuth.

Disconnect attempts Google token revocation and always cleans local connection/pending state; it returns `revoked`. Saved client configuration and cloud file remain. It does not delete the backup in Drive.

## First cloud choice

When a cloud save is found, `choice_pending` blocks automatic upload **on the backend as well as in the UI**. PUT storage still saves locally but reports cloud_sync_blocked. Explicit sync returns 409 until a user choice is submitted with `resolve_initial_choice:true`; mode auto is not allowed for this initial resolution (422). This prevents an old tab/timer from silently replacing cloud data.

## Modes

```json
{"mode":"merge","prefer_watched":true,"folder_mode":"visible","resolve_initial_choice":false}
```

| Mode | Local result | Cloud result |
| --- | --- | --- |
| local | Original document | Replaced by local document |
| cloud | Replaced by validated cloud document, previous file backed up | Original cloud document |
| merge | Merged document | Same merged document |
| anime_only | Merged document with local theme/playerPrefs | Same merged document |
| auto | Upload if cloud absent; merge if both exist; restore if only cloud exists | Depends on branch |

Responses carry uploaded/downloaded/merged status, document, optional file_id and restoration backup. Missing tokens → 401; missing cloud for restore → 444; absent local upload source → 409; invalid local save → 500 before cloud mutation. Local/cloud directions replace one side and the UI asks the user to choose deliberately.

## Conflict policy

Document `updatedAt` determines envelope precedence. ISO strings, Unix seconds and JavaScript milliseconds normalize to seconds; missing/invalid is 0. Local wins ties. Each collection/preference independently uses `snapshot.fieldUpdatedAt[field]`, falling back to its document timestamp. `changedFieldRevisions` updates only changed fields. A progress edit on an old device therefore cannot roll back a newer theme. Merge does **not** unconditionally union every collection: membership follows the newer revision of that field.

| Area | Rule |
| --- | --- |
| Envelope | Unknown fields from newer over older; schemaVersion max; newer updatedAt |
| Profiles | Union IDs from local then missing cloud profiles; no profile-deletion tombstones exist; fallback activeProfile to an existing ID |
| Unknown profile/snapshot fields | Selected side wins; anime_only gives local initial precedence |
| Favorites | Entire list from newer favorites revision; sorted union without revisions/fallback timestamps |
| Folders | Match by ID; membership/order and animeIds from newer folders revision; union without a selected source; notes merge with source values winning |
| Tracking | Membership/dubs/pending keys from newer tracked revision; known anime/episode keys union; counters recomputed/max; latest check/new timestamps |
| Progress | Union anime IDs; latest resetAt drops episode records at/before reset; remaining episodes union; selection metadata follows latest episode timestamp (local on tie) |
| Episode state | Newer updatedAt fields; union sorted completionHistory; maximum completions/watchedSeconds/duration; position follows newer record, preserving backward seeks |
| Watched flags | OR completed/manuallyCompleted when prefer_watched true; otherwise newer record wins |
| Legacy time | Maximum when present |
| Ratings | Entire map from newer ratings revision, preserving deletions; without a selected source union IDs and choose larger per-anime rating updatedAt (local tie) |
| animeTitles | Merge with source winning, then fill progress titles; anime_only favors local |
| watchingHidden | Newer watchingHidden revision list, or union without a selected source |
| Settings | theme/toolbar/playerPrefs/history/layout each follows its own revision; merged fieldUpdatedAt keeps maxima |
| anime_only | Keeps local theme/playerPrefs; result is still a complete StorageDocument, not only progress |

## Autosave and concurrency

| UI mode | Behavior |
| --- | --- |
| instant | Debounced local PUT requests cloud scheduling after first choice |
| interval | PUT stays local; `useHeaderCloudSync` calls merge at selected 1/5/15/30/60 minute interval |
| manual | Only explicit sync commands upload; local saves continue |

Queue: schedule_write copies the newest pending document; an existing worker is reused. Worker rereads latest local, reads cloud, merges, uploads, and writes merged local only when no newer local save arrived during I/O. New pending input repeats the loop. Failed pending data remains for a later retry and status exposes last_sync_error.

Header polls status immediately/every 2.5 seconds while mounted; open settings adds its own polling. On sync success, frontend reloads storage so React matches the file. `sync_running`, `sync_pending`, last_sync_started_at/last_sync_at and last_sync_error separate local durability from confirmed cloud upload.

## Validation and recovery

Use source tests in `backend/tests/test_gdrive.py` and `test_storage_safety.py` for deletion, timestamp, prefer_watched, anime_only, shared queue, initial-choice and malformed-file cases. Test OAuth/network/native foreground separately. On failed upload, local save is retained. On mistaken restore, close the runtime and recover the previous backup. Expired/consumed OAuth state requires a new login URL.
