[English](WEB_STACK_PLAN.md) | [Русский](WEB_STACK_PLAN.ru.md)

# AnimeSoul migration plan

**2026-10-07. Status: implementation started; archive and foundation prepared. [Progress](../migration/STATUS.md).**

User decisions: discontinue desktop development, separate the mobile application, make the website discoverable by anime titles and public usernames, protect administration, expand statistics, and prepare payments. The merchant is based in Ukraine and the audience is international. This is the target roadmap; implemented source/dependencies are in the [project map](PROJECT_MAP.md), routes in the [site map](SITE_MAP.md). Migration remains incomplete; production and payment accounts have not been switched.

## 1. Target architecture

| Area            | Decision                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Public website  | Next.js App Router + React + TypeScript. Server HTML for anime, catalog and eligible public profiles; interactive player/editors on the client |
| API             | Current Node.js LTS + NestJS/Fastify. Modular monolith; the API owns business rules                                                            |
| Persistence     | PostgreSQL + Prisma, versioned migrations, constraints and transactions; preserve existing user UUIDs                                          |
| Administration  | Separate Next.js application on an admin subdomain, independent session and API authorization                                                  |
| Background work | Worker in the same repository for catalog imports, email, media processing, payment events and analytics                                       |
| Redis           | Shared rate counters, short-lived cache and job queue. Payments and entitlements remain durable in PostgreSQL                                  |
| Files           | S3-compatible object storage with distinct public and private areas                                                                            |
| Deployment      | Docker, development/staging/production, reverse proxy, HTTPS, monitoring and backups                                                           |
| Mobile          | Separate `AnimeSoulMobile` repository, versions, CI, signing and secrets; shared documented website API                                        |

