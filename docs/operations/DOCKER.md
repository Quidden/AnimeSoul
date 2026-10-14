[English](DOCKER.md) | [Русский](DOCKER.ru.md)

# Docker and server deployment

[compose.yaml](../../compose.yaml) starts PostgreSQL 18, Prisma migrations, API,
catalog worker, website and administration. Node.js/pnpm live inside the images;
frontends use compiled Next.js standalone builds. Only Docker Desktop with Linux
containers is needed locally; servers require Docker Engine and Compose 2.24.4+.

## Local launch

This machine's native database has been copied into Docker. With an existing `.env`:

```sh
docker compose up -d --build --wait
```

[Start AnimeSoul.bat](../../scripts/windows/Start%20AnimeSoul.bat) runs this command
and opens the website. Closing its window leaves containers running.
When `.env` is missing, [Setup Docker.ps1](../../scripts/windows/Setup%20Docker.ps1)
creates private random credentials; existing configuration is preserved.
On a fresh Linux checkout, copy [.env.example](../../.env.example) to `.env`, replace
both password placeholders with `openssl rand -hex 24`, and set `MFA_ENCRYPTION_KEY`
using `openssl rand -hex 32`.

| Service                       | Address                 |
| ----------------------------- | ----------------------- |
| Website                       | `http://localhost:8021` |
| Administration                | `http://localhost:8022` |
| API                           | `http://127.0.0.1:8020` |
| PostgreSQL for host utilities | `127.0.0.1:54329`       |

Compose overrides database/API connections to `postgres:5432`/`http://api:8020`,
sets `LOCAL_POSTGRES=false` and `DEMO_CATALOG=false`. Provider/MFA secrets enter at
runtime from `.env` and are excluded from image builds. Local API configuration
uses `APP_ENV=development` to permit localhost HTTP and file mail in
`artifacts/dev-mail`; frontend builds run in production mode. New databases receive
the schema, with no automatic account creation or catalog seed.

```sh
docker compose ps -a
docker compose logs -f --tail=100
docker compose stop
docker compose up -d --wait
```

After source edits, repeat `up -d --build --wait`. For fast development, stop Docker
applications (`docker compose stop web admin api worker`) and use `pnpm dev` against
the Docker database. [Start AnimeSoul Dev.bat](../../scripts/windows/Start%20AnimeSoul%20Dev.bat)
retains the Node.js 24/pnpm launcher. Both application stacks use the same ports.

Migrations finish before API/worker startup; frontends wait for `/api/ready`.
`migrate` showing `Exited (0)` is expected. Frontend `/api/health` remains available
during website maintenance.

## Persistence and operations

| Storage                | Contents                                       |
| ---------------------- | ---------------------------------------------- |
| `postgres` volume      | Accounts, catalog, library, queue and settings |
| `profile-media` volume | Uploaded profile images                        |
| `diagnostics` volume   | Shared API/web/admin diagnostic logs           |
| `artifacts/dev-mail`   | Local test mail only                           |

`docker compose down` preserves volumes; `down -v` deletes stored data and is not
the normal stop command. An application image is not a database/media backup.

```sh
docker compose exec api node apps/worker/main.mjs --enqueue
docker compose logs -f worker
docker compose run --rm migrate
```

Redis is optional infrastructure for future cache/queues. No runtime module uses
it today; the catalog queue lives in PostgreSQL. Enable it with
`docker compose --profile cache up -d --wait`; Redis has no host port.

## Copying another native database

On another Windows machine with native PostgreSQL 18, `.env` and `animesoul` on
`127.0.0.1:54329`, stop the old applications, build the images and create PostgreSQL:

```sh
docker compose build
docker compose create postgres
```

While native PostgreSQL owns 54329, temporarily remove the Compose PostgreSQL host
port or use an override with `ports: !reset []`, then start only `postgres`.
The new Docker database must remain empty before migrations.

```sh
node --env-file=.env scripts/docker/migrate-native.mjs
```

The utility saves a custom-format dump and JSON report in `artifacts/database-backups`,
restores in one transaction and compares exact row counts across all tables.
It refuses targets containing existing tables and preserves the native cluster.
Then stop native PostgreSQL, restore the Compose port, set `LOCAL_POSTGRES=false`
in `.env` and start the full stack. Copy existing profile files to `profile-media`
and keep the original `MFA_ENCRYPTION_KEY` when moving MFA credentials.

## HTTPS server

[compose.server.yaml](../../compose.server.yaml) adds Caddy, removes host ports for
PostgreSQL/API/frontends and enables strict production API/worker configuration.
Only 80/443 are public. Caddy routes separate website/admin domains and obtains
and renews TLS certificates automatically.

1. Copy [.env.server.example](../../.env.server.example) to `.env.server`.
2. Set real `SITE_DOMAIN`/`ADMIN_DOMAIN`, matching HTTPS `SITE_URL`/`ADMIN_URL`,
   private hex database password, preserved MFA key and provider credentials.
   Website and admin hostname must differ.
3. Point both DNS names to the server and open 80/443. Use `MAIL_MODE=smtp` with
   SMTP configuration for delivery; production forbids `file` mail.
4. From the project root run:

```sh
docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml up -d --build --wait
```

Restore the database and profile media separately on a new server. Before updates,
back up PostgreSQL, `profile-media` and private configuration. A dump can be saved
without redirecting binary data through a shell:

```sh
docker compose exec postgres pg_dump -U animesoul -d animesoul -Fc -f /tmp/animesoul.dump
docker compose cp postgres:/tmp/animesoul.dump ./artifacts/database-backups/animesoul.dump
```

Use the same `--env-file` and both `-f` arguments for server operations. Store backup
copies outside the server. Enable `PUBLIC_INDEXING=true` after public HTTPS and the
real catalog are configured. Actual public deployment/certificate issuance needs
the server, domain names and DNS.

## Images on GitHub

[GitHub/GHCR](GITHUB.md) describes manual image publication and launch
with `compose.ghcr.yaml` without local builds. The Dockerfile stays in `infra/docker/`.
