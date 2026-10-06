[English](STATUS.md) | [Русский](STATUS.ru.md)

# Migration milestone — 2026-10-06

## Preserved baseline

- Website/source snapshot: commit cd54517, branch codex/archive-current-2026-10-06, annotated tag archive-current-2026-10-06.
- Ignored local backup: original workspace artifacts/migration-backup/2026-10-06. Fifteen configuration/data/signing files were copied and hash-verified.
- Live preview SQLite backup: revision 52, integrity_check passed. The archived preview was restored and its health endpoint returned 200.
- Secrets, databases, signing keys, dependencies and generated releases remain outside Git.
- Independent mobile repository: C:/Users/dogem/Documents/AnimeSoulMobile, branch main. No signing material copied into Git.
- New website working copy: C:/Users/dogem/.codex/worktrees/new-web-stack/AnimeSoul. Its main contains only the new stack and relevant documentation/assets.

The previous master ref remains recoverable. Remote branches/defaults have not been changed; no production cutover occurred.
Old code/history lives in the archive branch rather than a legacy directory inside the new website.

## Implemented foundation

Strict TypeScript workspace and pinned lockfile; separate Next.js website/admin; modular NestJS/Fastify API;
validated contracts and server profile privacy; Prisma PostgreSQL schema and initial SQL migration;
local PostgreSQL/Redis compose; CI checks and isolated PostgreSQL integration test.
Public SSR catalog, anime pages and profile, search, canonical metadata, safe JSON-LD,
indexing controls, sitemap selection and full-width collapsing profile header work on development fixtures.
Admin routes deny access. Order/payment/webhook/entitlement schema prepares future sandbox integration.

## Verification and limits

Website/API builds, strict type checks, lint, document links, formatting and npm dependency audit are checked locally.
Eight tests cover API boundaries, privacy, JSON-LD, indexing configuration and compiled HTML.
The PostgreSQL integration test requires TEST_DATABASE_URL and an isolated local database ending in \_test.
It is configured as mandatory in CI; local execution is skipped while Docker is unavailable.
Prisma validate/generate and SQL schema diff succeed. This does not establish that migrations were applied or that PostgreSQL restoration passed.

Docker Desktop currently crashes on C:/Users/dogem/AppData/Local/Docker/run/sailor-ingest.sock (a zero-length reparse point).
CLI startup/stop attempts did not recover its engine. No factory reset, container/volume deletion or Windows component installation was performed.
Docker repair and real PostgreSQL migration/restore remain an open stage 1 gate. The API correctly returns 503 for database readiness.

Mobile: independent Gradle assembleDebug succeeded; TypeScript/Vite build and 96 retained frontend tests passed.
Two npm vulnerabilities were patched within compatible dependency ranges, and audit reports zero npm vulnerabilities.
Build used already-installed JDK/SDK/Python through explicit environment paths.
Device/Cast/download smoke tests, release signing and Python dependency hardening were not repeated.

## Next ordered work

1. Restore local Docker operation or provide a separate development PostgreSQL; run the migration, real API integration test and a restore drill.
2. Stage 2: normalize user libraries/favorites/folders/ratings, repeatable legacy importer preserving UUIDs, sessions, Argon2id, owner editing/visibility, explicit owner bootstrap and admin MFA.
3. Stage 3: licensed catalog/source mapping, disabled-by-default Yummy adapter, audited administrative switch, no-call tests and cache invalidation.
4. Player/library/media workflow, functional admin metrics with formulas, sandbox billing, deployment/Cloudflare and public indexing follow their roadmap gates.

The new preview uses no real account, session, player stream or payment. Existing profile/media/provider features are preserved in the archive
and will be migrated through these boundaries. No claim of a complete replacement or production security is made.

## Recovery

Use the archive ref in a separate checkout/worktree to restore old code without overwriting new work.
Private settings and signing files come from the protected local backup, never from Git.
Do not restore an old database over new production writes; final cutover must have its own verified data/rollback procedure.
