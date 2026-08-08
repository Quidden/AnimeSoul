# Save compatibility with the legacy stack

The main AnimeSoul app and the legacy stack use the same versioned JSON document.
It contains every profile and each profile contains favorites, folders, notes,
watch progress, episode statistics, tracking, history preferences, themes and
player settings.

For easier manual inspection, current saves also duplicate the human-readable
anime name next to numeric identifiers:

- `snapshot.animeTitles` maps an anime ID to its title;
- each `snapshot.progress[animeId]` may contain a `title` field.

These fields are informational only. AnimeSoul continues to identify anime by
their numeric IDs, so changing or removing a duplicated title does not remap
progress, favorites, folders or tracking.

## Option 1: transfer one profile through the interface

1. Open the source version.
2. Open settings and select **Export config**.
3. Open the destination version.
4. Select **Import config** and choose the downloaded JSON.
5. Confirm switching to the imported profile.

This is convenient for another computer and does not replace other profiles.

## Option 2: transfer the complete local save

Close both AnimeSoul implementations before running either command.

Legacy stack to the main app:

```powershell
cd app
.\.venv\Scripts\python.exe -m tools.transfer_saves to-main
```

Main app to the legacy stack:

```powershell
cd app
.\.venv\Scripts\python.exe -m tools.transfer_saves to-legacy
```

The source file is validated first. If the destination exists, the tool creates
a timestamped `*.backup-*.json` file before atomically replacing it.

The paths are:

- `legacy-old-stack/data/animesoul-storage.json`
- `app/data/animesoul-storage.json`

The main version also performs a one-time non-destructive import from the
legacy stack when the main save does not exist. It never replaces an existing
main save automatically.

## Compatibility guarantees

- Both frontends currently write schema version 3.
- Known fields receive safe defaults during migration.
- Unknown document, profile and snapshot fields are retained by both React
  frontends, the storage backend and the transfer tool, including during normal
  automatic saves.
- Imported profile data is not tied to a browser or desktop window.
- Later features can extend the schema without making older saves unusable.

This is bidirectional: a legacy save can be used by the main app and returned
to the legacy stack if needed. The transfer tool never edits the source file.

The watch-party server address is a device-specific preference. After moving a
profile to another computer or stack, check this value if rooms are hosted at a
different address.

## Recovery

If a transfer was accidental, close AnimeSoul, rename the latest backup to
`animesoul-storage.json`, and start the chosen version again. Do not edit a save
while either implementation is running.
