[English](LOCAL_DEVELOPMENT.md) | [Русский](LOCAL_DEVELOPMENT.ru.md)

# Local development

The default full-stack launch now uses [Docker](DOCKER.md):
`docker compose up -d --build --wait`. Stop Docker applications before starting the
Node.js servers below; PostgreSQL can keep running in its container.

Run commands from the new `main` root. Requirements: Node.js 24 and pnpm 11.25.0,
pinned in [package.json](../../package.json). Docker is unnecessary for the fixture preview.

## First launch

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Windows: [scripts/windows/Start AnimeSoul Dev.bat](../../scripts/windows/Start%20AnimeSoul%20Dev.bat).
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
Before setup/build, the Windows launcher checks all three ports. If a healthy AnimeSoul stack is
already running, it opens the existing website without rebuilding or starting duplicate servers.
On a normal launch the browser opens after all three services become ready; the batch window
remains open for the servers. `pnpm run dev --open` enables the same browser launch, while
plain `pnpm dev` starts servers without opening a browser.
`pnpm dev` performs the same check before building and again before starting its processes.
An incomplete stack or an unrelated occupied port produces a list of conflicts. Stop the previous
own launch with Ctrl+C in its terminal, then retry. Ctrl+C terminates only that launch's processes.

Native PostgreSQL, server `YUMMY_TOKEN`/`KODIK_TOKEN`, `LOCAL_POSTGRES`/`POSTGRES_BIN`, import and playback commands are covered by [playback operations](PLAYBACK.md). Native PostgreSQL 18 works here without Docker; migrations and restore passed.

## Configuration consumers

| Variable                     | Current consumer                   | Meaning                                                                |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `SITE_URL`                   | `apps/web/lib/site.ts`             | Canonical origin; locally `http://localhost:8021`                      |
| `API_URL`                    | `apps/web/lib/api.ts`, server-only | API origin; locally `http://127.0.0.1:8020`                            |
| `API_HOST`, `API_PORT`       | `apps/api/src/config.ts`           | Bind; defaults to `127.0.0.1:8020`                                     |
| `NODE_ENV`                   | API and Next.js                    | Production API refuses fixtures and requires PostgreSQL                |
| `DEMO_CATALOG`               | API, Web and seed                  | `true` uses in-memory fixtures; `false` reads PostgreSQL               |
| `DATABASE_URL`               | API, Prisma CLI, seed              | Private PostgreSQL connection string                                   |
| `POSTGRES_PASSWORD`          | `infra/compose.dev.yaml`           | Container password; setup matches it to the template connection string |
| `PUBLIC_INDEXING`            | Web                                | Defaults false; true requires public HTTPS and demo disabled           |
| `REDIS_URL`                  | No runtime module yet              | Reserved; compose Redis is not connected to the app                    |
| `ALLOW_YUMMY`, `ALLOW_KODIK` | Provider API                       | Environment denial overrides persisted switches                        |
| `PAYMENTS_ENABLED`           | Not connected to runtime yet       | Reserved; toggling it does not implement billing                       |
| `TEST_DATABASE_URL`          | `tests/database.test.mjs`          | Isolated local database with a name ending in `_test`                  |

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

The full [Docker stack](DOCKER.md) runs here with PostgreSQL 18.
`infra:up` belongs to the older separate infrastructure; do not run it alongside
the full Compose configuration on port 54329.
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

The local test suite grows with the implemented features. PostgreSQL integrations skip without `TEST_DATABASE_URL`; `pnpm db:verify` runs 26 checks against an isolated database and backup/restore without changing working data.
Prepare a separate local `animesoul_test` database. In a separate terminal point both `DATABASE_URL`
and `TEST_DATABASE_URL` to that test database, then run `pnpm db:migrate` and `pnpm check`.
Never run the integration test against development data or production.
Automatic GitHub Actions tests have been removed. Run checks locally; image publication
is manual: [GitHub/GHCR](GITHUB.md). Before committing, run `pnpm secrets:check` and then
`pnpm secrets:check --staged` after staging.

## File placement

Product source belongs in `apps`, shared contracts/configuration in `packages`, documentation in `docs`.
Utilities are separated into `scripts/workspace`, `scripts/quality`, `scripts/windows`.
Local reports/screenshots/build outputs belong in ignored `artifacts`; secrets stay in private `.env`.
`node_modules`, `.next`, `dist`, `generated` and `.idea` are local tooling outputs.
Keep old code/databases out of the new root; recover separately through the
[recovery procedure](../migration/STATUS.md#recovery).

## Accounts

Native Argon2id requires Node.js 24.7+ within 24.x. `pnpm setup` adds a private MFA key while retaining other settings.
Set `ADMIN_URL=http://localhost:8022` alongside SITE_URL. `/account` supports registration/claim and `/library` stores personal data.
`pnpm profiles:import` and `pnpm account:operator` are covered in [account operations](ACCOUNTS.md).
`pnpm db:verify` includes account checks and library restoration.

Catalog jobs: `CATALOG_WORKER=true` starts the worker with `pnpm dev`; manual launch is `pnpm catalog:worker`, enqueue is `pnpm catalog:sync`. Configured PostgreSQL is required and providers are disabled by default. [Full import/admin](CATALOG.md).

Google/email: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `MAIL_MODE=file|smtp|disabled` and SMTP fields are documented in [accounts](ACCOUNTS.md). `pnpm setup` adds absent local file mode; production forbids it. Never copy credentials into NEXT_PUBLIC fields.
