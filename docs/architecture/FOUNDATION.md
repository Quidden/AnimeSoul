[English](FOUNDATION.md) | [Русский](FOUNDATION.ru.md)

# Foundation decision — 2026-10-06

[Source and dependencies](PROJECT_MAP.md) · [Pages/API](SITE_MAP.md) ·
[Data model](DATA_MODEL.md) · [Launch/configuration](../operations/LOCAL_DEVELOPMENT.md).

The website is a modular monolith. One server owns business rules and database access.
Next.js server pages consume validated public API responses; they do not reproduce authorization rules.

| Path                 | Ownership                                                                 |
| -------------------- | ------------------------------------------------------------------------- |
| apps/web             | Public server-rendered pages, metadata, JSON-LD, sitemap and presentation |
| apps/api/src/catalog | Published catalog and public profile reads                                |
| apps/api/src/admin   | Session, role and MFA administrative boundary                             |
| apps/admin           | Separate non-indexed administration application                           |
| apps/worker          | Reserved boundary; no job runner yet                                      |
| packages/contracts   | Zod DTOs, server privacy serializer and provider policy                   |
| packages/database    | Prisma schema, migration, lazy PostgreSQL client, development fixtures    |
| packages/config      | Shared strict TypeScript settings                                         |
| infra                | Local PostgreSQL/Redis services; production configuration follows later   |
| scripts              | Setup, deterministic build, service lifecycle and document validation     |
| docs                 | Decisions, migration evidence and operational requirements                |

Dependencies point from applications to shared packages. Database access stays server-side.
Controller inputs are validated before a bounded ORM query; raw SQL interpolation is prohibited.
The only raw query currently present is the constant readiness probe SELECT 1.

Next.js calls the API through `apps/web/lib/api.ts`: five-second timeout, no-store and Zod validation.
Client `SiteHeader` and `ProfileHeader` own menu/scroll behavior, not access or persistence rules.
Admin currently makes no API requests. Redis is present in compose; worker is documentation only.
Background jobs and shared caching are pending. TypeScript, ESLint and Prettier configuration
belongs to `packages/config`; utilities are split into `scripts/workspace`, `scripts/quality`, `scripts/windows`.

## Configuration

The root .env is private. Setup creates random local PostgreSQL credentials once and never overwrites existing settings.
Development services bind to loopback on 8020–8022. Database and Redis bind to loopback on 54329 and 6391.
DEMO_CATALOG is opt-in and rejected by the API in production.
PUBLIC_INDEXING=true requires a public HTTPS SITE_URL and forbids the development catalog.
SITE_URL is the canonical public origin; API_URL is a server-only service origin.
`ALLOW_YUMMY`/`ALLOW_KODIK` enforce runtime restrictions together with `ProviderSetting` and credentials.
`PAYMENTS_ENABLED` and Redis remain reserved without billing integration. See the
[configuration-consumer table](../operations/LOCAL_DEVELOPMENT.md#configuration-consumers).

## Public API

| Method and path             | Result                                                 |
| --------------------------- | ------------------------------------------------------ |
| GET /api/health             | Liveness and version; no infrastructure credentials    |
| GET /api/ready              | Database readiness, 200 or 503                         |
| GET /api/catalog?q=         | At most 60 published anime, query up to 100 characters |
| GET /api/anime/:slug        | Published anime or 404                                 |
| GET /api/profiles/:username | Server-filtered public profile or 404                  |
| GET /api/sitemap/catalog    | Published slugs and real update dates                  |
| GET /api/sitemap/profiles   | Public, indexing-enabled profile names and dates       |
| Any /api/admin path         | 401 until session/role/MFA implementation              |

All API responses use no-store. Closed profiles and disabled users do not leave the database.
The public serializer removes hidden about, favorites, folders, ratings and statistics.
Invisible presence becomes offline; internal visibility, email and password data never appear in its DTO.
Owner editing, authenticated DTOs, account migration and MFA are implemented in stage 2; see [accounts](../operations/ACCOUNTS.md).

## SEO

Anime and profile routes render names and permitted content on the server.
Metadata uses canonical URLs and descriptions. Search query pages use noindex.
JSON-LD is escaped for script contexts and reflects visible fields; ratings are not invented.
Local previews have noindex, robots disallow and an empty sitemap. Admin always has noindex and an X-Robots-Tag.
Public deployment, domain verification and Search Console submission are later gates, so search ranking is not promised.
The single sitemap refuses to exceed 50,000 URLs in total; implement shards before reaching that capacity. Development records carry an explicit database flag, never enter sitemap and remain noindex even in database preview mode.

## Deliberate boundaries

Kodik supplies the primary catalog and playback; YummyAnime is an optional playback reserve.
Audited local operator switches and cache invalidation are implemented.
Providers default to disabled; the personal environment was explicitly enabled with user approval.
Full background import and secure administrative controls remain stage 3 work. [Playback](../operations/PLAYBACK.md).
Payments have foundational order/payment/webhook/entitlement tables, with no charge endpoint or premium activation.
Library normalization, translations, pagination, media processing, sessions, MFA and metrics follow the roadmap.

## Presentation and maintenance

The established dark website style is preserved. CSS is split into `base`, `header`, `home`,
`catalog`, `anime`, `profile` under `apps/web/styles`, imported by `app/globals.css`.
The [presentation guide](../design/README.md) identifies related components.
API source uses controller/service, shared DTOs and a server database package; `src/modules`
and `packages/ui` remain target layout rather than implemented directories.
Route, schema, environment and launch changes require corresponding maps and verification updates.
