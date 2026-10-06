[English](BASELINE.md) | [Русский](BASELINE.ru.md)

# Security baseline

Checked against `main` on 2026-10-06. [Boundaries](../architecture/PROJECT_MAP.md) ·
[Routes/privacy](../architecture/SITE_MAP.md) · [Data model](../architecture/DATA_MODEL.md).

This is an early foundation, not production authorization.

Implemented: validated inputs and DTO outputs, bounded parameterized Prisma reads, server profile privacy,
no shared response cache, no proxy-header trust, 64 KiB body limit, 120 requests/minute/IP,
API security headers, website frame/type/referrer restrictions, disabled indexing, closed admin API,
private configuration and reproducible dependency lock.

The limiter is process-local and uses the actual socket IP. Redis-backed limits and a configured trusted
proxy are required before multiple replicas or Cloudflare. Do not trust a client-supplied forwarded address.

SSR API requests use the Next.js server IP and share this limit. This is a local boundary,
not completed per-account/end-user protection.

| Protection                                              | Source                                                                | Evidence/limit                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 64 KiB body, rate limit, Helmet, admin denial, no-store | `apps/api/src/app.ts`                                                 | `apps/api/tests/api.test.mjs`; process-local limiter             |
| Environment validation and production-demo refusal      | `apps/api/src/config.ts`                                              | Configuration test; production database is not deployed          |
| Public/active-user reads and bounded queries            | `apps/api/src/catalog/catalog.service.ts`                             | Database integration test requires isolated PostgreSQL           |
| Hidden-field removal and invisible conversion           | `packages/contracts/src/profiles.ts`                                  | Privacy and compiled HTML tests                                  |
| Input/output validation                                 | Controller, `packages/contracts`, `apps/web/lib/api.ts`               | API and HTML tests                                               |
| Metadata, escaped JSON-LD, indexing restrictions        | `apps/web/lib/site.ts`, app pages/robots/sitemap                      | `tests/seo.test.mjs`, `tests/website.test.mjs`                   |
| Frame/type/referrer restrictions; admin noindex         | Web/admin `next.config.ts`                                            | Not a complete nonce-CSP for future playback                     |
| Secrets/reproducibility                                 | `.gitignore`, `.env.example`, `scripts/workspace/setup.mjs`, lockfile | Private env, old databases and signing material stay outside Git |

The badge is decoration, not role verification. `Session`, `UserRole` and `Entitlement` schemas
do not establish working authentication. Admin APIs return 401; its HTML is informational.
Upload, GIF-search and billing endpoints are absent; their future premium enforcement is pending.
Cloudflare, distributed limits, worker and S3 integration are not active.

Prisma 7.10 pins vulnerable transitive packages. Scoped pnpm overrides replace @prisma/config's deepmerge-ts
with 8.0.2 and Prisma CLI's mysql2 with 3.24.5.
The deepmerge 8 changes concern Maps and merge-into mutation; our Prisma configuration consists of plain objects.
Validate, generate, schema diff and builds are rechecked with overrides. Review them when upgrading Prisma.
References: [deepmerge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
[release changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0),
[MySQL advisory](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr).

Next gates: Argon2id, session token hashing and expiry, CSRF/Origin checks, ownership permissions, MFA,
owner bootstrap, append-only audit permissions, media validation/SSRF protection, nonce CSP compatible with the
player, distributed limits, sandbox payment signatures/idempotency, secret scanning, threat-model review,
PostgreSQL restore, load testing, Cloudflare and locked origin. No public release before these gates.
