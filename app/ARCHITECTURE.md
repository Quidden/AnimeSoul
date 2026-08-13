# AnimeSoul architecture

AnimeSoul uses a feature-oriented React frontend and a layered FastAPI backend.
The same backend serves browser and PyWebView desktop modes, so both modes use
the same API contracts and profile storage.

## System flow

```text
React pages
  -> feature components and hooks
  -> same-origin HTTP / WebSocket clients
  -> FastAPI routes
  -> services
  -> YummyAnime, Google Drive, rooms and local JSON storage
```

The frontend never receives filesystem paths or private upstream credentials.
Routes validate transport data and delegate behavior. Services do not import
React or FastAPI routers.

## Frontend layers

### Application shell

- `App.tsx` coordinates route state and composes typed page view models.
- `components/Header.tsx` exposes navigation and global status.
- `components/AppFooter.tsx` owns the shared product footer.
- `lib/types.ts` is the shared domain contract.
- `lib/storage.ts` owns schema migrations and compatibility defaults.
- `lib/events.ts` defines typed browser events instead of anonymous strings.

The application shell may compose features but must not duplicate their domain
rules or raw network requests.

### Pages

`pages/` contains screen-level composition:

- `StatisticsPage.tsx` renders statistics from library selectors.
- `FolderView.tsx` renders a selected collection.
- `CatalogPage.tsx` renders catalog filters, cards, pagination and random pick.
- `HomePage.tsx` composes the home screen from focused modules in
  `pages/home/` (`HomeHero`, dashboard widgets and library sections).

Anime-detail composition remains behind the `Watch` feature shell. It is the
next page boundary to extract when player behavior has sufficient regression
coverage.

### Features

`features/` is organized by user capability:

- `catalog/api.ts`: catalog, anime details, videos and release schedules.
- `catalog/useCatalogController.ts`: catalog request and filter state.
- `catalog/useCatalogPresentation.ts`: franchise grouping and card metadata.
- `library/selectors.ts`: pure history, progress, folder and statistics views.
- `player/useResumePreview.ts`: the latest resumable episode and preview.
- `player/activeWatchActions.ts`: progress persistence and tracking
  acknowledgement for the active title.
- `player/`: toolbar, seasons, release schedule, metadata and party UI.
- `settings/`: setting definitions, setting rows, appearance, profiles and
  Google Drive settings.
- `storage/profileDocument.ts`: versioned profile document construction.
- `tracking/api.ts`: new-episode refresh transport.
- `watch-party/api.ts` and `types.ts`: REST/WebSocket room contract.

Feature API modules only perform transport work. Selectors are pure. Hooks own
subscriptions, timers and request lifetimes. Components own presentation and
direct user interaction.

### Cross-feature hooks

- `useApiActivity.ts` publishes request activity for the header.
- `usePublishedSaveStatus.ts` publishes local/cloud save feedback.
- `useEpisodeTracking.ts` reconciles tracking state through its feature API.
- `useWatchParty.ts` owns room polling and synchronization through its API.
- `features/storage/useProfileStorage.ts` owns profile loading, persistence,
  import/export and storage refresh.

### Styles

`styles/base.css` is an ordered import manifest rather than one monolithic
stylesheet. Its `base-*.css` modules follow UI responsibility: core tokens,
navigation, home dashboard, catalog, settings, collections, cloud,
personalization, feedback and branding. Their import order intentionally
preserves the previous cascade. Player- and library-specific styles remain in
their dedicated files.

## Backend layers

### Routes (`backend/app/api`)

Routes define HTTP and WebSocket contracts. Notable modules are:

- `yummy.py`: stable proxy contract consumed by React;
- `storage.py`: shared save document endpoint;
- `watch_party.py`: room and playback protocol;
- `gdrive.py`: Google Drive authentication and synchronization endpoints;
- `community_ratings.py`: anonymous shared-rating reads, writes and public export.

Routes should parse input, call a service and translate known errors. Business
rules do not belong in a router.

### Services (`backend/app/services`)

- `yummy.py` owns upstream authentication, timeouts and response acquisition.
- `storage.py` owns serialized atomic writes and first-run legacy import.
- `watch_party.py` owns participants, roles and playback state.
- `gdrive.py` owns OAuth and Drive I/O.
- `gdrive_merge.py` owns pure, deterministic save merge policy.
- `community_ratings.py` owns the SQLite vote store and aggregate calculation.

Pure policy modules accept values and return values. Infrastructure modules own
HTTP, filesystem, clocks and credentials.

## Persistence and compatibility

Storage uses a versioned document containing multiple profiles. React migrates
known fields by adding defaults. Unknown fields are spread back into the next
snapshot so a newer save is not silently damaged by an older build.

`features/storage/profileDocument.ts` is the single place for building and
resolving profile documents. `lib/storage.ts` remains the migration boundary.
The backend validates the envelope and otherwise treats the document as opaque
JSON. Google Drive applies deterministic rules from `gdrive_merge.py`.

Personal ratings remain part of the portable profile document. They are also
published as one replaceable anonymous vote per browser and anime to
`data/community-ratings.sqlite3`. The server exposes aggregate-only reads at
`GET /api/community-ratings`, a single-anime read at
`GET /api/community-ratings/{anime_id}`, and replacement writes at
`PUT /api/community-ratings/{anime_id}`. The paginated collection endpoint is
the public export boundary for a hosted deployment; raw voter identifiers are
never returned.

See [SAVE_COMPATIBILITY.md](SAVE_COMPATIBILITY.md) before changing any stored
field.

## Important event flows

### Save

```text
user action -> immutable snapshot update -> local storage request
            -> published save event -> header status / optional Drive sync
```

### Tracking

```text
tracked title -> tracking API refresh -> compare dub episode identities
              -> update baseline/new marker -> persist snapshot
```

### Watch party

```text
player event -> room command -> server room state -> participant hook
             -> guarded player update
```

The guard is essential: a remote update must not be emitted again as a new local
command.

## Rules for new code

1. Put upstream calls in a feature API or backend service, never in JSX.
2. Put calculations in pure selectors and add direct tests.
3. Put subscriptions and timers in hooks with explicit cleanup.
4. Keep page components declarative; pass view models rather than raw storage
   documents when practical.
5. Preserve unknown save fields and do not bump schema/version for file moves.
6. Add regression tests for progress, tracking, cloud merge and watch-party
   changes.
7. Write comments for reasons and protocol constraints, not obvious syntax.

## Adding a feature

Create a folder under `features/<name>`. Start with domain types and pure rules,
then add an API adapter or hook only if required. Expose a small public surface
to a page or orchestration component. Keep feature styles with that feature or
in the closest existing responsibility stylesheet.

The incremental implementation plan and acceptance criteria live in
[docs/REFACTORING_RECOMMENDATIONS.md](docs/REFACTORING_RECOMMENDATIONS.md).
