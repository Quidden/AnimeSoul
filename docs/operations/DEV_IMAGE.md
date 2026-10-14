[English](DEV_IMAGE.md) | [Русский](DEV_IMAGE.ru.md)

# Private test image

`quiddens/animesoul-dev:dev` packages the current web application, administration, API, worker and PostgreSQL 18 into one `linux/amd64` container. It is an isolated test environment with the full local catalog snapshot, using compiled Next.js applications rather than hot-reload development servers.

First boot restores anime, characters, relationships, episodes, provider identifiers and subscription plans into a separate persistent Docker volume. It creates exactly one `DevOwner` / `dev-owner@example.test` account with `owner` and `admin` roles, full privileges and native-player access. The password, TOTP secret and MFA encryption key are generated at runtime. Admin authentication still requires MFA. A constraint in this test database prevents a second account; registration returns HTTP 409. The main application schema is unchanged.

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

Compose forwards only explicitly listed external-service credentials from the local `.env`. It never forwards the original database address or password. Providers are available when their `ALLOW_KODIK` / `ALLOW_YUMMY` switch and credentials are supplied; they can also be disabled in administration. Supply provider credentials separately on another computer. Change `SITE_URL`, `ADMIN_URL` and port bindings to use another host. PostgreSQL listens only on the container loopback address; port 5432 is not published.

```powershell
docker compose -f compose.dev-image.yaml stop
docker compose -f compose.dev-image.yaml start
docker compose -f compose.dev-image.yaml logs --tail=100
```

The `animesoul-dev-image_dev-data` volume preserves the account, library, settings and catalog edits. A normal `down` retains it. `down -v` deletes all test-environment data; the next boot generates new credentials. A newer image tag does not replace an existing volume's catalog: the bundled snapshot is used only for an empty database.

## Build and verify

The main local PostgreSQL container must be running. The exporter reads `animesoul-postgres-1`; override it with `DEV_SNAPSHOT_CONTAINER` if needed.

```powershell
node scripts/docker/snapshot-dev-catalog.mjs
docker build --platform linux/amd64 --target dev-box -t quiddens/animesoul-dev:dev -t quiddens/animesoul-dev:dev-20261011 -f infra/docker/Dockerfile .
docker compose -f compose.dev-image.yaml up -d --pull never --wait
docker exec animesoul-dev node /app/api/dev-box/verify.mjs
docker compose -f compose.dev-image.yaml restart
docker exec animesoul-dev node /app/api/dev-box/verify.mjs
```

The exporter runs `pg_dump` with an explicit data-table allowlist, writes schema and catalog separately, compares row counts before and after export, and records SHA-256 checksums in `artifacts/dev-image/manifest.json`. First boot verifies checksums, restores schema, data and constraints in one transaction, and checks every table's row count. The original database is never modified.

The Dockerfile reuses API and Next.js standalone build stages. Its PostgreSQL 18 runtime stage contains Node.js 24, compiled applications, the snapshot and a process supervisor. The supervisor starts PostgreSQL, API, worker, web and admin, stops all services when one fails, and shuts PostgreSQL down last. Healthchecks cover all three HTTP services. The container runs as `postgres`, without root or extra Linux capabilities.

`.dockerignore` excludes private files, dependencies and other artifacts; only the two snapshot dumps and manifest are admitted from `artifacts`. Snapshots are not tracked in Git. The integration verifier checks the full snapshot, exactly one account, exclusion of original private data, web login, admin MFA login, administrative endpoints, native-player access and rejection of a second account.

## Publish privately

```powershell
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev --prepare-only
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev
node scripts/docker/publish-dev-image.mjs quiddens/animesoul-dev dev-20261011
```

The publisher reads the existing Docker Desktop login through its credential helper. Tokens remain in memory and are never logged or embedded in images. It creates a missing repository through the Docker Hub API with `is_private: true`, checks private visibility before and after `docker push`, and refuses to push to a public repository. It verifies the published tag, confirms denial of anonymous pulls and records its digest in `artifacts/dev-image/published-<tag>.json`.

Repository: <https://hub.docker.com/r/quiddens/animesoul-dev>. Pulling requires an authenticated account with access to this private repository. Use a new dated tag for each release; `dev` may follow the current test version.

Docker references: [private repositories](https://docs.docker.com/docker-hub/repos/create/), [repository creation API](https://docs.docker.com/reference/api/hub/latest/operations/CreateRepository/), [access-token API](https://docs.docker.com/reference/api/hub/latest/operations/AuthCreateAccessToken/).
