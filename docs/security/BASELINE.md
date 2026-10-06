[English](BASELINE.md) | [Русский](BASELINE.ru.md)

# Security baseline

This is an early foundation, not production authorization.

Implemented: validated inputs and DTO outputs, bounded parameterized Prisma reads, server profile privacy,
no shared response cache, no proxy-header trust, 64 KiB body limit, 120 requests/minute/IP,
API security headers, website frame/type/referrer restrictions, disabled indexing, closed admin API,
private configuration and reproducible dependency lock.

The limiter is process-local and uses the actual socket IP. Redis-backed limits and a configured trusted
proxy are required before multiple replicas or Cloudflare. Do not trust a client-supplied forwarded address.

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
