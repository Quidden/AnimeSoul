# AnimeSoul 0.1.9 Beta 1

This beta promotes the Python + React implementation to the main AnimeSoul
application. The previous Vinext/Electron implementation remains in
`legacy-old-stack/` for reference and save migration.

## Main changes

- Python/FastAPI backend, React 19 frontend and optional PyWebView desktop mode.
- Compatible import, export and automatic migration of existing AnimeSoul saves.
- Fixed continuation from the real saved episode and timestamp, including
  rewatches and seasons grouped into a franchise.
- Marking an episode as watched no longer prevents it from being replayed.
- Favorites, folders and tracking previews open their detailed views from the
  whole card while their action buttons remain independent.
- Replaced unstable text trash symbols with aligned SVG controls.
- A second launcher start now opens the already-running AnimeSoul instance
  instead of reporting the configured port as broken.
- Critical regression coverage for progress, resume selection, storage and
  watch-party services.

## Installation

1. Extract the archive into a folder where AnimeSoul may keep local data.
2. Install Python 3.11+ and Node.js 22+ if they are not already installed.
3. Run `Start AnimeSoul.bat`.
4. On first launch, enter a free port (3001 by default) and your own YummyAnime
   Public token. Never enter a Private token.

Dependencies are installed automatically on the first launch, so it can take
longer than later starts.

## Beta notes

- This is a beta of the new main stack; keep an exported config backup before
  migrating an important library.
- Video availability, screenshots, precise opening/ending timing and release
  metadata depend on the selected external source.
- AnimeSoul does not include or distribute a shared YummyAnime token.

Huge thanks to the YummyAnime developers for providing the API that made
AnimeSoul possible.
