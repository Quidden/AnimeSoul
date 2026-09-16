[English](README.md) | [Русский](README.ru.md)

# AnimeSoul — application and development guide

Version **0.2.7**. The maintained application lives here: React 19 + TypeScript + Vite, Python/FastAPI, optional PyWebView, and an Android wrapper with embedded Python. See the [project overview](../README.md), [screenshots](docs/SCREENSHOTS.md), and [documentation index](docs/README.md).

## Install and start

Download packaged builds from [Releases](https://github.com/Quidden/AnimeSoul/releases). Source startup on Windows requires Python 3.11+, Node.js 22+ and internet access for dependency installation. CI uses Python 3.12. Configure YummyAnime Public token for its catalogue; direct Kodik streams/downloads need the separate Kodik Public/Private pair. Google OAuth is optional.

| Launcher in this directory | Action |
| --- | --- |
| `Start AnimeSoul.bat` | Prepare dependencies/build and start the saved mode |
| `Start AnimeSoul in Browser.bat` | Start in a browser |
| `Start AnimeSoul Desktop.bat` | Start a PyWebView window |
| `Configure AnimeSoul.bat` | Configure port, token and launch mode again |

Source settings: `app/animesoul.python.json` (Git-ignored). Installed settings: `%LOCALAPPDATA%\AnimeSoul\animesoul.python.json`, with data in its `data` subdirectory by default. Backend environment variables can override paths; see [Data model](docs/DATA_MODEL.md). In PyWebView, Ctrl + wheel changes interface zoom from 50% to 200%; Ctrl+0 resets it. Zoom is device-local.

## Develop

Run these commands from the repository root in PowerShell. Backend terminal:

```powershell
cd app
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
# Configure animesoul.python.json using the launcher, or set the required environment values.
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend terminal, also starting at the repository root:

```powershell
cd app\frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api`, `/watch-party` and `/ws` to port 8000. Production is served by FastAPI on one origin. Build and run from `app/`:

```powershell
npm --prefix frontend run build
.\.venv\Scripts\python.exe run.py --mode browser
```

`run.py` accepts `--mode browser|desktop`, `--configure`, and `--config <path>`. Launcher startup checks runtime identity and required API capabilities before reusing an existing process; an unrelated occupied port triggers a search for a free port.

## Validate

From `app/`:

```powershell
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm --prefix frontend run check
.\.venv\Scripts\python.exe tools/check_docs.py
```

The frontend gate runs ESLint, strict TypeScript, CSS audit, critical-logic tests, production build and bundle-budget audit. GitHub Actions runs the backend and frontend quality gates on push and pull request. The documentation checker verifies local links, bilingual guide pairs and route coverage.

For player browser regressions, run Vite and open `/tests/player-browser.html`. It exercises the real React player using controlled video events: cursor, control hiding, keyboard, touch and stream changes. It is separate from `npm run check`. Real HLS decoding, device PiP, Cast and Android lifecycle still require integration/device checks. See [Platforms](docs/PLATFORMS.md).

## Technical entry points

- [Architecture](ARCHITECTURE.md): layers and boundaries.
- [UI](docs/UI.md) and [Backend](docs/BACKEND.md): ownership, functions and runtime behavior.
- [HTTP API](docs/API_REFERENCE.md) and [generated route/model inventory](docs/API_SCHEMA.md): requests, responses, errors and callers.
- [Call flows](docs/ENTRY_POINTS_AND_FLOWS.md) and [project map](docs/PROJECT_MAP.md): where changes belong.
- [Data](docs/DATA_MODEL.md), [Drive sync](docs/GDRIVE_SYNC.md), [save compatibility](SAVE_COMPATIBILITY.md): schema 3, merge and recovery.
- [CSS](docs/STYLES.md) and [refactoring guide](docs/REFACTORING_RECOMMENDATIONS.md).

FastAPI exposes interactive OpenAPI at `/docs`, ReDoc at `/redoc`, and the live schema at `/openapi.json`. The handwritten API guide adds dynamic payloads, native bridges and runtime restrictions not captured by OpenAPI.

## Product boundaries

Browser and desktop clients share the same backend/save. Android embeds the same stack, omits Watch Party, supports a floating mini-player, native PiP and MediaStore downloads. Cast is experimental and only supports direct online HTTPS HLS/MP4. Metadata, streams, subtitles and previews depend on the providers.

Profile exports preserve library/progress/preferences and unknown fields. They exclude credentials, download files/index, runtime state and community databases. Read [save compatibility](SAVE_COMPATIBILITY.md) before changing schema or moving data.
