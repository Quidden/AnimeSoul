# AnimeSoul

The Python + React implementation is now the main AnimeSoul application.

| Folder | Purpose | Stack |
| --- | --- | --- |
| [`app/`](app/) | Current application for browser and desktop use | React, TypeScript, Vite, Python, FastAPI, PyWebView |
| [`legacy-old-stack/`](legacy-old-stack/) | Archived previous implementation kept for reference and save migration | React, TypeScript, Vinext, Electron |

For normal use, open [`app/README.md`](app/README.md) or run the root
[`Start AnimeSoul.bat`](Start%20AnimeSoul.bat). New development belongs in
`app/`; the legacy folder should receive only compatibility or security fixes.

Contributor documentation: [`app/ARCHITECTURE.md`](app/ARCHITECTURE.md) explains
module boundaries and data flows; the incremental roadmap is in
[`app/docs/REFACTORING_RECOMMENDATIONS.md`](app/docs/REFACTORING_RECOMMENDATIONS.md).

The Git repository metadata stays at this root, while application code is kept
inside the two version folders.

## Moving saves between implementations

The two versions use the same profile schema. A single profile can be exported
and imported through the AnimeSoul settings UI. The full save, including every
profile, can be copied safely in either direction with automatic backups:

```powershell
cd app
.\.venv\Scripts\python.exe -m tools.transfer_saves to-main
.\.venv\Scripts\python.exe -m tools.transfer_saves to-legacy
```

Close both versions first and run only the direction you need. Full details and
recovery steps are in
[`app/SAVE_COMPATIBILITY.md`](app/SAVE_COMPATIBILITY.md).

Both frontends preserve fields they do not recognize during normal automatic
saves. This allows a save created by a newer implementation to be opened in the
other implementation without silently deleting newer settings.
