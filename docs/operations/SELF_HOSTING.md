[English](SELF_HOSTING.md) | [Русский](SELF_HOSTING.ru.md)

# Self-host AnimeSoul

This guide covers a fresh installation on your own Linux server. For a local machine
with Docker Desktop, see [local Docker](DOCKER.md). For the private test image with
a catalog, bootstrap owner and full runtime-configurable application, see [Docker Hub dev-box](DEV_IMAGE.md).

## Prerequisites

- Docker Engine with Linux containers, Docker Compose **2.24.4 or newer**, Git and OpenSSL.
- A `linux/amd64` server and two domains, such as `anime.example.com` and `admin.example.com`.
- Both DNS A/AAAA records pointing to the server; publish AAAA only with working IPv6.
- Inbound TCP 80/443; UDP 443 is optional for HTTP/3. Do not expose API/PostgreSQL ports.
- Access to the source and, when using published images, this repository's GitHub Packages.

Regular Docker operation needs no host Node.js or pnpm. Deployment does not copy another
installation's database, accounts, media or keys. A public site needs its own catalog
and configured permitted playback sources.

## 1. Get the source and create private configuration

```sh
git clone --branch main https://github.com/Quidden/AnimeSoul.git
cd AnimeSoul
umask 077
test -f .env.server || cp .env.server.example .env.server
chmod 600 .env.server
```

Edit `.env.server` and fill in:

| Variable                       | Value                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `SITE_DOMAIN`, `ADMIN_DOMAIN`  | Two different hostnames without scheme or path                                   |
| `SITE_URL`, `ADMIN_URL`        | Corresponding full `https://` URLs                                               |
| `POSTGRES_PASSWORD`            | A fresh `openssl rand -hex 24` result                                            |
| `MFA_ENCRYPTION_KEY`           | For a new database, `openssl rand -hex 32`; when restoring, preserve the old key |
| `INTERNAL_PROXY_SECRET`        | Another independent `openssl rand -hex 32` result, shared by web/API             |
| `INTERNAL_PROXY_TRUSTED_HOSTS` | `web`, to verify the internal Docker connection                                  |
| `MAIL_MODE`                    | `smtp` with SMTP settings, or `disabled` without mail delivery                   |

Keep `ANIMESOUL_ENV_FILE=.env.server`, `APP_ENV=production`, `DEMO_CATALOG=false`
and `PUBLIC_INDEXING=false`. Compose constructs the container `DATABASE_URL` from
the password and internal PostgreSQL address; the server template does not need it.

Set provider keys, `TRACE_MOE_API_KEY`, OAuth and SMTP credentials only here. Playback
requires the corresponding `ALLOW_*` setting and key; leave unused optional settings
blank. `GIPHY_API_KEY` is a public browser integration key; private keys stay server-side.
The Google OAuth callback is `https://<SITE_DOMAIN>/api/auth/google/callback`.
`INTERNAL_PROXY_SECRET` authenticates the frame-search identity channel; arbitrary
client forwarded headers do not become trusted.

## 2. Choose published images or build on the server

The application images live in **GHCR**; the separate private dev-box lives in
**Docker Hub**. A regular server uses the four GHCR images or builds from source.

Open [Publish containers](https://github.com/Quidden/AnimeSoul/actions/workflows/publish-containers.yml)
and choose a successful run for the desired `main` commit. All four jobs (`api`,
`web`, `admin`, `migrate`) must succeed. Add to `.env.server`:

```dotenv
ANIMESOUL_IMAGE_TAG=sha-<full-40-character-commit-SHA>
```

Replace the entire placeholder with the real tag. No `latest` tag is published.
For private packages, run `docker login ghcr.io` and enter a `read:packages` token
at the password prompt; keep it out of shell arguments, `.env.server` and Git.

Run the following in Bash from the project root. The function keeps the same
environment and Compose files for launch, diagnostics and updates:

```sh
dc() { docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml -f compose.ghcr.yaml "$@"; }
dc config --quiet
dc pull
dc up -d --no-build --wait --wait-timeout 300
```

If GHCR is unavailable or you prefer your own build, use this block instead:

```sh
dc() { docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml "$@"; }
dc config --quiet
dc up -d --build --wait --wait-timeout 300
```

Define your chosen function again after a new SSH login. Compose starts PostgreSQL,
applies migrations, starts API/worker, web/admin, then Caddy obtains HTTPS certificates.
The migration container finishing with `Exited (0)` is expected.

## 3. Verify and populate the site

```sh
dc ps -a
dc logs --tail=100 api web admin caddy
dc exec api node /app/healthcheck.mjs http://127.0.0.1:8020/api/ready
curl --fail https://anime.example.com/api/health
curl --fail https://admin.example.com/api/health
```

Substitute your domains in `curl`. Certificate failures require checking DNS, ports
80/443 and Caddy logs. API readiness failures require checking migrations and PostgreSQL.
Do not share full `docker compose config` output: it includes private values.
`config --quiet` validates configuration without printing keys.

A new database has its schema, without accounts or catalog data. Register your account
at `/account` and enable MFA in Security. The first owner needs the explicit operator
command in [accounts](ACCOUNTS.md#admin-access), using a built local checkout
and database access through loopback/an SSH tunnel. The first registration receives
no automatic owner privileges. Keep PostgreSQL closed to the internet.

Next, [configure the catalog](CATALOG.md) in administration. With provider keys configured,
enqueue import using `dc exec api node apps/worker/main.mjs --enqueue` and monitor
`dc logs -f worker`. The site can remain empty without an imported catalog.
When moving an existing installation, restore its database and `profile-media`, preserving
the MFA key. See [Docker/data](DOCKER.md) and [administration](ADMINISTRATION.md).

## 4. Back up, update and stop

Before updating, back up PostgreSQL, `profile-media` and private configuration off-server:

```sh
mkdir -p artifacts/database-backups
dc exec postgres pg_dump -U animesoul -d animesoul -Fc -f /tmp/animesoul.dump
dc cp postgres:/tmp/animesoul.dump ./artifacts/database-backups/animesoul.dump
```

Copy the backup to separate protected storage; the filename above is reused. Also back up
the `profile-media` volume contents and `.env.server`. Update source with `git pull --ff-only`.
For GHCR, change `ANIMESOUL_IMAGE_TAG`, run `dc pull`, then
`dc up -d --no-build --wait --wait-timeout 300`. For source builds, use
`dc up -d --build --wait --wait-timeout 300`. Migrations run before the API starts.
An older image tag does not undo database migrations: plan database restoration together
with the application version. `dc stop` stops services; `dc down` preserves volumes.
`dc down -v` deletes data and is not an ordinary update command.

## Protect `.env` and keys

Only `.env.example` and `.env.server.example`, containing blank values or placeholders,
belong in Git. Private `.env*`, keys, dumps and `artifacts` are excluded. Docker build
contexts exclude private env files, including nested directories. Runtime configuration
supplies image secrets. Keep secrets out of `ARG`, `NEXT_PUBLIC_*`, Docker labels,
screenshots and Actions logs.

Before committing your own changes, review `git status`, run `pnpm secrets:check`,
then `pnpm secrets:check --staged` after staging. These Node.js commands run in a developer
checkout. GitHub Actions repeats the scan before publishing GHCR images. Revoke/rotate
any already-published key; deleting its file alone is insufficient.

Enable `PUBLIC_INDEXING=true` only after checking HTTPS, catalog and privacy settings.
Real payments remain a separate milestone.
