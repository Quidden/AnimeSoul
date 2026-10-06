[English](README.md) | [Русский](README.ru.md)

# AnimeSoul web

New website foundation: TypeScript, Next.js/React, NestJS/Fastify and PostgreSQL/Prisma.
Android lives in an independent repository; desktop development is discontinued.

The primary workspace is `C:/Users/dogem/Documents/AnimeSoul`, on branch `main`.
The previous local application, settings, databases and releases are preserved in the adjacent
`C:/Users/dogem/Documents/AnimeSoulArchive`, on branch `codex/legacy-local-2026-10-06`.
Feature migration is ongoing: authentication, saved user data, playback and a complete admin app are still pending.

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

Install Node.js 24 and pnpm 11.25.0, then:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

On Windows, [Start AnimeSoul.bat](scripts/windows/Start%20AnimeSoul.bat) starts this TypeScript workspace
and preserves an existing `.env`. If pnpm is unavailable, it uses `npx` with pnpm 11.25.0;
the first download requires an internet connection.

Website: http://localhost:8021 · API: http://127.0.0.1:8020 · administration: http://localhost:8022.
The initial preview explicitly uses development fixtures. It contains no migrated account and is not indexed.
Stop the development command with Ctrl+C; it terminates only its own services.

For PostgreSQL and Redis, start Docker Desktop and run:

```sh
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm db:seed
```

Set DEMO_CATALOG=false in the private .env to read PostgreSQL instead of fixtures.
The development seed is forbidden in production and never creates an administrator.
The API readiness endpoint returns 503 until a real database responds.
Seed adds development anime only, not profiles/accounts; connecting PostgreSQL does not import legacy data.
Docker is currently unavailable on this machine; the fixture preview operates without it.

## Check

```sh
pnpm check
pnpm format:check
pnpm audit --audit-level high
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
