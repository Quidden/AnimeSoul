[English](RELEASE_0.1.9-beta.1.md) | [Русский](RELEASE_0.1.9-beta.1.ru.md)

> Historical release notes; see the [current documentation](docs/README.md) for today's contracts.

# AnimeSoul 0.1.9 Beta 1

This beta made Python + React the primary implementation. The previous Vinext/Electron stack remains in legacy-old-stack for reference and save migration.

## Main changes

- Python/FastAPI backend, React 19 frontend and optional PyWebView desktop mode.
- Compatible import/export and automatic migration of older saves.
- Resume from the actual saved episode/position, including rewatches and franchise seasons.
- Manually marking an episode watched no longer prevents replaying it.
- Favorite/folder/tracking cards open details across the card surface while action buttons remain independent.
- Unstable text trash symbols replaced by aligned SVG controls.
- Repeated launcher startup opens the running instance instead of reporting an occupied port.
- Critical regression tests for progress, resume, storage and Watch Party services.

## Installation for this beta

1. Extract to a directory where AnimeSoul can store local data.
2. Install Python 3.11+ and Node.js 22+ if needed.
3. Run Start AnimeSoul.bat.
4. On first launch choose a free port (default 3001 in this beta) and your YummyAnime Public token. Do not enter the private token.

The first startup installs dependencies and takes longer. Export important library data before migration. Video, preview frames, opening/ending timestamps and release metadata depend on providers. No shared YummyAnime token is included/distributed. Thanks to the YummyAnime developers for making AnimeSoul possible.
