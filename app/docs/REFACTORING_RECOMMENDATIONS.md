# AnimeSoul: refactoring roadmap

This document describes the current Python + React application in `app/` and
the safe path for continuing its refactor. It is deliberately implementation
oriented: a contributor should be able to pick one phase, understand its
boundary and verify that behavior did not change.

## Non-negotiable compatibility rules

1. The active application is `app/`. Do not add new product behavior to
   `legacy-old-stack/` and do not delete the archive as part of refactoring.
2. Keep storage schema version 3 readable in both implementations. Unknown
   profile fields must survive migration, local saves, cloud synchronization
   and import/export.
3. Preserve the existing HTTP and WebSocket contracts until all callers and
   packaged desktop builds have migrated.
4. A refactor must not silently change progress, new-episode tracking,
   watch-party synchronization or Google Drive merge rules.
5. Do not change the product version merely because code was reorganized.

## Completed in the current refactor

### Frontend feature boundaries

Network calls and domain rules have been removed from the largest UI files:

- `features/catalog/api.ts` owns catalog, details, video and schedule requests.
- `features/tracking/api.ts` owns tracking refresh requests.
- `features/watch-party/api.ts` and `types.ts` own the room protocol.
- `features/library/selectors.ts` calculates history, watching lists, folder
  progress and statistics without rendering UI.
- `features/storage/profileDocument.ts` builds and resolves versioned profile
  documents while preserving unknown fields.
- `features/settings/` contains the settings catalog, reusable setting row,
  Google Drive state, cloud-specific panels, appearance controls and profile
  import/export controls.
- `features/player/` contains the toolbar, seasons, release schedule, metadata
  and watch-party presentation.
- `features/player/useResumePreview.ts` resolves the current resume card;
  `activeWatchActions.ts` owns progress/tracking mutations for the open title.
- `features/catalog/useCatalogController.ts` and
  `useCatalogPresentation.ts` separate request state from derived card data.
- `features/storage/useProfileStorage.ts` owns profile persistence and transfer.
- `pages/HomePage.tsx`, `pages/CatalogPage.tsx`, `pages/StatisticsPage.tsx` and
  `pages/FolderView.tsx` are real page modules. Home sections live in
  `pages/home/` instead of `App.tsx`.
- Typed application events live in `lib/events.ts`; API and save status effects
  live in dedicated hooks.
- `styles/base.css` is now an ordered manifest for thematic `base-*.css`
  modules. The original cascade is preserved without one giant stylesheet.

`App.tsx`, `Player.tsx` and `SettingsCenter.tsx` remain orchestration shells.
They are intentionally still present so this refactor can be reviewed and
tested in small steps rather than replacing all state management at once.

### Backend isolation

- FastAPI routes remain transport adapters.
- Services own I/O and external integrations.
- Pure Google Drive merge rules now live in `services/gdrive_merge.py`; they can
  be tested without OAuth, HTTP or filesystem access.

## Target dependency direction

```text
pages/components -> feature hooks -> feature API/domain -> lib contracts
FastAPI routes   -> application services -> external API/filesystem
```

Dependencies must point inward. A pure selector must never import React; a UI
component must not construct an upstream YummyAnime URL; an API route must not
implement merge policy.

## Remaining phases

### Phase 1: finish anime-detail extraction

The home layout has been extracted. Move the remaining anime-detail
composition behind a typed page boundary while keeping routing in `App.tsx`
and player lifetime in the player feature.

Acceptance criteria:

- page modules receive typed view models and callbacks;
- no page directly reads or writes the storage document;
- catalog and resume regression tests keep passing;
- `App.tsx` becomes an application coordinator, not a markup container.

### Phase 2: split player orchestration

Keep `Player.tsx` as the owner of player lifetime, but extract:

- selection state for season, episode, dub and source;
- resume and progress synchronization;
- fullscreen episode transition policy;
- preview-frame loading;
- embedded-player message adapter.

Each hook should expose a small typed interface. Avoid one global player
context: it would hide dependencies and make watch-party feedback loops harder
to reason about.

Acceptance criteria:

- manually selecting an episode and automatic next episode remain distinct;
- marked-as-watched episodes are still replayable;
- resume restores both episode identity and timestamp;
- fullscreen and watch-party tests cover transitions.

### Phase 3: finish settings orchestration

`SettingsCenter.tsx` now delegates appearance, profiles and Google Drive to
feature components. Continue until it only owns modal navigation, search,
watch-party configuration and reset. Keep setting metadata in
`settingsCatalog.ts`.

Acceptance criteria:

- every setting has one canonical label, description and search entry;
- cloud controls render only from the Google Drive feature state;
- closing a modal cannot click controls behind the overlay;
- reset behavior is covered by a migration or component test.

### Phase 4: formalize persistence commands

Replace scattered snapshot mutations with named commands such as
`markEpisodeWatched`, `updateEpisodeProgress`, `removeFavorite` and
`updateTrackingBaseline`. Commands return the next immutable snapshot; a single
persistence boundary writes it.

Acceptance criteria:

- one user action produces one save request;
- all commands preserve unknown snapshot fields;
- Google Drive merge tests cover concurrent progress and settings changes;
- export/import remains byte-safe for Unicode names and notes.

### Phase 5: backend application layer

Introduce small use-case functions between routes and infrastructure only where
a route currently coordinates multiple services. Do not add abstract base
classes merely for symmetry.

Good candidates are cloud restore, tracking refresh and watch-party host
transfer. Keep simple health and proxy endpoints simple.

### Phase 6: CSS ownership (initial split complete)

The monolithic file has been split into ordered responsibility modules. Future
work may colocate narrowly feature-specific selectors with their components.
Keep design tokens, resets and shared primitives in `base-core.css`; keep
`base.css` as the stable import manifest.

Acceptance criteria:

- each feature has one obvious stylesheet owner;
- no new `!important` without an explanation;
- desktop scaling and responsive layouts are visually checked after moves.

## How to implement one refactor slice

1. Identify one behavior and its existing tests.
2. Extract pure types and rules first.
3. Move side effects into an API module or hook.
4. Leave a small adapter at the old call site.
5. Run all validation commands before the next slice.
6. Add a regression test when the old behavior was not covered.

Avoid mixing a feature change with file movement. If a bug is discovered while
extracting code, first add a failing test, then fix it in a separate reviewable
change.

## Required validation

From `app/frontend`:

```powershell
npm run typecheck
npm test
npm run build
```

From `app`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
.\.venv\Scripts\python.exe -m compileall backend/app
```

Finally run `git diff --check` and review the complete diff. Packaging and a
manual browser/desktop smoke test are required before publishing a release, but
not for every internal extraction commit.
