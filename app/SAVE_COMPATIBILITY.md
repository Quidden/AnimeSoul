[English](SAVE_COMPATIBILITY.md) | [Русский](SAVE_COMPATIBILITY.ru.md)

# Save compatibility and transfer

The current Python/React app and archived Vinext/Electron app read versioned JSON schema **3**. Close both runtimes before copying a complete save. [Data model](docs/DATA_MODEL.md) · [Drive policy](docs/GDRIVE_SYNC.md).

## What transfers

The complete animesoul-storage.json includes all profiles and active ID; favorites/folders/order/notes; progress/positions/completions/rewatches/reset markers; personal scores; tracking baselines/dubs; themes, toolbar, player preferences and library/history settings. Unknown envelope/profile/snapshot fields, including newer field revisions, survive normal round-trip. Readable animeTitles and progress title labels do not change numeric identity.

Device data is separate: Yummy/Kodik credentials, port/configuration, Google OAuth/tokens/choice, community database and voter cookie, downloads/index, runtime identity, debug, party session and desktop zoom. A profile transfer does not move video files or connect cloud accounts.

## One profile through the UI

Open the source profile, Settings → Profiles → export; save `AnimeSoul-<name>.json`. In the destination import the file, choose a new name and optionally switch. Export contains one ConfigSnapshot, not the whole document; import creates a new UUID and preserves other profiles. This works across installed builds/devices.

## Complete document between source directories

Run from `app/` after both runtimes are closed:

```powershell
.\.venv\Scripts\python.exe -m tools.transfer_saves to-main
# Or reverse the direction:
.\.venv\Scripts\python.exe -m tools.transfer_saves to-legacy
```

Fixed endpoints are `legacy-old-stack/data/animesoul-storage.json` and `app/data/animesoul-storage.json`. The tool does not discover LocalAppData or custom data_directory. For those locations use UI export/import or copy the full file between actual configured directories with the runtimes stopped.

The tool checks source existence/UTF-8 JSON and envelope fields, copies an existing destination to `animesoul-storage.backup-YYYYMMDD-HHMMSS-microseconds.json`, writes `animesoul-storage.json.transfer.tmp`, then atomically replaces destination. Source remains unchanged; JSON whitespace is normalized, unknown nested content retained.

## First legacy import

JsonStorage.read tries the configured legacy candidate only when the current save is absent. Valid legacy data is copied, never removed; invalid legacy JSON is ignored; an existing current save is not replaced. Backend validation requires usable profiles/IDs/snapshots. Corruption in an existing current save must not be interpreted as a missing file by the frontend.

Compatibility means the file can be opened and returned without silently stripping unknown fields. It does not guarantee that the archived UI exposes new features. Current merge additionally respects per-field revisions/reset markers; avoid editing those by hand.

## Installed/custom paths and recovery

Find data_directory in the actual config; close launcher/client/runtime; back up destination; validate source JSON; copy as animesoul-storage.json; start only the target app and verify/export a profile. Never replace a file while a running client can autosave its in-memory state over it.

To undo a bad transfer, stop both runtimes, keep the bad file separately, restore the newest matching backup as animesoul-storage.json, then check the active profile. Alternatives are profile export, cloud copy or the other implementation's source file. Cloud restore creates a local backup before replacement; verify which side has the desired data before a directional restore.

On the destination recheck Watch Party server address, local API keys, Google connection, port and device UI scale. Google/Kodik credentials are deliberately outside portable saves.
