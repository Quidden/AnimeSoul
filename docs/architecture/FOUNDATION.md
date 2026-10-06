[English](FOUNDATION.md) | [Русский](FOUNDATION.ru.md)

# Foundation decision — 2026-10-06

The website is a modular monolith. One server owns business rules and database access.
Next.js server pages consume validated public API responses; they do not reproduce authorization rules.

| Path                 | Ownership                                                                 |
| -------------------- | ------------------------------------------------------------------------- |
| apps/web             | Public server-rendered pages, metadata, JSON-LD, sitemap and presentation |
| apps/api/src/catalog | Published catalog and public profile reads                                |
| apps/api/src/admin   | Closed administrative boundary                                            |
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

## Configuration

The root .env is private. Setup creates random local PostgreSQL credentials once and never overwrites existing settings.
Development services bind to loopback on 8020–8022. Database and Redis bind to loopback on 54329 and 6391.
DEMO_CATALOG is opt-in and rejected by the API in production.
PUBLIC_INDEXING=true requires a public HTTPS SITE_URL and forbids the development catalog.
SITE_URL is the canonical public origin; API_URL is a server-only service origin.

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
Owner editing and authenticated DTOs are stage 2 work, not simulated by development data.

## SEO

Anime and profile routes render names and permitted content on the server.
Metadata uses canonical URLs and descriptions. Search query pages use noindex.
JSON-LD is escaped for script contexts and reflects visible fields; ratings are not invented.
Local previews have noindex, robots disallow and an empty sitemap. Admin always has noindex and an X-Robots-Tag.
Public deployment, domain verification and Search Console submission are later gates, so search ranking is not promised.
The single sitemap refuses to exceed 50,000 URLs in total; implement shards before reaching that capacity. Development records carry an explicit database flag, never enter sitemap and remain noindex even in database preview mode.

## Deliberate boundaries

No live provider is called by this milestone. Yummy's policy contract and default-disabled environment flag are ready,
but the adapter, audited admin switch and cache invalidation follow in stage 3.
Payments have foundational order/payment/webhook/entitlement tables, with no charge endpoint or premium activation.
Library normalization, translations, pagination, media processing, sessions, MFA and metrics follow the roadmap.
