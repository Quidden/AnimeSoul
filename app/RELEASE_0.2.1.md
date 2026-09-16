[English](RELEASE_0.2.1.md) | [Русский](RELEASE_0.2.1.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.2.1

Personal/shared ratings, expanded search and more reliable local-server startup. Large parts of the Python + React app were separated into modules without changing the compatible save format.

## Added

- Personal 1–10 scores for anime, seasons and episodes, with automatic season/title averages.
- A ratings page for quick editing of the saved score tree.
- Anonymous AnimeSoul anime/season/episode aggregates on the current server.
- Simultaneous AnimeSoul, YummyAnime, Shikimori, MyAnimeList, IMDb and other API-provided ratings.
- Trailer/cinematic resume preview on home.
- Launcher server-status panel and safe stop for the process owned by the current installation.

## Fixed

- Search recognizes wrong Russian/English keyboard layouts, transliteration, joined words, popular abbreviations and alternative titles.
- Identical concurrent searches share Yummy requests; short cache speeds repeated search.
- Occupied ports select a nearby free port; repeated launch reopens a running instance.
- Launcher distinguishes AnimeSoul from other apps and stops only an instance whose ownership is confirmed.
- Blank Google Client Secret no longer erases the saved value.
- Cloud merge uses rating/progress/position timestamps and preserves unknown fields.
- More precise rewatch, manual marks, new-release tracking and party command synchronization.

## Improved

- Catalogue rating-source/minimum filters and scores on cards/watch screen.
- Independent home/catalogue/statistics/settings/player/storage/integration modules.
- Pure Drive merge independent of OAuth/HTTP/filesystem.
- Thematic CSS modules preserving cascade order.
- Regression tests for ratings, search, port conflicts, merge, progress, tracking and party.

## Compatibility and installer

0.2.0 saves remain compatible with unchanged schema. Personal scores live in profiles; unknown fields survive loading/saving/import/Drive sync. Shared scores belong to the connected backend; independent local servers do not automatically exchange votes.

AnimeSoul-Setup-0.2.1.exe installs a standalone launcher, shortcuts and browser/desktop modes; Python/Node.js are not required. No shared API key is included. Catalogue/video/trailers need your Public token from the [YummyAnime API documentation](https://api.yani.tv/swagger); private token is not used. Thanks to YummyAnime.
