[English](README.md) | [Русский](README.ru.md)

# AnimeSoul documentation

[Private test Docker image](operations/DEV_IMAGE.md): full catalog, one owner account, build and publication.

[Publications and discussions](operations/CONTENT.md) · [100 fictional users](operations/DEMO_COMMUNITY.md).

GitHub/Docker delivery updated against `main` on 2026-10-14. This repository contains the new website stack;
Android lives separately and desktop development is discontinued. Legacy source/data is preserved
outside this workspace; feature migration remains incomplete.

[GitHub: default branch, manual GHCR publication and secret checks](operations/GITHUB.md).

## Start here

Full-stack launch and future server deployment: [Docker and HTTPS](operations/DOCKER.md).

1. [Project map](architecture/PROJECT_MAP.md): source placement, ownership and where to make a change.
2. [Local development](operations/LOCAL_DEVELOPMENT.md): launch, configuration, database and checks.
3. [Site map](architecture/SITE_MAP.md): implemented pages, navigation, APIs and future sections.
4. [Data model](architecture/DATA_MODEL.md): relationships, DTOs and server privacy.

## All guides

Accounts and migration: [operations](operations/ACCOUNTS.md).
Playback and native PostgreSQL: [operations](operations/PLAYBACK.md).
Subscriptions, trials and promotions: [operations](operations/SUBSCRIPTIONS.md).
Catalog, background jobs and ID review: [operations](operations/CATALOG.md).
Stage count: [4 of 14 complete](migration/STATUS.md#stage-count).
Friends and privacy: [operations](operations/FRIENDS.md).
Universal anime, people and settings search: [guide](operations/SEARCH.md).
User errors and server diagnostics: [guide](operations/DIAGNOSTICS.md).

| Document                                             | Purpose                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Project map](architecture/PROJECT_MAP.md)           | Actual tree, workspaces/branches, dependencies, entry points and change locations      |
| [Site and API map](architecture/SITE_MAP.md)         | URLs, filter parameters, profile anchors, endpoints, SEO and proposed future addresses |
| [Data model](architecture/DATA_MODEL.md)             | Prisma relations, JSON blocks, public contracts and import boundaries                  |
| [Architecture decisions](architecture/FOUNDATION.md) | Web/API/Admin boundaries, SSR, configuration and ownership                             |
| [Local development](operations/LOCAL_DEVELOPMENT.md) | Setup, dev, PostgreSQL, checks and environment consumers                               |
| [Security](security/BASELINE.md)                     | Implemented protections, source locations and remaining requirements                   |
| [Migration and recovery](migration/STATUS.md)        | Work completed, evidence, limitations and preserved archive                            |
| [Migration roadmap](architecture/WEB_STACK_PLAN.md)  | Target architecture, gates, security, providers and sandbox billing                    |
| [Presentation](design/README.md)                     | Current CSS/components and the retained prototype's limits                             |
| [Profile media](../apps/web/public/ASSETS.md)        | Preset files and future GIF picker status                                              |
| [Worker](../apps/worker/README.md)                   | Executable PostgreSQL catalog queue, launch and future jobs                            |

## Status vocabulary

Implemented means existing source with the stated verification. Schema-only means tables/contracts
without a completed workflow. Planned means no current route or service.
The fixture profile is not authentication; a 200 admin information page grants no administrative access.
Source and checks take precedence over illustrations and target architecture.

Update both language versions when routes, DTOs, tables, configuration or commands change.
`pnpm docs:check` validates local links; `pnpm format:check` validates formatting.
Old-stack documentation stays in the archive; Android guides belong to `AnimeSoulMobile`.

[Social network plan](architecture/SOCIAL_NETWORK_PLAN.md): friends, posts/timestamps, messages, watch rooms, votes, hashtags and 18+/NSFW/spoilers.

[Administration: navigation, users, analytics and publishing](operations/ADMINISTRATION.md).
