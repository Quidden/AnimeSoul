[English](DATA_MODEL.md) | [Русский](DATA_MODEL.ru.md)

# Data model and local state

Profile/document schema **3**. Domain types: [types.ts](../frontend/src/lib/types.ts); defaults and keys: [settings.ts](../frontend/src/lib/settings.ts); builders: [profileDocument.ts](../frontend/src/features/storage/profileDocument.ts). [Save portability](../SAVE_COMPATIBILITY.md) · [Cloud merge](GDRIVE_SYNC.md).

## Storage locations

| Environment | Configuration | Default data |
| --- | --- | --- |
| Source | `app/animesoul.python.json` | `app/data/` |
| Installed Windows | `%LOCALAPPDATA%\AnimeSoul\animesoul.python.json` | `%LOCALAPPDATA%\AnimeSoul\data\` |
| Explicit CLI | `run.py --config <path>` | Configured data_directory |
| Android | App-private configuration/runtime | Private app data/index; completed movies in MediaStore `Movies/AnimeSoul` |

| File | Owner / role | Portable profile? |
| --- | --- | --- |
| `animesoul-storage.json` | JsonStorage; complete profile document | Yes |
| `animesoul-storage.tmp.json`, backups | Atomic save/recovery | Separate copies |
| `api-credentials.json` | Saved device Yummy Public token | No |
| `animesoul-offline-settings.json` | Download directory, public Kodik key, mobile policy | No |
| `animesoul-kodik-private.dpapi` | Protected private Kodik key; platform-specific protection | No |
| `.animesoul-library.json` in library directory | Download index | No |
| `animesoul-anime-identities.json` | Hybrid catalogue identity registry | No |
| `gdrive-credentials.json` | OAuth client_id/client_secret | No |
| `gdrive-tokens.json` | OAuth tokens, user info, cached cloud choice/state | No |
| `gdrive-pending-oauth.json` | Pending Android code exchange | No |
| `community-ratings.sqlite3` | Anonymous rating trees, SQLite WAL | No |
| `animesoul-response-cache.sqlite3` | Public provider JSON cache, SQLite WAL | No |
| `animesoul.runtime.json` beside config | Runtime identity, not user data | No |

Downloaded videos, thumbnails and index are independent of the profile. Moving the profile does not copy media, credentials or native permissions.

## Configuration precedence

Backend `load_settings` reads `.env` with setdefault, then JSON and environment overrides. Source defaults: port 8000, browser launch mode, data directory `app/data`. Packaged launcher commonly uses port 3001. JSON: port, yummy_public_token (legacy yummyAnimeToken), data_directory, launch_mode, gdrive_client_id/gdrive_client_secret.

| Variable | Override |
| --- | --- |
| `ANIMESOUL_CONFIG_FILE` | Config path |
| `ANIMESOUL_PYTHON_PORT` | Port |
| `ANIMESOUL_DATA_DIR` | Data directory |
| `ANIMESOUL_FRONTEND_DIST` | Frontend build directory |
| `YUMMYANIME_TOKEN` | Base Yummy token; a UI-saved device token takes precedence in the Yummy router |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth config fallback; saved Drive credentials take precedence |
| `ANIMESOUL_INSTANCE_ID`, `ANIMESOUL_RUNTIME_STATE_FILE` | Runtime identity/state path |
| `ANIMESOUL_MOBILE=android` | Backend Android behavior / exclude party |
| `VITE_ANIMESOUL_PLATFORM=android` | Build-time frontend platform; outputs dist-android |

Relative data_directory resolves against `app/`. Runtime identity contains instance_id, pid, port, mode, started_at; launcher validates health identity before stop and requires API capabilities for reuse.

## Document envelope

```ts
type StorageDocument = {
  schemaVersion: number;
  updatedAt: string;
  activeProfile: string;
  profiles: ConfigProfile[];
  [unknownField: string]: unknown;
};
type ConfigProfile = {
  id: string;
  name: string;
  snapshot: ConfigSnapshot;
  [unknownField: string]: unknown;
};
```

`migrateDocument` supplies known defaults and a usable default/active profile; migrations preserve unknown fields. `buildProfileSnapshot` starts from the previous snapshot, then overrides known state. `buildStorageDocument` retains the previous envelope. Backend validates nonempty profiles with string IDs/object snapshots and a valid active ID when present, but does not migrate domain fields. Shared path locks serialize all JsonStorage instances; writes use temp+replace. Full cloud restoration backs up the old file.

## Snapshot fields

| Field | Meaning |
| --- | --- |
| version/name/createdAt | Schema 3 and exported snapshot metadata |
| fieldUpdatedAt | Per-field revision map; changes only when that field changes |
| favorites | Unique ordered anime IDs |
| folders | `{id,name,animeIds,notes?}`; note keys are anime IDs |
| progress | Anime ID → current selection plus per-episode progress |
| ratings | Personal anime/season/episode score tree |
| animeTitles | Readable ID → title labels; never identity keys |
| tracked | Franchise subscriptions and episode baselines |
| theme | `{name,accent,background}` |
| toolbar | top/bottom/left/right |
| playerPrefs | Playback/UI preferences; defaults in settings.ts |
| historyClearedAt/historyEnabled | History visibility and cutoff; progress remains independent |
| libraryExpanded/watchingExpanded/historyExpanded/watchingHidden | Library presentation state |

## Progress and completion

`Progress = Record<number, AnimeProgress>`. AnimeProgress has episode (string), dub, episodes map, optional title/season/seasonLabel/totalEpisodes/totalDuration/originAnimeId/originEpisode. Episode map keys normally use `<season>:<episode>`.

| EpisodeState field | Semantics |
| --- | --- |
| position/duration/percent | Last known position and proportion |
| updatedAt | Milliseconds; resume and conflict priority |
| originAnimeId/originEpisode | Original source episode identity across franchise regrouping |
| completed/completions | Watched state and repeat completions |
| completionHistory | Completion timestamps in ms |
| rewatchArmed | Rewound to count a new completion |
| watchedSeconds | Accumulated viewing time for statistics |
| manuallyCompleted/manualPrevious | Manual mark and reversible previous state |

`latestResumePoint` chooses by update time; `episodeResumePosition` avoids resuming at the end of a completed episode. `toggleEpisodeWatched` restores manualPrevious on undo. Removing a favorite/folder does not erase progress; changing a title label does not move identity.

`AnimeProgress.resetAt` is a reset tombstone: cloud merge discards episode records whose updatedAt is at or before the latest resetAt from either side. `changedFieldRevisions` tracks edits independently for collections/preferences so a later progress save on an old device does not revert a newer theme. Profile IDs are unioned during merge; there is no profile-deletion tombstone.

## Tracking

Tracker has animeId/title/knownEpisodes/newEpisodes plus optional animeIds, selected dubs, lastCheckedAt/lastNewEpisodeAt. `knownEpisodeKeys/pendingEpisodeKeys` cover selected dubs; `knownAnyEpisodeKeys/pendingOtherDubEpisodeKeys/otherDubEpisodes` describe availability in other dubs. `episodeIdentityCheckedIds` records successful one-time repair of an old numbering baseline.

Baseline repair requires episode_identity_version 1 plus successful source states; failed titles/old backend responses retain their previous baseline. After repair, known keys grow to prevent repeated notifications when a provider temporarily loses an episode. Poll every 300 seconds, skip checks younger than 240 seconds, preserve baseline on total failure.

## Ratings, preferences and local mirrors

Personal ratings contain optional anime score/title/updatedAt and season/episode maps. Scores are 1–10; episode keys are `<season>:<episode>`. They travel in the profile. Server community aggregates are separate `{average,count}` trees and identify browsers by HttpOnly cookie.

Theme presets are Amethyst, Sakura, Ocean, Mango and Light (Russian labels); custom colors are stored in the profile. `PlayerPrefs` covers resume, auto-next/skips, previews, quality/player behavior, watched colors and UI size scales. Read the actual type/defaults when adding a preference; not every device/bridge capability can honor every preference.

`localStorage` mirrors known state with keys in `lib/settings.ts::STORAGE_KEYS` (usually imported as `K`); profile hydration refreshes it from the file. Cloud scheduling/first-choice markers, debug journal, device UI scale and publication tombstones are local state, not a portable document. Watch Party uses sessionStorage. Do not infer a successful file/cloud save merely from an updated mirror.

## Migration and recovery

Export/import keeps unknown root/profile/snapshot fields through ordinary round-trip. Legacy may retain fields without presenting their functionality. Full transfer tool uses fixed repository data paths, validates source, backs up destination and atomically replaces it. Close runtimes before manual copies. A backend 404 means absent save; errors/corruption are separate and must not trigger overwrite. [Compatibility and recovery](../SAVE_COMPATIBILITY.md).
