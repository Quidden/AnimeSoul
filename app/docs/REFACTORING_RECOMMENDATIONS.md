[English](REFACTORING_RECOMMENDATIONS.md) | [Русский](REFACTORING_RECOMMENDATIONS.ru.md)

# Refactoring guide

This document describes possible next slices, not shipped features or a release promise. Keep behavior, API contracts and schema 3 stable while moving code.

## Existing boundaries

Catalogue transport/controller/presentation, tracking/party adapters, library selectors, profile builders/lifecycle/autosave, ratings retries, settings groups, player subcomponents, navigation/folder hooks and header cloud lifecycle are extracted. Typed events live in lib/events.ts. CSS has an ordered base manifest and feature bundles. Heavy pages/player/parser load lazily under bundle budgets.

Backend separates transport from services, pure Drive merge from OAuth, runtime identity from launcher UI, and Kodik helpers/resolution from offline queue/index. Android MediaSession/network monitor are separated from MainActivity. `App.tsx`, `Player.tsx` and `SettingsCenter.tsx` still coordinate multiple responsibilities.

## Safe next slices

| Slice | Extract / acceptance criteria |
| --- | --- |
| Anime detail boundary | Typed model/actions for family/loading/metadata/library actions; retain distinct open/resume/new-episode intents |
| Player orchestration | Selection, family loading, resume/progress, auto-next, iframe messages, previews; preserve actual video/iframe lifetime and Android mini-player |
| Settings shell | Keep modal navigation/search/composition; extract reset/focus lifecycle only if it has a clear owner |
| Persistence commands | Named pure commands for watched/progress/favorite/folder/tracking/rating changes; retain unknown fields and field revisions |
| Complex backend coordination | Extract use cases only where routes coordinate several resources; keep simple proxy/health routes simple |
| CSS ownership | Move one surface at a time without changing cascade/import order or light/touch/zoom behavior |
| API typing | Models for dynamic party/storage/provider payloads, preserving unknown fields and legacy-compatible validation |

Do not introduce a global player context solely to reduce prop counts: hidden dependencies make party feedback suppression and source lifetime harder to verify. Do not mix code movement, schema change, styling and network behavior in one slice.

## Invariants

New product work belongs in app. Preserve unknown JSON fields, per-field revisions and progress resetAt. Progress, rewatches, tracking identities, cloud merge and party remote-control guards are behavior. Changing file names alone does not increment product/schema versions. New abstraction needs a coherent responsibility and a useful independent test.

## Verification and documentation

Characterize the affected behavior, move pure logic first, then transport/lifecycle. Run targeted tests followed by required gates from the [app README](../README.md). Inspect diff for unrelated formatting. Verify profile round-trip/switch/error bootstrap, source identity/resume/manual undo, tracking partial failure, cloud timestamps/deletion/queue/reset, ratings tombstones/cookie, party host/shared/follow/free, and affected native behavior.

Current bundle audit defines budgets in `tools/audit-bundle.mjs`; consult code for authoritative thresholds. Browser harnesses and device/media tests are separate from frontend check. Update [map](PROJECT_MAP.md), [flows](ENTRY_POINTS_AND_FLOWS.md), [API](API_REFERENCE.md), [data](DATA_MODEL.md), [styles](STYLES.md), and their Russian pairs whenever ownership/contracts change. Regenerate API_SCHEMA and run check_docs.py.
