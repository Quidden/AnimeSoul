[English](DEV_IMAGE.md) | [Русский](DEV_IMAGE.ru.md)

# Private test image

`quiddens/animesoul-dev:dev` packages the current web application, administration, API, worker and PostgreSQL 18 into one `linux/amd64` container. It is an isolated test environment with the full local catalog snapshot, using compiled Next.js applications rather than hot-reload development servers.

First boot restores anime, characters, relationships, episodes, provider identifiers and subscription plans into a separate persistent Docker volume. It bootstraps `DevOwner` / `dev-owner@example.test` with `owner` and `admin` roles, full privileges and native-player access. The password, TOTP secret and MFA encryption key are generated at runtime. Admin authentication still requires MFA. Additional accounts can register normally, without administrative privileges. Accounts, friends, posts, comments, libraries, media and subscriptions use the same application implementation as the regular stack.

Original accounts, viewing history, payments, sessions, private media, audit records, `.env` and provider credentials are excluded. Assets from `apps/web/public` are packaged; remote posters retain their existing URLs. Playback and external services require credentials supplied at runtime.

## Run the published image

From the project directory:

```powershell
docker login
docker compose -f compose.dev-image.yaml pull
docker compose -f compose.dev-image.yaml up -d --wait
docker exec animesoul-dev node /app/api/dev-box/account.mjs
```

The last command displays the email, password, current six-digit admin code and authenticator URI. Codes expire at the end of their 30-second time step and are single-use. Run the command again for a fresh code. Credentials are never printed in container startup logs. Set `DEV_ACCOUNT_PASSWORD` with `docker run -e DEV_ACCOUNT_PASSWORD=...` to choose a first-boot password; changing this variable does not reset an existing account.

- Web: <http://localhost:18021>.
- Admin: <http://localhost:18022>.
- API: <http://localhost:18020/api/ready>.

Compose forwards only explicitly listed runtime settings from the local `.env`, including playback providers, trace.moe, GIPHY, Google OAuth and SMTP. It never forwards the original database address or password. Providers need their `ALLOW_KODIK` / `ALLOW_YUMMY` switch and credentials; they can also be disabled in administration. Supply credentials separately on another computer. With Compose, use `DEV_SITE_URL`, `DEV_ADMIN_URL` and matching port bindings for another host. PostgreSQL listens only on container loopback; port 5432 is not published.

For a separate private configuration, copy `.env.example` to `.env.dev-image` (preserve any
existing file), fill the service keys, then use these arguments for every operation:

```sh
docker compose --env-file .env.dev-image -f compose.dev-image.yaml pull
docker compose --env-file .env.dev-image -f compose.dev-image.yaml up -d --wait
```

`ALLOW_KODIK_DIRECT` and its private key enable direct HLS; `GIPHY_API_KEY` enables the
GIF picker; both Google values enable OAuth; `MAIL_MODE=smtp` and SMTP settings enable
mail delivery. `MAIL_MODE=file` uses persistent local test mail. The Google callback is
`<DEV_SITE_URL>/api/auth/google/callback` (default `http://localhost:18021/api/auth/google/callback`).
The internal proxy channel shares a runtime-generated secret and trusts only loopback
between bundled web/API; an explicit `INTERNAL_PROXY_SECRET` overrides that generated secret.
MFA and PostgreSQL keys remain attached to the private volume. `DEV_APP_ENV=production`
requires separate HTTPS web/admin hosts and forbids file mail and fixed viewer IPs.
Use [self-hosting](SELF_HOSTING.md) for the standard Caddy/HTTPS deployment. Features
not yet implemented in the main application, including real payments, remain unavailable.

```powershell
docker compose -f compose.dev-image.yaml stop
docker compose -f compose.dev-image.yaml start
docker compose -f compose.dev-image.yaml logs --tail=100
```

