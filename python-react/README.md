# AnimeSoul — Python + React experiment

This is a **separate test implementation** of AnimeSoul. It does not replace or
modify the main Vinext/Electron application in the repository.

The current React interface was preserved, while its server responsibilities
were moved to Python:

- React 19 + TypeScript + Vite render the catalog, library, player and settings.
- FastAPI proxies YummyAnime, saves profiles and hosts watch-party rooms.
- JSON storage remains portable and compatible with AnimeSoul profile exports.
- REST endpoints keep the existing UI contract; a WebSocket endpoint is also
  available for future lower-latency watch-party updates.

## Quick launch on Windows

Run:

`Start AnimeSoul Python React.bat`

Prerequisites: Python 3.11 or newer, Node.js 22 or newer, and internet access
for the first dependency installation.

The launcher creates an isolated Python environment, installs dependencies,
builds React and opens the site. On first launch it asks for:

1. A local port (default `8000`).
2. Your own **Public token** from the YummyAnime API documentation.

The values are saved locally in `animesoul.python.json`. This ignored file can
be edited manually while AnimeSoul is closed. A private token is never needed.

## Development

Backend:

```powershell
cd experiments/python-react
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

Frontend in another terminal:

```powershell
cd experiments/python-react/frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite forwards API, storage and watch-party calls
to FastAPI. A production build is served by FastAPI at its configured port:

```powershell
npm --prefix frontend run build
.\.venv\Scripts\python.exe run.py
```

## Where to edit

```text
python-react/
├── backend/
│   ├── app/api/          # Thin HTTP routes: YummyAnime, storage, watch party
│   ├── app/services/     # Reusable business and infrastructure logic
│   ├── app/config.py     # All environment and path decisions
│   └── tests/            # Python regression tests
├── frontend/
│   └── src/
│       ├── components/   # Player, settings, cards and reusable controls
│       ├── hooks/        # Tracking and watch-party state machines
│       ├── lib/          # Types, migrations and pure domain helpers
│       └── styles/       # Base, library and player CSS responsibilities
├── run.py                # First-run configuration and server launcher
└── Start ... .bat        # One-click Windows bootstrap
```

Code comments are intentionally in English. Comments explain architectural
decisions and non-obvious behavior; names and modules describe ordinary code so
the project stays readable instead of becoming comment-heavy.

## Implemented feature surface

The React copy includes the current catalog and filtering, franchise grouping,
anime details, player preferences, opening/ending skip, progress per episode,
resume playback, history, statistics, favorites, custom folders, profiles,
import/export, themes, new-episode tracking, release schedules, previews and
watch-party controls.

The FastAPI version implements the server-side capabilities required by those
features: API proxying, persistent profiles, REST watch-party synchronization,
participant state and optional WebSocket broadcasts.

## Data and migration

Runtime data is stored in:

`experiments/python-react/data/animesoul-storage.json`

To test existing saves, close both versions and copy the main project's
`data/animesoul-storage.json` into this experiment's `data` folder. Keep a
backup before replacing either file. Profile export/import in the interface is
the safer option when schema versions differ.

## Tests

```powershell
cd experiments/python-react
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm --prefix frontend run build
```

Thanks to the YummyAnime developers for making their API available. AnimeSoul
could not exist in its current form without their work.
