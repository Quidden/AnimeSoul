[English](BASELINE.md) | [Русский](BASELINE.ru.md)

# Security baseline

Checked against `main` on 2026-10-07. [Boundaries](../architecture/PROJECT_MAP.md) ·
[Routes/privacy](../architecture/SITE_MAP.md) · [Data model](../architecture/DATA_MODEL.md).

Local accounts, owner authorization and admin MFA are implemented. Public production release requires later stages.

Implemented: validated inputs and DTO outputs, bounded parameterized Prisma reads, server profile privacy,
bounded public-response caching, no unauthenticated proxy-header trust, 64 KiB body limit, separate IP traffic budgets,
API security headers, website frame/type/referrer restrictions, disabled indexing, separate audience/role/MFA admin access,
private configuration and reproducible dependency lock.

The limiter is process-local and uses the actual socket IP. Redis-backed limits and a configured trusted
proxy are required before multiple replicas or Cloudflare. Do not trust a client-supplied forwarded address.
Frame-search visitor identities have a separate opt-in [internal proxy channel](../operations/SEARCH.md):
a shared secret and an exact trusted web socket peer are both required. It does not rewrite
the socket IP or the general API budgets. No secret means no forwarded visitor-IP trust.

GET/HEAD reads, including catalog and prefetch requests, share a budget of 600 requests/minute/IP.
Other methods share a separate budget of 120 requests/minute/IP. Experience reads and
`POST /api/experience/event` each have their own 120 requests/minute/IP budget, so background
traffic cannot exhaust catalog reads or user actions. Diagnostics collection has its own
[web-process limit](../operations/DIAGNOSTICS.md).
SSR API requests use the Next.js server IP and share these budgets. This is a local boundary,
not completed distributed production protection.

Availability, health and readiness checks do not consume the shared budget. The staff DEV access
switch uses a separate limit of 60 requests/minute/IP so page traffic cannot block restoring
the real role. Role, origin and CSRF checks still apply.
Account identity and subscription reads each have their own 120 requests/minute/IP budget
so unrelated page traffic cannot make a restored account or player appear signed out.
Rate-limit responses return HTTP 429 with `code: "RATE_LIMITED"`, a `retryAfter` duration in
seconds and the matching `Retry-After` header. Catalog/account and experience proxies preserve
the response body, status and retry header for clients.
The body is validated by `rateLimitErrorSchema` in `packages/contracts`; frame-search
quota and concurrency errors use the same body and header, with an optional `limitScope`.

Only public anime and franchise GET/HEAD responses use `public, max-age=0, must-revalidate`
and a SHA-256 ETag. Every request checks PostgreSQL's complete MVCC snapshot before using
the process-local cache (30 seconds, 128 responses, 32 MiB, coalesced concurrent loads).
Committed writes invalidate it, including withdrawals, ratings and worker updates. Unrelated
writes can also invalidate it conservatively. Conditional requests return 304 with no body.
Account, personalized catalog, errors and all other responses retain `no-store`.

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

The badge is decoration, not a role. Server sessions and roles are enforced; admin requires its own audience and MFA.
Catalog worker, presets and profile media uploads work; live payments, Cloudflare and S3 remain pending.

Prisma 7.10 pins vulnerable transitive packages. Scoped pnpm overrides replace @prisma/config's deepmerge-ts
with 8.0.2 and Prisma CLI's mysql2 with 3.24.5.
The deepmerge 8 changes concern Maps and merge-into mutation; our Prisma configuration consists of plain objects.
Validate, generate, schema diff and builds are rechecked with overrides. Review them when upgrading Prisma.
References: [deepmerge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
[release changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0),
[MySQL advisory](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr).

Next gates: append-only audit privileges, media/SSRF checks, nonce CSP, distributed limits, sandbox billing,
load tests and Cloudflare. Public release requires these later gates.

## Embed playback boundary

Providers use fixed API origins, no redirects, bounded responses/cache and repeated switch checks. Embeds require trusted HTTPS hosts without credentials/nonstandard ports; client-supplied URLs are never proxied. User action starts the sandboxed iframe without popups, top-navigation or downloads. Full nonce-CSP, video decoding verification and production infrastructure remain pending.

## Stage 2 authentication

Argon2id, hashed/expiring sessions, Origin/CSRF, library ownership, explicit owner bootstrap and admin MFA work.
Recovery codes are single-use; TOTP counters use atomic replay checks; secrets are encrypted and bound to the user UUID.
PostgreSQL retains authentication attempt limits and Argon2 concurrency is bounded. Next proxies allowlist routes and bound streams to 64 KiB.
Forwarded headers remain untrusted and local Next requests share the connection IP.
Checks: tests/accounts.test.mjs, apps/api/tests/security.test.mjs and pnpm db:verify.
[Operations and boundaries](../operations/ACCOUNTS.md).

## Google and email

OAuth state binds a browser HttpOnly cookie, expires in ten minutes and is consumed atomically before code exchange. PKCE verifier uses AES-GCM; jose verifies nonce/RS256/issuer/audience/exp/iat/verified email. Google origins are fixed and redirects forbidden. Linking requires the active web session/password, never matching email. Email tokens are hashed, expiry/authVersion-bound and atomically consumed; change/reset revoke both audiences. SMTP requires TLS; production forbids file mode. Presets use an allowlist. Integrations: `tests/identity.test.mjs`; real Google/SMTP still need external checks. Social privacy/NSFW/block/anti-abuse rules remain planned: [social plan](../architecture/SOCIAL_NETWORK_PLAN.md).

## Git and container builds

`pnpm secrets:check` scans source for common token patterns and sensitive values
from private local environment files; `--staged` scans the complete index without
printing secrets. `.gitignore` excludes private env/key/database files; `.dockerignore`
excludes private env/key files from builds. Manual GHCR publication uses temporary
`GITHUB_TOKEN` credentials. [Procedure and limits](../operations/GITHUB.md).
