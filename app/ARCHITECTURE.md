# Architecture

## Dependency direction

```text
React UI -> relative HTTP contract -> FastAPI routes -> services -> API/filesystem
```

The frontend does not know local filesystem paths or upstream credentials.
Routes validate transport data and delegate behavior to services. Services do
not import FastAPI routers. This keeps each layer testable and replaceable.

## Backend

- `api/yummy.py` preserves the response shape consumed by React.
- `services/yummy.py` owns authentication, upstream requests and timeouts.
- `api/storage.py` exposes the shared save document over same-origin HTTP.
- `services/storage.py` performs serialized atomic writes and first-run import.
- `api/watch_party.py` implements the legacy-compatible REST/WebSocket
  protocol.
- `services/watch_party.py` owns rooms, participants, roles and playback state.

## Frontend

- `App.tsx` coordinates screens, profiles and persistent application state.
- `components/Player.tsx` owns media selection and player events.
- `components/SettingsCenter.tsx` owns user customization.
- `hooks/useEpisodeTracking.ts` reconciles new episodes.
- `hooks/useWatchParty.ts` owns room polling and synchronization.
- `lib/types.ts` is the shared domain contract.
- `lib/storage.ts` owns migrations and the versioned save contract.
- `lib/anime.ts` and `lib/tracking.ts` contain pure domain rules.
- `styles/base.css`, `library.css` and `player.css` split CSS by responsibility.

## Save contract

The storage server treats the complete document as opaque JSON after validating
its envelope. React migrates known profile fields by adding defaults. This
combination provides two guarantees:

1. Older saves gain defaults for new features.
2. Unknown future fields survive frontend automatic saves, backend round trips
   and file transfers.

The same rule applies in `app/` and `legacy-old-stack/`. See
[SAVE_COMPATIBILITY.md](SAVE_COMPATIBILITY.md) for the operational workflow.

## Extending the application

Put network and filesystem work in a backend service, transport validation in a
route, pure rules in `lib`, interaction in a component or hook, and styles in
the matching CSS module. Add a regression test whenever a state migration,
watch-party rule or persistence behavior changes.
