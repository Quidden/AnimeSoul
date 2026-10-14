[English](README.md) | [Русский](README.ru.md)

# Background jobs

`main.mjs` launches the typed runner in `apps/api/src/providers/catalog-worker.ts`, built with API.
Kodik is the only catalog provider. YummyAnime is a playback reserve. The active catalog queue uses PostgreSQL leases, a persisted Kodik next cursor and release counts, bounded retries
and observable status.

Enqueue with `pnpm catalog:sync`, run with `pnpm catalog:worker`. `CATALOG_WORKER=true` opts into
launch with `pnpm dev`. It is off by default and requires configured PostgreSQL. Redis is unused.
The full [Docker stack](../../docs/operations/DOCKER.md) starts a separate worker
container automatically after successful database migrations.
Credentials never enter payloads or public logs. Admin provides control and mapping review.
[Catalog operations](../../docs/operations/CATALOG.md).

Lease competition, restart recovery, page rollback and disable behavior are covered by
`pnpm db:verify` and mandatory CI PostgreSQL tests. Media, mail, payment reconciliation and metrics
remain future jobs, not connected to this runner.
[Project map](../../docs/architecture/PROJECT_MAP.md) · [Data model](../../docs/architecture/DATA_MODEL.md).