The `animesoul-dev-image_dev-data` volume preserves accounts, libraries, settings and catalog edits. A normal `down` retains it. `down -v` deletes all test-environment data; the next boot generates new credentials. A newer image tag does not replace an existing volume's catalog: the bundled snapshot is used only for an empty database. Before starting the API, Prisma applies pending schema migrations. The legacy single-account index is removed without deleting existing accounts or resetting the owner's credentials. Back up the volume before upgrading.

## Build and verify

The main local PostgreSQL container must be running. The exporter reads `animesoul-postgres-1`; override it with `DEV_SNAPSHOT_CONTAINER` if needed.

```powershell
node scripts/docker/snapshot-dev-catalog.mjs
docker build --platform linux/amd64 --target dev-box -t quiddens/animesoul-dev:dev -t quiddens/animesoul-dev:dev-20261106 -f infra/docker/Dockerfile .
docker compose -f compose.dev-image.yaml up -d --pull never --wait
docker exec animesoul-dev node /app/api/dev-box/verify.mjs
docker compose -f compose.dev-image.yaml restart
docker exec animesoul-dev node /app/api/dev-box/verify.mjs
```

The exporter runs `pg_dump` with an explicit data-table allowlist, writes schema and catalog separately, compares row counts before and after export, and records SHA-256 checksums in `artifacts/dev-image/manifest.json`. First boot verifies checksums, restores schema, data and constraints in one transaction, and checks every table's row count. The original database is never modified.

The Dockerfile reuses API and Next.js standalone build stages. Its PostgreSQL 18 runtime stage contains Node.js 24, compiled applications, the snapshot and a process supervisor. The supervisor starts PostgreSQL, API, worker, web and admin, stops all services when one fails, and shuts PostgreSQL down last. Healthchecks cover all three HTTP services. The container runs as `postgres`, without root or extra Linux capabilities.

`.dockerignore` excludes private files, dependencies and other artifacts; only the two snapshot dumps and manifest are admitted from `artifacts`. Snapshots are not tracked in Git. The integration verifier checks the full snapshot, exclusion of original private data, owner web/MFA login, administrative endpoints, native-player access, additional unprivileged registration, friendship, posts and replies. Run it only on a disposable verification volume: it creates its own additional test account and community content.

## Publish privately

The November 6, 2026 snapshot contains 13,142 anime, 1,244 characters and 1,766 cast
links, with schema migration `202611020001_community_content`. Existing dev-box volumes
retain their data and receive pending migrations. To preview the bundled catalog independently,
run the dated image with a separate fresh volume alongside the previous box:

```sh
docker run -d --name animesoul-dev-20261106 --mount type=volume,src=animesoul-dev-20261106,dst=/var/lib/postgresql -e SITE_URL=http://localhost:28021 -e ADMIN_URL=http://localhost:28022 -p 127.0.0.1:28020:8020 -p 127.0.0.1:28021:8021 -p 127.0.0.1:28022:8022 quiddens/animesoul-dev:dev-20261106
docker exec animesoul-dev-20261106 node /app/api/dev-box/account.mjs
```

This creates a new generated test account and does not copy changes from the old volume.
All implemented functionality is available; external integrations need their runtime
credentials, as described above. The regular multi-container HTTPS setup uses [self-hosting](SELF_HOSTING.md).

```powershell
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev --prepare-only
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev-20261106
```

The publisher reads the existing Docker Desktop login through its credential helper. Tokens remain in memory and are never logged or embedded in images. It creates a missing repository through the Docker Hub API with `is_private: true`, checks private visibility before and after `docker push`, and refuses to push to a public repository. It verifies the published tag, confirms denial of anonymous pulls and records its digest in `artifacts/dev-image/published-<tag>.json`.

Repository: <https://hub.docker.com/r/quiddens/animesoul-dev>. Pulling requires an authenticated account with access to this private repository. Use a new dated tag for each release; `dev` may follow the current test version.

Docker references: [private repositories](https://docs.docker.com/docker-hub/repos/create/), [repository creation API](https://docs.docker.com/reference/api/hub/latest/operations/CreateRepository/), [access-token API](https://docs.docker.com/reference/api/hub/latest/operations/AuthCreateAccessToken/).
