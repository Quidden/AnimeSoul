[English](README.md) | [Русский](README.ru.md)

# Project utilities

Public commands are defined by [package.json](../package.json) and run through pnpm from the root.

| Directory   | Files                                                          | Responsibility                                                                               |
| ----------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `workspace` | `setup.mjs`                                                    | Creates private `.env` once                                                                  |
| `workspace` | `build.mjs`, `run.mjs`                                         | Ordered package/application builds using the current pnpm CLI                                |
| `workspace` | `dev.mjs`                                                      | Builds server packages, starts API/Web/Admin and stops only its own processes                |
| `workspace` | `dev-status.mjs`                                               | Checks occupied ports and recognizes an already running AnimeSoul stack                      |
| `workspace` | `open-development-site.mjs`                                    | Opens the default browser after the local stack is ready                                     |
| `quality`   | `check-docs.mjs`                                               | Checks local Markdown links, excluding dependencies/generated files                          |
| `windows`   | [Start AnimeSoul.bat](windows/Start%20AnimeSoul.bat)           | Starts the full Docker stack, waits for readiness and opens the website                      |
| `windows`   | [Start AnimeSoul Dev.bat](windows/Start%20AnimeSoul%20Dev.bat) | Original Node.js/pnpm development launcher                                                   |
| `windows`   | [Setup Docker.ps1](windows/Setup%20Docker.ps1)                 | Creates missing `.env` without host Node.js                                                  |
| `docker`    | `migrate-native.mjs`                                           | Backs up native PostgreSQL and copies it into an empty Docker database, verifying all tables |

Keep maintained utilities here. Temporary reports, screenshots and local exports belong in ignored
`artifacts`; documentation belongs in `docs`. See [local development](../docs/operations/LOCAL_DEVELOPMENT.md).
Container launch and HTTPS server deployment: [Docker](../docs/operations/DOCKER.md).

`pnpm secrets:check` uses `quality/check-secrets.mjs` to scan Git candidates without printing
secret values. `--staged` checks the index; `--history` checks unpublished commits reachable
from HEAD. [Manual GitHub/GHCR delivery](../docs/operations/GITHUB.md).

Stage 2: `profiles:import` (migrate-profiles.mjs) and `account:operator` (account-operator.mjs);
[accounts and one-time claims](../docs/operations/ACCOUNTS.md). Setup also adds a missing MFA key.

Stage 3: `catalog:sync` and `catalog:worker` launch `apps/worker/main.mjs` with a durable PostgreSQL cursor/queue. `providers:switch` shares admin policy and pauses imports only when Kodik is disabled. [Operations](../docs/operations/CATALOG.md).

`catalog:characters` preloads up to 50 stale or missing published anime casts from Shikimori
into the local database. Use `--limit=100` (maximum 1000) or `--slug=anime-slug` to select a batch.
Build first and apply migrations. Requests run sequentially; failures keep cached characters.

`demo:community` creates 100 fictional local accounts and meaningful activity;
`demo:community verify` checks every password. Repeating seed preserves user changes.
[Guards, credentials and scenarios](../docs/operations/DEMO_COMMUNITY.md).
