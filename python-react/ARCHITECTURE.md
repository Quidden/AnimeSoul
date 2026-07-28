# Architecture notes

## Dependency direction

`React UI → relative HTTP contract → FastAPI routes → services → filesystem/API`

The frontend does not know filesystem paths or upstream credentials. Routes do
not implement domain state themselves. Services do not import FastAPI routers.
This direction keeps each layer independently replaceable and testable.

## Backend modules

- `api/yummy.py` preserves the response shape already consumed by React.
- `services/yummy.py` owns authentication, normalization and timeout policy.
- `api/storage.py` validates the HTTP boundary.
- `services/storage.py` serializes atomic writes to prevent save corruption.
- `api/watch_party.py` supports the current polling client and WebSockets.
- `services/watch_party.py` owns rooms, participants and playback state.

## Frontend modules

- `App.tsx` coordinates top-level screens and persisted profile state.
- `components/Player.tsx` owns media selection and player events.
- `components/SettingsCenter.tsx` owns discoverable user customization.
- `hooks/useEpisodeTracking.ts` owns new-episode reconciliation.
- `hooks/useWatchParty.ts` owns room polling and host-follow behavior.
- `lib/*.ts` contains pure helpers, types, defaults and migrations.
- `styles/base.css`, `library.css`, `player.css` divide CSS by responsibility.

When expanding a feature, keep network or filesystem work in a backend service,
keep pure rules in `lib`, and let components focus on interaction and markup.
