[English](README.md) | [Русский](README.ru.md)

# AnimeSoul web

Website stack: TypeScript, Next.js/React, NestJS/Fastify and PostgreSQL/Prisma.
Android lives in an independent repository; desktop development is discontinued.

The primary workspace is `C:/Users/dogem/Documents/AnimeSoul`, on branch `main`.
The previous local application, settings, databases and releases are preserved in the adjacent
`C:/Users/dogem/Documents/AnimeSoulArchive`, on branch `codex/legacy-local-2026-10-06`.
Primary Kodik and optional YummyAnime reserve embeds, accounts, private libraries and MFA-protected admin access are connected.
Episode pages, timestamps, new progress and custom HLS with embed fallback are implemented.
Profile uploads/GIPHY, character pages, universal/frame search, subscriptions and administrative analytics are implemented.
See [migration status](docs/migration/STATUS.md), [playback](docs/operations/PLAYBACK.md),
[accounts](docs/operations/ACCOUNTS.md) and [administration](docs/operations/ADMINISTRATION.md).
Production rollout and real payments remain separate milestones.

## Project navigation

| Need                                                   | Guide                                                     |
| ------------------------------------------------------ | --------------------------------------------------------- |
| Directories, entry points and application dependencies | [Project map](docs/architecture/PROJECT_MAP.md)           |
| Pages, navigation, profile sections and API routes     | [Site map](docs/architecture/SITE_MAP.md)                 |
| Tables, UUIDs, DTOs and privacy                        | [Data model](docs/architecture/DATA_MODEL.md)             |
| Launch, configuration, database and checks             | [Local development](docs/operations/LOCAL_DEVELOPMENT.md) |
| All documents and reading order                        | [Documentation index](docs/README.md)                     |

`apps` contains Web/API/Admin; `packages` holds shared contracts, persistence and configuration;
`scripts` groups utilities by purpose; `infra` holds local services; `tests` checks cross-application behavior.
Maps describe current implementation; the roadmap describes future work.

## Run locally

The default full-stack launch uses Docker Desktop with Linux containers:

```sh
docker compose up -d --build --wait
```

Web/API/admin/worker/PostgreSQL run in containers. On Windows,
[Start AnimeSoul.bat](scripts/windows/Start%20AnimeSoul.bat) runs this command,
creates a missing private `.env` and opens the browser. Closing the window leaves
the site running. Stop with `docker compose stop`.
[Docker, persistent data and HTTPS server deployment](docs/operations/DOCKER.md).

For development with updates on edits, use Node.js:

Install Node.js 24.7+ (24.x) and pnpm 11.25.0, then:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

On Windows, [Start AnimeSoul Dev.bat](scripts/windows/Start%20AnimeSoul%20Dev.bat) starts this TypeScript workspace
and preserves an existing `.env`. If pnpm is unavailable, it uses `npx` with pnpm 11.25.0;
the first download requires an internet connection.

Website: http://localhost:8021 · API: http://127.0.0.1:8020 · administration: http://localhost:8022.
A fresh checkout uses development fixtures and contains no migrated accounts. Private database/media data must be restored separately. Local indexing is disabled.
Stop the development command with Ctrl+C; it terminates only its own services.

The full Docker launch starts PostgreSQL and applies migrations automatically.
Redis is unused by applications and is enabled separately with the `cache` profile.
The older `infra:up` command remains for separate development infrastructure;
do not run it alongside the full stack on the same ports.

Set DEMO_CATALOG=false in the private .env to read PostgreSQL instead of fixtures.
The development seed is forbidden in production and never creates an administrator.
The API readiness endpoint returns 503 until a real database responds.
Seed adds development anime only, not profiles/accounts; connecting PostgreSQL does not import legacy data.
Current data has been copied to PostgreSQL 18 in Docker; the original native cluster and
configuration are preserved. `LOCAL_POSTGRES=false` connects host utilities to Docker.
`LOCAL_POSTGRES=true` still starts an isolated native cluster with `pnpm dev`. Fixture preview works
without a database; playback requires imported catalog records and enabled providers.

## GitHub and images

`main` contains the website; the previous application remains in `master`. Automated GitHub
test runs have been removed. Manually publish API/Web/Admin/migration images with
**Actions → Publish containers → Run workflow**. [GHCR publication and launch](docs/operations/GITHUB.md).
The Dockerfile remains in `infra/docker/`; images contain source/build output and receive secrets at runtime.

## Check

```sh
pnpm check
pnpm format:check
pnpm audit --audit-level high
pnpm secrets:check
```

The HTTP website tests start isolated compiled services on ports 18020–18022.
Documentation, source and migrations belong in [docs](docs/README.md), apps, packages and infra respectively.
Generated files, databases, private environment files and media uploads do not belong in Git.
ESLint/Prettier and TypeScript configuration belongs in `packages/config`; see the
[command guide](docs/operations/LOCAL_DEVELOPMENT.md). Root Git/editor/ignore files remain in their
standard locations for automatic tool discovery.

See [current milestone](docs/migration/STATUS.md), [architecture](docs/architecture/FOUNDATION.md)
and the [full roadmap](docs/architecture/WEB_STACK_PLAN.md).
The archive branch codex/archive-current-2026-10-06 and tag archive-current-2026-10-06 preserve the previous application.

Kodik catalog: metadata cache, durable jobs, filters/pagination and provider administration. [Operations](docs/operations/CATALOG.md).

Social features, votes, hashtags and content labels: [expanded plan](docs/architecture/SOCIAL_NETWORK_PLAN.md).

Friendship, follows, blocks and three privacy audiences are implemented: [guide](docs/operations/FRIENDS.md).
