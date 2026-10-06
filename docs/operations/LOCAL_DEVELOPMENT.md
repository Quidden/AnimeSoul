[English](LOCAL_DEVELOPMENT.md) | [Русский](LOCAL_DEVELOPMENT.ru.md)

# Local development

Run commands from the new `main` root. Requirements: Node.js 24 and pnpm 11.25.0,
pinned in [package.json](../../package.json). Docker is unnecessary for the fixture preview.

## First launch

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Windows: [scripts/windows/Start AnimeSoul.bat](../../scripts/windows/Start%20AnimeSoul.bat).
It changes to the root, verifies Node.js 24, installs absent dependencies, preserves `.env` and starts
`pnpm dev`. If pnpm is unavailable it uses `npx --yes pnpm@11.25.0`; the first download requires internet.

Setup creates `.env` from [.env.example](../../.env.example) once, with a random local password.
Legacy credentials/settings are not imported automatically.

| Service    | Address                 | Purpose                                             |
| ---------- | ----------------------- | --------------------------------------------------- |
| Web        | `http://localhost:8021` | Public Next.js website                              |
| API        | `http://127.0.0.1:8020` | Catalog/profiles, `/api/health`, `/api/ready`       |
| Admin      | `http://localhost:8022` | Closed-access administrative page                   |
| PostgreSQL | `127.0.0.1:54329`       | `animesoul` database when compose is running        |
| Redis      | `127.0.0.1:6391`        | Infrastructure only; no application integration yet |

`pnpm dev` generates Prisma Client, builds contracts/database/API, then starts the API and two Next.js
dev servers. Web/admin update on edits; API and compiled shared-package changes require restarting the command.
Ctrl+C terminates only that launch's processes. If a port is occupied, stop the previous own launch;
do not terminate every Node.js process on the machine.

## Configuration consumers

| Variable               | Current consumer                   | Meaning                                                                |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `SITE_URL`             | `apps/web/lib/site.ts`             | Canonical origin; locally `http://localhost:8021`                      |
| `API_URL`              | `apps/web/lib/api.ts`, server-only | API origin; locally `http://127.0.0.1:8020`                            |
| `API_HOST`, `API_PORT` | `apps/api/src/config.ts`           | Bind; defaults to `127.0.0.1:8020`                                     |
| `NODE_ENV`             | API and Next.js                    | Production API refuses fixtures and requires PostgreSQL                |
| `DEMO_CATALOG`         | API, Web and seed                  | `true` uses in-memory fixtures; `false` reads PostgreSQL               |
| `DATABASE_URL`         | API, Prisma CLI, seed              | Private PostgreSQL connection string                                   |
| `POSTGRES_PASSWORD`    | `infra/compose.dev.yaml`           | Container password; setup matches it to the template connection string |
| `PUBLIC_INDEXING`      | Web                                | Defaults false; true requires public HTTPS and demo disabled           |
| `REDIS_URL`            | No runtime module yet              | Reserved; compose Redis is not connected to the app                    |
| `ALLOW_YUMMY`          | Not connected to runtime yet       | Reserved default-disabled policy; true does not activate a provider    |
| `PAYMENTS_ENABLED`     | Not connected to runtime yet       | Reserved; toggling it does not implement billing                       |
| `TEST_DATABASE_URL`    | `tests/database.test.mjs`          | Isolated local database with a name ending in `_test`                  |

Root dev/build commands load `.env` into child processes. Running an app directly inside `apps/web`
or `apps/api` requires equivalent environment configuration. The API does not enable arbitrary browser CORS;
Web requests it from the server.

## PostgreSQL mode

After recovering Docker Desktop or configuring a separate development database:

```sh
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm db:seed
```

Migrate applies committed migrations to `DATABASE_URL` without reset. Seed requires
`DEMO_CATALOG=true`, nonproduction and a local database; it inserts four flagged development anime,
not accounts/profiles. Then set `DEMO_CATALOG=false` in private `.env` and restart `pnpm dev`.
This verifies database reads, not legacy import; `/users/soul` returns 404 without a separately created profile.

Compose persists data in named volumes. Stop without deleting data:

```sh
docker compose --env-file .env -f infra/compose.dev.yaml stop
```

Docker is currently unavailable on this machine; see [migration status](../migration/STATUS.md).
In demo mode `/api/health` returns 200 while `/api/ready` may return 503: fixtures do not prove PostgreSQL readiness.

## Commands and checks

| Command                                                 | Behavior                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm setup`                                            | Creates private local configuration without overwriting it                      |
| `pnpm dev`                                              | Builds server packages and starts three services                                |
| `pnpm build`                                            | Generate → contracts → database → API → Web → Admin                             |
| `pnpm typecheck`                                        | Strict types across the five package projects                                   |
| `pnpm lint`                                             | ESLint using `packages/config/eslint.config.mjs`                                |
| `pnpm format` / `pnpm format:check`                     | Prettier via `packages/config/prettier.json`; root `.prettierignore` exclusions |
| `pnpm test`                                             | Existing tests using compiled packages                                          |
| `pnpm docs:check`                                       | Local Markdown links in README, docs, apps, packages, scripts, infra and tests  |
| `pnpm check`                                            | Build → typecheck → lint → test → docs:check                                    |
| `pnpm audit --audit-level high`                         | Separate dependency audit; fresh results require registry access                |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Client generation / migration deploy / development seed                         |

Use root `pnpm build`: it passes configuration to Next.js builds without inheriting `--env-file` in worker flags.
HTML tests use isolated ports 18020–18022, preserving the visible preview.

There are 9 tests: 8 do not need PostgreSQL; the integration test skips without `TEST_DATABASE_URL`.
Prepare a separate local `animesoul_test` database. In a separate terminal point both `DATABASE_URL`
and `TEST_DATABASE_URL` to that test database, then run `pnpm db:migrate` and `pnpm check`.
Never run the integration test against development data or production.
[quality.yml](../../.github/workflows/quality.yml) provisions a PostgreSQL test-service, applies migrations
and sets both variables; CI is expected to run the integration test.

## File placement

Product source belongs in `apps`, shared contracts/configuration in `packages`, documentation in `docs`.
Utilities are separated into `scripts/workspace`, `scripts/quality`, `scripts/windows`.
Local reports/screenshots/build outputs belong in ignored `artifacts`; secrets stay in private `.env`.
`node_modules`, `.next`, `dist`, `generated` and `.idea` are local tooling outputs.
Keep old code/databases out of the new root; recover separately through the
[recovery procedure](../migration/STATUS.md#recovery).
