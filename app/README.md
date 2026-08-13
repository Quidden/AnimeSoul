# AnimeSoul — main application

Current release: **0.2.1**.

This folder contains the current AnimeSoul implementation. All new feature
development happens here. The previous Vinext/Electron implementation is
archived in `legacy-old-stack/` for reference and save migration.

The current feature set is ported without changing the user data model:

- React 19, TypeScript and Vite render the catalog, library, player, settings
  and statistics.
- FastAPI proxies YummyAnime, stores profiles and serves watch-party rooms.
- PyWebView provides an optional native desktop window.
- The browser and desktop modes use the same FastAPI process and the same save.
- The save schema remains compatible with the legacy implementation.

## Quick launch on Windows

Use one of these files:

- `Start AnimeSoul.bat` — starts the mode saved during setup.
- `Start AnimeSoul in Browser.bat` — always opens a browser.
- `Start AnimeSoul Desktop.bat` — always opens the desktop window.
- `Configure AnimeSoul.bat` — changes the port, Public token and default mode.

In desktop mode, hold **Ctrl** and rotate the mouse wheel to scale the complete
interface from 50% to 200%. Press **Ctrl+0** to return to 100%. The selected
scale is stored locally and restored on the next desktop launch.

Prerequisites: Python 3.11+, Node.js 22+ and internet access during the first
dependency installation.

The first launch asks for a local port, your own YummyAnime **Public token** and
the preferred mode. Settings are stored in ignored local file
`app/animesoul.python.json`. Never enter a Private token.

## Save compatibility

Both implementations use schema version 3. Unknown fields are preserved while
loading, migrating, automatically saving or copying a save.

- For one profile, use **Export config** in one version and **Import config** in
  the other version.
- For all profiles, progress and settings, use the transfer tool described in
  [SAVE_COMPATIBILITY.md](SAVE_COMPATIBILITY.md).
- On its first run, the main version imports the legacy save if its own
  save does not exist yet. Existing main-app data is never overwritten silently.
- Older builds add defaults for fields they understand while retaining fields
  introduced by the other implementation.

## Development

Backend:

```powershell
cd app
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

Frontend in another terminal:

```powershell
cd app\frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite forwards API, storage and watch-party calls
to FastAPI. A packaged frontend is built and served by FastAPI:

```powershell
npm --prefix frontend run build
.\.venv\Scripts\python.exe run.py --mode browser
```

## Project map

```text
app/
|-- backend/
|   |-- app/api/          # Thin HTTP routes
|   |-- app/services/     # Storage, YummyAnime and watch-party logic
|   |-- app/config.py     # Environment and filesystem configuration
|   `-- tests/            # Python regression tests
|-- frontend/
|   `-- src/
|       |-- pages/        # Screen-level composition
|       |-- features/     # Catalog, player, settings, storage and party modules
|       |-- components/   # Shared UI and orchestration shells
|       |-- hooks/        # Cross-feature effects and subscriptions
|       |-- lib/          # Shared contracts, migrations and typed events
|       `-- styles/       # Base, library and player styles
|-- tools/
|   `-- transfer_saves.py # Lossless transfer in both directions
|-- run.py                # Browser and desktop launcher
`-- Start ... .bat        # One-click Windows entry points
```

Comments in source code are intentionally written in English. They explain
architecture and non-obvious behavior, while clear names document ordinary
code.

See [ARCHITECTURE.md](ARCHITECTURE.md) for dependency rules and data flows, and
[docs/REFACTORING_RECOMMENDATIONS.md](docs/REFACTORING_RECOMMENDATIONS.md) for
the completed work and the next safe extraction phases.

## Feature coverage

The React application includes catalog search and filters, franchise grouping,
anime pages, available dubs and sources, progress per episode, resume playback,
opening and ending skip, favorites, custom folders, history, statistics,
profiles, themes, release schedules, new-episode tracking, episode previews,
manual watched marks and synchronized watch-party controls.

The same AnimeSoul `AS` artwork is used for the web favicon and header, launcher,
desktop runtime, installer and Windows shortcuts.

## Verification

```powershell
cd app
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Huge thanks to the YummyAnime developers for making their API available.
AnimeSoul could not exist in its current form without their work.
