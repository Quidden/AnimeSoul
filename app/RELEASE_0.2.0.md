[English](RELEASE_0.2.0.md) | [Русский](RELEASE_0.2.0.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.2.0

A major update to the primary Python + React app, collecting changes since 0.1.9 Beta 2.

## Added

- Google Drive cloud backups and save transfer.
- Unified settings center with sections, search and detailed explanations.
- Separate debug journal for actions, status and errors; release history accessible from the header.
- Other-dub episode badge and tracking sorted by new-episode arrival.

## Fixed

- Packaged FastAPI startup and backend-module discovery in installed builds.
- Launcher startup crashes, localized clipboard paste and launcher window appearance.
- Resume, progress, episode tracking and Watch Party issues.
- Cloud-save feedback and Google Drive settings behavior.

## Improved

- Modular Python + React UI prepared for extension.
- Consistent compact API/local/cloud status indicators.
- More consistent settings, library, statistics and playback behavior.
- Compact changelog/debug windows with correct scrolling and shared visual style.

## Compatibility and installer

0.1.9 Beta 2 saves migrate automatically and remain compatible. Config/library/progress live in `%LOCALAPPDATA%\AnimeSoul`. AnimeSoul-Setup-0.2.0.exe installs a standalone launcher, shortcut, browser and desktop modes; users need no Python/Node.js.

No shared API key is included. First launch needs your Public token from the [YummyAnime API documentation](https://api.yani.tv/swagger); private token is not required. Thanks to the YummyAnime developers.
