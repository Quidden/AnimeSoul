[English](SITE_MAP.md) | [Русский](SITE_MAP.ru.md)

# Site and API map

Checked 2026-10-08. Website: http://localhost:8021; API: http://127.0.0.1:8020; admin: http://localhost:8022.
Public SSR uses server DTO requests. Client mutations use bounded, allowlisted Next.js proxies.

| Page                                      | Implemented behavior                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| /                                         | Actual continue-watching banner, watching shelf and popular catalog                        |
| /catalog                                  | Popular/ongoing/new/top shelves, full-database filters and random selection                |
| /catalog/:section, /catalog/genres/:genre | Dedicated discovery pages, pagination and watched-genre selection                          |
| /anime/:slug/franchise                    | Published exact-ID related titles and current-title marker                                 |
| /characters/:slug                         | Character portrait, names, description, voice actors and published anime appearances       |
| /anime/:slug                              | Metadata, episode/translation embeds, favorites, scores and folders                        |
| /users/:username                          | Guest public profile; owner/friends see permitted blocks; inaccessible profiles return 404 |
| /account                                  | Login/register/claim, owner editing/privacy, password and MFA setup                        |
| /library                                  | Private folders, notes, season/episode scores and imported positions                       |
| /friends                                  | People search, friends, requests, subscriptions, followers and blocks; sign-in required    |
| /robots.txt, /sitemap.xml                 | Locally disallowed/empty; public indexing requires consent and HTTPS                       |
| Admin /                                   | Role/MFA sign-in, provider switches, import queue and mapping review                       |

Header links to catalog, account, library and friends. Demo soul is not authentication.
Published library titles open playback; unpublished imported references await catalog enrichment.
Profile anchors are profile-favorites, profile-collections, profile-ratings and profile-statistics,
only when their blocks are visible. Catalog accepts q (100 chars), genre, status (released/ongoing/announced),
sort (popular/rating/rating-asc/title/newest/oldest), format, translation, group, excludeGenre,
ratingSource/minRating, personalized, from/to (1900–2200) and page; all filters precede pagination.
Filtered pages use noindex and canonical /catalog.

## API

`GET /api/catalog/random?mode=all|filtered|taste` selects a published title; taste and
personal scores require the web session. `GET /api/anime/:slug/related` returns exact-ID
published related titles. Personal catalog queries use no-store and are excluded from indexing.

| Routes                                                                             | Access and purpose                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET /api/health, /api/ready                                                        | Process liveness; PostgreSQL readiness returns 503 when unavailable |
| GET /api/catalog, /api/anime/:slug                                                 | Public catalog and metadata                                         |
| GET /api/anime/:slug/characters, /api/characters/:slug                             | Per-title cast and shared character profiles                        |
| GET /api/anime/:slug/playback                                                      | Current approved iframes; no provider secrets                       |
| GET /api/profiles/:username                                                        | Filtered public DTO                                                 |
| GET /api/sitemap/catalog, /api/sitemap/profiles                                    | Published/indexing-eligible records                                 |
| POST /api/auth/register, /api/auth/login, /api/auth/claim                          | Origin/custom header; issue web cookie                              |
| GET /api/auth/me                                                                   | Own identity, roles, MFA status and CSRF; web session               |
| POST /api/auth/logout, /api/auth/logout-all, /api/auth/password                    | Revoke sessions/change password; Origin/CSRF                        |
| POST /api/auth/mfa/begin, /api/auth/mfa/confirm                                    | Owner-only confirmed setup                                          |
| GET/POST /api/account/profile, /api/account/library                                | Owner profile/library and mutations                                 |
| POST /api/account/ratings                                                          | Season/episode scores                                               |
| POST /api/account/folders, /api/account/folders/delete, /api/account/folders/entry | Owner folders, memberships and notes                                |
| POST /api/account/progress                                                         | Position/duration/completion without video URLs                     |
| POST /api/admin/auth/login                                                         | Admin Origin, password, explicit role and MFA; separate cookie      |
| GET /api/admin/auth/me, POST /api/admin/auth/logout, GET /api/admin                | Separate admin audience, role and MFA                               |

