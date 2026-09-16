[English](RELEASE_0.2.5.md) | [Русский](RELEASE_0.2.5.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.2.5

Provider resilience, faster repeated opens and expanded offline controls on Windows/Android.

## Catalogue and sources

- Persistent SQLite cache for public Yummy/Kodik responses, memory hot layer and stale-if-error fallback.
- Kodik supplements/temporarily replaces Yummy for catalogue/cards/episodes while preserving stable IDs.
- Identical requests coalesce; selected season and near-viewport cards load before background data.
- Correct Shikimori links by external ID or title search on cards/watch screen.

## Player and progress

- Auto-next stays within the current season instead of jumping to alternate edits/next seasons.
- Late media events save the original episode without overwriting the newly selected episode.
- Family/video requests are reused/cancelled without unnecessary background retries.

## Downloads and Android

- Multi-season/range/individual selection; new sets enqueue as separate sequential jobs.
- Watched markers and deletion of selected episodes, season or title.
- Rescan Movies/AnimeSoul after reinstall to rebuild the index from MP4 files.
- System video-read permission and MediaStore deletion confirmation handling.

## Startup, compatibility and files

Source Windows startup installs/builds only when inputs change. Profiles/progress remain compatible with 0.2.4. animesoul-response-cache.sqlite3 is reconstructible cache and can be deleted without losing the profile. Android ARM64/7.0+ retains the release signing key.

- AnimeSoul-Setup-0.2.5.exe — Windows x64.
- AnimeSoul-0.2.5-android-arm64.apk — Android ARM64.