Next.js renders pages and calls the API. Do not duplicate authentication, role, payment or profile rules in Server Actions. Proxy public `/api` requests to the backend on the same origin. The admin origin has separately constrained routing and cookies. Pin dependency versions when establishing the foundation. [Next.js server/client boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components), [NestJS/Fastify](https://docs.nestjs.com/techniques/performance).

Universal search is implemented in the shared website header and `/search`: anime titles/aliases,
nicknames/UUIDs, actual settings, filter suggestions and keyboard completion. The API uses a bounded,
briefly cached candidate index with typo/layout matching and fresh publication/privacy checks.
See the [search guide](../operations/SEARCH.md). PostgreSQL full-text/trigram indexes or a dedicated
search service remain possible next steps after measuring relevance and load.

## 2. Code organization and readability

Target layout for subsequent stages, not the current filesystem:

Current API directories are `src/catalog`, `src/admin`, `src/health`; `src/modules`, `packages/ui`,
OpenAPI and an SDK are not implemented. Shared TypeScript/ESLint/Prettier settings are in `packages/config`;
utilities are grouped under `scripts/workspace`, `scripts/quality`, `scripts/windows`.
See the [current data model](DATA_MODEL.md) for existing tables and limits.

```text
apps/
  web/                  # public pages and account area
  api/src/modules/      # auth, users, profiles, catalog, library,
                        # playback, media, social, content, messaging,
                        # watch-rooms, community, billing, administration
  admin/                # tables, forms, reports and management
  worker/               # background jobs
packages/
  contracts/            # API schemas, OpenAPI and clients without secrets
  database/             # Prisma, migrations and server database access
  ui/                   # shared components and design tokens
  config/               # shared TypeScript, lint and formatting
docs/                   # architecture, API, guides and decisions
infra/                  # Docker, proxy, deployment and backup
scripts/                # maintained utilities
artifacts/              # ignored build and verification output
```

Use a pnpm workspace and one lockfile. The root holds README files, configuration and project directories. Python, desktop packaging and historical source stay in the archive branch; mobile source is outside this workspace. [pnpm workspaces](https://pnpm.io/workspaces).

Controllers handle HTTP, services implement use cases, repositories handle persistence, and adapters communicate with providers. Organize frontend code by product feature; keep network access and permission rules outside JSX. Split dense forms, monolithic handlers and global CSS by responsibility rather than arbitrary file size.

Require strict TypeScript, runtime input validation, descriptive names, consistent formatting and no unjustified `any`. Comments explain decisions and constraints. Modules have short ownership descriptions; record architectural decisions in ADRs. Never import secrets or the database package into client bundles. Each PR delivers one coherent change with behavioral validation and relevant documentation.

## 3. Stages and completion gates

Expanded on October 7 to 14 stages (0–13). Numbers 0–4 remain; administration,
payments, infrastructure and cutover (formerly 5–8) are now 10–13.
Social features are part of the target website release. They are planned;
their rules and checks are in the [social network plan](SOCIAL_NETWORK_PLAN.md).

| Stage                          | Work                                                                                                                      | Completion gate                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0. Snapshot                    | Archive source, data, media and Android signing                                                                           | Reproduction and recovery verified                                                                                          |
| 1. Foundation                  | Workspace, apps, CI, migrations and security boundaries                                                                   | Builds, types, migrations and backup/restore pass                                                                           |
| 2. Accounts/profiles           | Data transfer, password and Google, email verification/change/recovery, privacy, media presets and admin MFA              | UUIDs/libraries preserved; isolation/revocation verified; real Google and email verified in a configured environment        |
| 3. Catalog/providers           | Internal IDs, imports, search, mapping review and switches                                                                | Reserve-independent catalog; saved UUIDs/slugs unchanged                                                                    |
| 4. Website/episodes/player/SEO | Stable episode IDs, episode/timestamp routes, custom player, progress, media, metadata and sitemap                        | Video decodes; position persists; episode/timestamp links are provider-independent; privacy holds                           |
| 5. Friends/privacy             | Friend requests/acceptance, follows, blocks, public/private sections                                                      | Reciprocal requests, cancellation, blocking and access checked for both users                                               |
| 6. Publications/discussions    | Text and episode/timestamp posts, reviews, comments, scores, hashtags, 18+/NSFW/spoilers; reports and baseline moderation | One record appears on profile and anime/episode; hidden content stays out of responses, search, notifications and SEO       |
| 7. Messages/notifications      | Private dialogs, unread counts, notifications and settings                                                                | Participant/block checks in HTTP and real-time; redelivery is idempotent                                                    |
| 8. Watch rooms                 | Rooms, invites, chat, play/pause/seek synchronization and reconnect                                                       | Two clients synchronize; separate access checks; no video or credential relay                                               |
| 9. Community/votes             | Reddit-inspired up/down arrows, posts/comments/anime/profiles, hot/new/top and badges                                     | One changeable vote; upvotes lift and prolong visibility, downvotes lower rank; immutable publication time and abuse limits |
| 10. Administration/moderation  | Management, reports, metrics, sanctions and audit                                                                         | Roles/actions checked; metric definitions documented                                                                        |
| 11. Payment preparation        | Plans, orders, rights, sandbox, callbacks, refunds and reconciliation                                                     | Correct entitlements for every scenario; live acceptance enabled separately after verification                              |
| 12. Infrastructure             | Deployment, Cloudflare, origin/admin, anti-bot, backups, real-time and load                                               | Protection, recovery, load, crawlers and callbacks verified                                                                 |
| 13. Cutover                    | Final migration, domain, Search Console, observation and rollback                                                         | Website live; sitemap accepted; metrics, alerts and recovery verified                                                       |

Security and SEO start in stage 1. Baseline moderation ships with the first social
content in stage 6. Real Google/email complete stage 2; the player and stable episode
identity follow, then social stages 5–9. Mobile API work follows stable shared
contracts and does not block the website.

## 4. Git and preservation

The primary local `Documents/AnimeSoul` workspace is already on the new-stack `main`.

1. Previous source snapshot: `cd54517`, branch `codex/archive-current-2026-10-06`, tag `archive-current-2026-10-06`.
2. Previous local source, databases, settings, dependencies and releases are preserved in `Documents/AnimeSoulArchive`, branch `codex/legacy-local-2026-10-06`. This is the preserved old `master` workspace, distinct from the committed migration snapshot.
3. Private backup: `AnimeSoulArchive/artifacts/migration-backup/2026-10-06`; credentials, SQLite/JSON and Android signing material remain outside Git.
4. Website work uses `main`; Android lives in independent `AnimeSoulMobile`. Neither adjacent directory is a website build dependency.
5. The GitHub default branch is `main`; production cutover follows separate stage gates. Automatic Actions tests are removed; images are published manually to GHCR. Local PostgreSQL migrations and backup/restore are verified.

The archive supports recovery and comparison. Reuse verified contracts, data and useful components; do not copy the complete old backend into the new stack.

## 5. Independent mobile application

Android source and a self-contained baseline have already moved to `AnimeSoulMobile`; its builds and guides belong to that repository. New-API networking, device and release verification are still pending. Preserve the reproducible mobile baseline before rewriting networking and the mobile player.

The new network mode uses versioned API contracts and server authentication. Catalog/payment secrets remain on the server. Any temporarily retained local runtime belongs exclusively to the mobile repository. Android owns offline files, PiP, MediaSession, Cast and system downloads; the shared API owns accounts, libraries, entitlements and progress. Generate an SDK from OpenAPI rather than copying backend internals.

Verify update signing, login/logout, account switching, conflicting progress, offline playback and access revocation. Keep the existing application ID and increase versionCode for compatible updates. Native purchases require a separate stage and current store-policy review; web checkout is not automatically an acceptable purchase mechanism for digital premium in a Google Play application. [Google Play payment policies](https://support.google.com/googleplay/android-developer/answer/9858738).

## 6. Catalog, data and providers

Anime receives an internal ID with `provider + external_id` mappings. Slugs, titles, aliases and franchise relationships belong to AnimeSoul. Map existing YummyAnime IDs explicitly; report ambiguous matches to administrators and retain library references until resolved.

Anime pages use published local catalog metadata, so playback-provider downtime does not remove pages from search. Import through background jobs with timeouts, quotas and bounded retries. Distinguish disabled, missing credentials and upstream failure states.

Kodik is the primary metadata and playback provider. Its API refreshes the local metadata cache;
video URLs are resolved separately on playback requests and never persisted. YummyAnime is only
a playback reserve; disabling it does not stop catalog refresh or Kodik.

YummyAnime has a persistent administration setting and a higher-priority environment restriction. Disable it by default in production; enable explicitly for personal use. Apply one policy to every reserve playback request; YummyAnime does not supply catalog jobs. Tests must prove zero outgoing requests when disabled. Production metadata/playback providers must permit the intended use; this is a launch dependency. [YummyAnime terms](https://api.yani.tv/).

Preserve account UUIDs, email verification, Google links, roles, statuses, privacy, favorites, folders, progress and ratings. Support existing password hashes with verification and rehash on login, or a controlled reset. Cutover may revoke old sessions and require login again. Imports are repeatable, report row/relationship counts and never turn preview demo data into real accounts.

## 7. Indexing and SEO

Provide crawlable, relevant pages for queries such as Russian Attack on Titan, Attack on Titan, Shingeki no Kyojin and eligible public usernames. Rankings and timing also depend on content, competition and search engines. [Google SEO guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

### Pages and URLs

- `/anime/ataka-titanov`: titles/aliases, description, year, genres, seasons, status, relationships and available actions.
- `/users/dogem`: username, allowed biography and visible blocks; retain UUID independently of username changes.
- Index useful genre, season and editorial collection pages. Filter combinations must not produce thousands of duplicate indexed pages.
- Use permanent redirects for changed slugs/usernames and mappings for old `/anime/{external_id}` URLs. Privacy takes precedence over old-username redirects.

Return primary text and links in server HTML without JavaScript. Load playback separately; use real crawlable links. Preserve current Russian content at first launch and model `uk/en` localization. Publish language URLs and hreflang only with real translated content. [Google developer guidance](https://developers.google.com/search/docs/fundamentals/get-started-developers).

### Technical work

- Unique title, description, H1, canonical, Open Graph, language and semantic HTML. Example title: Attack on Titan — seasons, description and episodes | AnimeSoul. Generate metadata on the server. [Next.js metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata).
- Sitemap includes published anime and eligible profiles; lastmod reflects real changes. Robots.txt, correct 200/404/410/redirect responses and canonicalization of sorting/duplicate URLs. [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
- Exclude administration, account settings, authentication, internal search, personal folders and payment results from indexing. Noindex is not authorization; robots.txt does not protect private data. [Robots.txt limitations](https://developers.google.com/search/docs/crawling-indexing/robots/intro).
- Appropriate work/breadcrumb JSON-LD and ProfilePage/Person for eligible profiles. Match visible data and do not fabricate ratings; markup does not guarantee rich results. [Google ProfilePage](https://developers.google.com/search/docs/appearance/structured-data/profile-page).
- Optimize posters/fonts, reserve image dimensions, defer GIF/video work, honor reduced-motion and measure LCP/INP/CLS. [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals).
- Connect Search Console, submit sitemap and inspect URLs after domain setup; monitor duplicates, exclusions, queries and clicks.

### Privacy during indexing

A separate setting permits public-profile indexing. The server removes hidden biography, favorite anime, folders, ratings and statistics from public DTOs, HTML, RSC payloads, JSON-LD, OG and shared caches. Never share personal-response caches with public responses. Visibility changes invalidate cache and update sitemap; indexing opt-out emits noindex, and profile closure stops public data disclosure. Previously indexed copies disappear according to the search engine's processing schedule.

Acceptance: inspect anime/username HTML without JS and automatically verify metadata, sitemap and redirects. A unique test string in a hidden block must be absent from all anonymous representations, including source HTML and caches after a setting change.

## 8. Security from the foundation

Threat modeling covers accounts, profiles, providers, media, administration and billing. Track applicable OWASP ASVS level 2 controls, results and justified exclusions. [OWASP ASVS](https://owasp.org/projects/asvs).

| Area               | Requirement                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL injection      | Parameterized queries, allow-listed sorting fields, DTO validation and least-privilege database access; prohibit input concatenation and unsafe raw SQL. ORM usage alone is insufficient. [OWASP SQLi](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html), [Prisma raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries) |
| Authorization      | Check ownership/permission on every request; reject role escalation through payloads and apply privacy on the server. [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)                                                                                                                                                                     |
| Passwords/sessions | Argon2id for new passwords, random sessions hashed in the database, Secure/HttpOnly/SameSite cookies, revocation and single-use reset tokens. [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)                                                                                                                                       |
| CSRF/OAuth         | Mutation protection, Origin checks, exact redirect URIs, state/PKCE for the applicable OAuth flow, constrained CORS. [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)                                                                                                                                                       |
| XSS                | Encode text, sanitize allowed rich content, serialize JSON-LD safely and test CSP with player/GIF sources. [OWASP XSS](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)                                                                                                                                                                        |
| Files              | Verify actual type, size, frames/dimensions; isolated worker, random names and safe serving; reject active SVG/HTML. [OWASP uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)                                                                                                                                                                              |
| SSRF               | Allowed schemes/domains, block private/service IPs, validate DNS/redirects and bound downloads. [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)                                                                                                                                                                           |
| Abuse              | Account/IP/operation-cost limits, search/upload quotas and timeouts; trust client IP only from known proxies                                                                                                                                                                                                                                                                                   |
| Secrets/errors     | Server storage, log redaction, restricted monitoring and error responses without stack traces or tokens                                                                                                                                                                                                                                                                                        |
| Delivery           | CI checks dependencies, secrets, types and builds; unprivileged runtime, private database, isolated environment secrets and updates                                                                                                                                                                                                                                                            |

Test SQLi, XSS, CSRF, cross-account object access, role escalation, premium bypass, forged sessions, malicious files/URLs and payment replay directly against the API. Do not release with unresolved critical/high vulnerabilities.

## 9. Administration and analytics

Prioritize tables, search, filters, date ranges, authorized exports and clear feedback. Use standard components and minimal decoration.

Use an independent admin origin and host-only cookie, mandatory MFA/passkey, reauthentication for sensitive actions, session revocation and functional permissions. Separate owner, administrator, moderator, analyst and financial access. Only the owner grants administrative privileges; registration order never creates an owner. Audit role/provider/price/manual-premium changes with actor, time and reason. Cloudflare Access is an additional verified-token layer; application sessions and authorization remain mandatory.

| Area           | Functions and metrics                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Users          | Registrations, verification, DAU/WAU/MAU, bans, roles, sessions and permissions                                      |
| Catalog        | Published titles, data completeness, import/mapping failures, zero-result searches, editing/redirects                |
| Providers      | Toggles, health, requests, errors, p95 latency, quotas and cache age; masked credentials                             |
| Playback       | Starts/errors, active viewing, popular titles/dubs; no secret stream URLs                                            |
| Profiles/media | Reports, preset avatars/banners, quotas, processing errors, custom badges/decoration                                 |
| Payments       | Orders, success/failure, refunds, entitlements, renewals and unreconciled transactions; totals separated by currency |
| Security       | Authentication failures, limits, anti-bot, MFA/session events and admin audit                                        |
| System         | 5xx, API p95, queue, database/storage, backups and last verified restore                                             |
| SEO            | Sitemap, redirects, page errors and Search Console links; its metrics need a separate integration                    |

Define source, interval, timezone and formula for every metric. Public presence respects the selected status; activity-based DAU/viewing is separate. Filter bots from product metrics according to available classification. Audit is append-only under application permissions; financial/personal-data exports have separate permissions. Define event/log retention before production.

## 10. Payments and premium

First candidate for a Ukrainian merchant: WayForPay, with LiqPay as an alternative adapter. WayForPay advertises international cards and recurring payments; confirm countries, conversion and onboarding for the actual merchant account. Ukraine is currently absent from Stripe's direct merchant-availability list, so the baseline does not depend on Stripe. [WayForPay](https://wayforpay.com/uk), [LiqPay API](https://www.liqpay.ua/doc/api), [Stripe availability](https://stripe.com/global).

Entities: `plans`, `prices`, `orders`, `payments`, `subscriptions`, `webhook_events`, `refunds`, `entitlements`. Store amounts in currency minor units with controlled precision; the server fixes price, currency and term in the order. Provider adapters implement payment creation, signature verification, status queries, refunds and supported subscriptions. Disable live charges in dev/staging.

Use hosted provider checkout so card details never pass through AnimeSoul. Grant premium only after verified server notification and matching order, amount, currency and status. Browser success is not payment proof. Follow each provider's signature protocol; do not copy Stripe's algorithm into WayForPay/LiqPay. [WayForPay Purchase/callback](https://wiki.wayforpay.com/ru/view/852102), [LiqPay callback](https://www.liqpay.ua/uk/doc/api/callback).

Persist events before granting rights; unique constraints and transactions prevent repeated activation. Handle duplicates, delayed and out-of-order callbacks idempotently. Workers reconcile unknown states and retry transient processing failures. Cover renewal cancellation, expiration, failed renewal, refunds and entitlement changes. Start with one-off premium purchases for a fixed term; enable automatic subscriptions after terms/cancellation validation.

Premium is a server entitlement with source/expiry, separate from cosmetic badges and administrative roles. Manual grants have expiry and audit. All users can select static/animated presets; custom uploads and GIF search require premium or higher permission. Expiry blocks new uploads/search while preserving previously selected media. Any different expiry policy needs a separate product decision and disclosure before purchase.

Before live acceptance define plans, cancellation/refunds, support, provider product approval and merchant payment accounting. This stage prepares architecture and sandbox; merchant account, fees and prices are selected separately.

## 11. Cloudflare and launch

Before public launch configure DNS/proxy, HTTPS to origin, WAF and rate rules supported by the chosen plan. Restrict API/database exposure and origin bypass with Tunnel or verified network controls/origin authentication. Protect administration with Cloudflare Access. [Origin protection](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/), [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).

Use Turnstile on registration, recovery and suspicious logins. Verify tokens, hostname/action, expiry and replay on the server. Avoid permanent challenges on public pages. [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

Verified search bots receive public pages without challenge; do not identify them solely by User-Agent. Payment callback routes bypass interactive challenges but require signatures and bounded traffic. Exclude account, administration, authentication and personal API responses from shared CDN caching. [Cloudflare verified bots](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/).

Protect staging with access controls and noindex. Require automated database/media backups, restore checks, monitoring, alerts and operations instructions. At cutover pause old writes, back up, import/reconcile and switch. Rollback after new writes needs a data-transfer procedure; restoring an old database alone loses new operations. Enable live billing separately after sandbox and production checks.

## 12. Launch acceptance

- Clean `main` starts from README; old backend and Android do not participate in website builds.
- Archive restores, UUIDs/libraries reconcile, migrations repeat safely and password/session policies are verified.
- Anime HTML includes titles/description/metadata; eligible profiles include username and only public blocks; sitemap/robots/canonical/redirects pass.
- Normal users can use GIF presets; custom upload/search permissions are enforced on the server.
- Admin operations require MFA/session/permission checks and audit; registration order cannot grant ownership.
- Disabled YummyAnime receives zero requests; library references persist and the catalog uses an appropriate provider.
- Sandbox covers success/failure, forgery, duplicate, delay, refund and expiry; browser success cannot grant rights.
- Security/load checks pass, metric formulas are documented, and anti-bot controls preserve SEO/callbacks.
- Restore works in an independent environment; owners are assigned for alerts, updates, moderation and reconciliation.

Before launch resolve domain/hosting, production catalog provider, budget, public languages and prices. These do not block snapshot, structure and API contracts. Estimate calendar time after inventory and the first working foundation; stage completion gates determine order.