All responses use no-store. Account mutations derive ownership from the session, ignoring body IDs/x-role.
Administrative paths are guarded before handlers except login, which verifies credentials/role/MFA itself.
Web proxy excludes admin paths; admin proxy excludes web-account paths. Request streams are limited to 64 KiB.
[Account DTOs](../../packages/contracts/src/account.ts).

## Indexing and pending routes

PUBLIC_INDEXING=false sets noindex/disallow and an empty sitemap. Public HTTPS, real data and owner consent
are required to enable indexing. Filters, account, library, admin and fixtures never enter sitemap.
Metadata/JSON-LD use only public DTOs. Media/GIF uploads, public collection pages,
payment callbacks and broader user/moderation administration remain pending.

[Accounts](../operations/ACCOUNTS.md) · [Playback](../operations/PLAYBACK.md) · [Data](DATA_MODEL.md).

## Catalog administration

GET /api/anime/:slug/playback uses Kodik then the enabled reserve; ?provider=yummy is rejected. Site-wide reserve changes require owner/delegation and admin MFA.
GET /api/catalog/by-ids accepts up to 100 UUIDs and returns published metadata only.
GET /api/admin/catalog?page=1 returns provider states, recent jobs and conflict review pages.
POST /api/admin/providers/switch, /api/admin/catalog/import, /api/admin/catalog/job and
/api/admin/catalog/resolve require admin audience, role, MFA, Origin/CSRF and a reason.
[Contracts](../../packages/contracts/src/catalog-admin.ts) · [Operations](../operations/CATALOG.md).

## Identity and future social routes

`GET /api/auth/options` reports Google/email availability without credentials. `POST /api/auth/email/verify` and `/email/change` require owner/Origin/CSRF; `/email/confirm`, `/password/request-reset`, `/password/reset` require Origin/custom header. `POST /api/auth/google/start` starts login/link; linking requires session, CSRF and password. `GET /api/auth/google/callback` checks state/browser/PKCE/nonce and issues a web cookie. Next callback redirects to `/account` without retaining code/state in the URL. `/api/account/profile` persists presets; `/api/auth/me` includes avatar, publication, emailVerified, hasPassword and googleLinked.

Community, hashtag filtering and post routes are implemented below. Message and watch-room routes remain planned: [Social network plan](SOCIAL_NETWORK_PLAN.md).

## Episodes and progress

`/anime/:slug/episodes/:episodeId?t=125` serves episode SSR, canonical without timestamps, TVEpisode and links.
`GET /api/anime/:slug/episodes` and `/episodes/:id` expose published episodes without media URLs.
`GET /api/anime/:slug/stream?source=<ID>` returns a temporary direct DTO or embed fallback without private keys.
`GET /api/account/playback/:animeId`, `POST /api/account/playback/session` and `/progress` require the owner;
writes verify Origin/CSRF. `/episodes/sitemap-index.xml` lists 256 `/episodes/sitemap/:bucket.xml` shards;
`GET /api/sitemap/episodes/:bucket` (0–255) reads only real published episodes.
[Player configuration and limits](../operations/PLAYBACK.md).

## Friends and private profiles

The friends route provides user search, requests, friends, follows and blocks with noindex. User pages honor owner/friend/block access with a web session; guests see only public sections. The profile-friends anchor requires an accessible list. The account/social and account/profiles APIs are documented in the [guide](../operations/FRIENDS.md). Metadata/JSON-LD use guest data only; authenticated HTML has noindex.

## First stage 6 discussions

`/community` lists recent content, `/community?tag=…` filters hashtags, `/posts/:id` opens a post
and replies. Anime/episode pages show related posts and discussion; profiles expose permitted
posts, reviews and comment history. All read the same Post/Comment records; discussion SEO is off.
[Content APIs](../operations/CONTENT.md) · [100 demo accounts](../operations/DEMO_COMMUNITY.md).

## Administration routes

`/`, `/analytics`, `/activity`, `/features`, `/users`, `/journal`, `/plans`, `/promotions`,
`/subscription-history`, `/announcements`, `/notifications`, `/anime-notices`, `/catalog`,
`/winter`, `/maintenance`, `/templates`, `/system`, `/admin-journal`, `/diagnostics` share a protected layout and noindex.

[API and operating rules](../operations/ADMINISTRATION.md).
