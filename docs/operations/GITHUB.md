[English](GITHUB.md) | [Русский](GITHUB.ru.md)

# GitHub source and container delivery

The TypeScript website is published from `main` in [Quidden/AnimeSoul](https://github.com/Quidden/AnimeSoul).
The previous application remains in `master` and the archive refs. The GPL license added on
`master` is preserved. Changing GitHub's default branch does not deploy the website or migrate data.

The automatic `quality.yml` workflow has been removed. Pushes and pull requests do not run
project tests in GitHub Actions. Existing tests remain available locally through `pnpm check`;
historical Actions runs remain visible.

## Publish application images

Open **Actions → Publish containers → Run workflow**, select **main** and start it manually.
[publish-containers.yml](../../.github/workflows/publish-containers.yml) builds four `linux/amd64`
images from [infra/docker/Dockerfile](../../infra/docker/Dockerfile). A Dockerfile can remain in
this directory: the workflow explicitly passes its path. It publishes to GHCR with the temporary
`GITHUB_TOKEN` and `packages: write`; no personal registry token or provider credentials are needed.
Actions are pinned to commit SHAs. The workflow checks source for secrets before building.

| Image                               | Role                                        |
| ----------------------------------- | ------------------------------------------- |
| `ghcr.io/quidden/animesoul-api`     | API and the worker, using separate commands |
| `ghcr.io/quidden/animesoul-web`     | Compiled website                            |
| `ghcr.io/quidden/animesoul-admin`   | Compiled administration                     |
| `ghcr.io/quidden/animesoul-migrate` | One-off Prisma migrations                   |

Each successful build receives `sha-<full commit SHA>`. Wait for all four jobs to succeed
before using that tag. There is no moving `latest` tag. Source/revision labels connect packages
to the repository. Publishing does not start services, seed accounts or restore a database.
New GHCR packages are private by default; configure their visibility/access in GitHub Packages.
For private pulls, authenticate with `docker login ghcr.io` using an account/token with `read:packages`.
Keep that token in Docker's credential store.

The private catalog dev-box described in [DEV_IMAGE](DEV_IMAGE.md) is built separately.
Its local dumps, original accounts and provider credentials are absent from a GitHub checkout
and are not included in this workflow's application images.

## Run a published version

Prepare the private environment as described in [Docker](DOCKER.md), then set
`ANIMESOUL_IMAGE_TAG=sha-<full commit SHA>` in `.env` (or `.env.server`).
[compose.ghcr.yaml](../../compose.ghcr.yaml) replaces application build sections with registry
images and keeps the database, persistent volumes, readiness checks and startup ordering.

Local:

```sh
docker compose -f compose.yaml -f compose.ghcr.yaml pull
docker compose -f compose.yaml -f compose.ghcr.yaml up -d --no-build --wait
```

HTTPS server:

```sh
docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml -f compose.ghcr.yaml pull
docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml -f compose.ghcr.yaml up -d --no-build --wait
```

Use the same environment/file arguments for later operations. The original local build commands
continue to work. Back up the database and profile media before updating; selecting an older
image does not reverse database migrations. A fork can set `ANIMESOUL_GHCR_REPOSITORY=owner/repository`
with a lowercase name matching its published packages.

## Before committing

```sh
pnpm secrets:check
pnpm secrets:check --history
git add <reviewed paths>
pnpm secrets:check --staged
git diff --cached --check
```

Only `.env.example` and `.env.server.example` are tracked environment templates. Private `.env*`,
keys, database files, artifacts, logs and uploaded media stay outside Git. The checker scans the
working tree or complete index for common token/private-key patterns and exact sensitive values
from local private environment files, printing only file names, line numbers and variable names.
It does not replace reviewing changes and cannot detect every unknown secret. `.dockerignore`
excludes private environment/key files; credentials are supplied only at runtime.

GitHub references: [publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
and [Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
