[English](STATUS.md) | [Русский](STATUS.ru.md)

# Migration progress — October 14, 2026

[Project](../architecture/PROJECT_MAP.md) · [Site/API](../architecture/SITE_MAP.md) ·
[Data](../architecture/DATA_MODEL.md) · [Run](../operations/LOCAL_DEVELOPMENT.md) ·
[Social network](../architecture/SOCIAL_NETWORK_PLAN.md).

## Delivery — October 14

Current source includes profile media/GIPHY, characters, frame/universal search,
subscriptions, expanded administration/analytics, diagnostics and the full Docker stack.
Automatic GitHub Actions tests are removed; manual publication of four GHCR images,
a Compose registry override and pre-commit secret checks are added.
[GitHub guide](../operations/GITHUB.md). Historical verification results below refer
to their stated dates; the stage count reflects the last complete milestone audit.

Verification for this delivery: all four Docker application targets and the Windows
production build succeeded; types, lint, formatting and 577 local documentation links
passed. Local tests: 216 passed, zero failed, 51 skipped because an isolated
`TEST_DATABASE_URL` was not supplied. Working tree, unpublished history and the Git index
were checked for known secret patterns/local private values; application images were
checked for private environment/key/database snapshot files.

## Preserved version

Source: commit `cd54517`, branch `codex/archive-current-2026-10-06`, tag `archive-current-2026-10-06`.
The previous workspace with private settings, databases and releases is preserved in
`C:/Users/dogem/Documents/AnimeSoulArchive`, branch `codex/legacy-local-2026-10-06`.
Its private backup is `artifacts/migration-backup/2026-10-06`. All 15 files were rechecked
by SHA256 on October 7. Secrets, signing material and databases stay outside Git.
Android lives in separate `AnimeSoulMobile`; the new website uses `Documents/AnimeSoul`, `main`.
The TypeScript source is published in `main`, the GitHub default branch. The previous
application remains in `master`; production deployment and data migration are separate.

## Stage count

Stages 3–4 now include dedicated catalog sections, extended filters, three random modes,
Shikimori/community/personal ratings, quick library actions, real home viewing history and
title facts/media/franchise/episode sections. The twelfth migration preserves UUIDs/slugs.
8,744 of 9,020 titles have source scores; unknown scores remain unset. Premiere dates corrected
1,047 sequel years. There are 105 users. Remaining legacy parity gaps are listed in
[catalog operations](../operations/CATALOG.md).

Following audit and expansion, **4 of 14 stages are locally complete**: 0, 1, 3, 5.
Stages 2, 4, 6 and 10 are partial; the rest are planned.
The former “4 of 9” overlooked unfinished account gates and has been corrected.
Social stages 5–9 move the former stages 5–8 to 10–13.

| Stage                          | Status           | Remaining                                                                                                                                                |
| ------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Snapshot                    | Complete         | Archive/recovery checked                                                                                                                                 |
| 1. Foundation                  | Locally complete | PostgreSQL, migrations and backup/restore checked; the full Docker stack is implemented                                                                  |
| 2. Accounts/profiles           | Partial          | New Google/email integrations checked locally; real OAuth credentials, SMTP delivery and sign-in verification needed                                     |
| 3. Catalog/providers           | Locally complete | Catalog/search/jobs/switches checked; 5,901 conflicting mappings need operator decisions                                                                 |
| 4. Website/episodes/player/SEO | Partial          | Episode IDs/routes, timestamps, new progress and HLS implemented; embedded/direct playback verified, profile uploads implemented; public rollout remains |
| 5. Friends/privacy             | Locally complete | Requests, crossed requests, follows, blocks, relationship access, HTTP/SSR and UI checked                                                                |
| 6. Publications/discussions    | Partial          | Posts/reviews/timestamps/replies and title score aggregates work; reports, moderation and revision history remain                                        |
| 7. Messages/notifications      | Planned          | Dialogs, unread counts, delivery/settings                                                                                                                |
| 8. Watch rooms                 | Planned          | Rooms, invitations, sync, chat/reconnect                                                                                                                 |
| 9. Community/votes             | Planned          | Up/down, hot/new/top, feed longevity, badges and abuse controls                                                                                          |
| 10. Administration/moderation  | Partial          | Catalog/users/analytics/subscription administration works; social moderation remains                                                                     |
| 11. Payment preparation        | Incomplete       | Trials, entitlements and promotions implemented; verified payments/webhooks remain                                                                       |
| 12. Infrastructure             | Incomplete       | Production, Cloudflare, distributed limits, backups/load                                                                                                 |
| 13. Cutover                    | Incomplete       | Final migration, domain, Search Console, observation/rollback                                                                                            |

## Audit of previous stages

October 7 audit: builds, types, lint, docs, formatting, audit and PostgreSQL integration passed.
At audit time there were 38 distinct tests. Eight account/profile/library/progress table hashes
matched the earlier backup: four users, 99 library records, six folders, 412 progress records,
11 scores. All 10,415 historical UUIDs/slugs remain. Kodik has 33,256 releases and 9,020 anime;
4,122 legacy cards remain outside the main catalog. Local report: ignored `artifacts/audit/REPORT.ru.md`.

Kodik supplies catalog/playback. YummyAnime is an automatic reserve; viewers cannot choose
providers and `?provider=yummy` is rejected. Only the owner or explicitly delegated account
changes the site-wide reserve with a separate admin MFA session. Player provider names are hidden.
HTTP checks confirmed episodes/embed pages for three titles; video decoding remains unverified.
[Catalog](../operations/CATALOG.md) · [Playback](../operations/PLAYBACK.md).

## Implemented next block: account identity

Added Google Authorization Code + PKCE, browser-bound state, nonce and signed ID-token checks.
Matching email never silently links Google to an existing account; linking requires its session
and current password. Google-only accounts default private and receive no roles.

Email verification, confirmed address changes and password reset/creation use single-use links
with only hashes stored. Email/password changes revoke web/admin sessions; account versions
invalidate old links. SMTP sends mail; local file mode writes ignored `artifacts/dev-mail`
and is forbidden in production. Trusted avatar/banner selection and live header identity work.

`pnpm db:verify`: 26 checks without skips, including concurrent reset, one-time links,
both-audience revocation, Origin/CSRF, PKCE, signed JWTs, wrong issuer/audience/nonce,
expired state, replay and refusal of email auto-linking; backup/restore passed.
Real Google consent and external SMTP delivery need credentials and remain unverified.
[Account configuration](../operations/ACCOUNTS.md).

Final `pnpm check` passed: 41 tests, 19 without a database; all 22 PostgreSQL tests
also pass in `db:verify` (26 checks including shared repeated scenarios).
Formatting, 344 local links and dependency audit passed. The working local migration
followed a backup; prior fields in eight tables and every anime UUID/slug retained their hashes.
Live Next proxy checked options, OAuth cancellation, `no-referrer`, local test-mail
writing and account/library/catalog pages.

## Social plan and next sequence

Implemented the next stage 4 block: permanent episode IDs, SSR episode/timestamp pages, TVEpisode,
sharded sitemap, library resume links, session-bound automatic progress and HTML5/HLS quality/speed with
automatic embed fallback. Migration `20261007113000_episodes_playback` followed a working backup:
eight existing tables and all 10,415 anime UUID/slugs kept their hashes; 412 legacy progress rows are unchanged.
31 PostgreSQL integration checks and backup/restore passed without skips.
Final `pnpm check` passed: 49 tests, 25 without a database; the other 24 passed in `db:verify` (31 including shared cases).
Production build, types, lint, formatting, 353 local links and dependency audit passed.
SSR/canonical without `t`, invalid timestamps/UUIDs, private progress exclusion and empty local episode sitemaps are checked.
The browser opened an actual Frieren episode and copied its `?t=125` link.
On October 7, embedded video decoding was confirmed: 640×360, `readyState=4`,
position advanced from 129 to 147 seconds after seeking to 2:05; the share link tracked playback.
After configuring the private key and restarting, direct HLS was confirmed: 1280×720, `readyState=4`,
starting at 2:05; switching to 854×480 preserved position and 1.5× speed, playback reached 194 seconds.
HLS handler selection was corrected to prefer `hls.js` over browser-native support.
Video was paused afterward. Production trusted-IP verification belongs to infrastructure. [Configuration](../operations/PLAYBACK.md).

User-approved up/down voting raises content with upvotes, extends its visibility and lowers
it with downvotes; time also affects hot ordering. UI uses Reddit-inspired arrows, counters
and badges. Scope includes friends, messages, watch rooms, posts/timestamps, reviews, comments,
scores, hashtags and separate 18+/NSFW/spoiler labels. Content is partly implemented; votes, messages and rooms remain planned;
friendship and privacy now work.

1. Verify real Google/SMTP in a configured environment to complete stage 2.
2. Complete stage 4: implement media uploads.
3. Implement stage 6 (publications/discussions), then stages 7–9 under the [detailed plan](../architecture/SOCIAL_NETWORK_PLAN.md).
4. Complete administration, payments, infrastructure and cutover under the main gates.

## Local limits

Native PostgreSQL 18 uses `artifacts/postgres`, loopback 54329. Docker Desktop previously
failed at `sailor-ingest.sock`; no factory reset or volume deletion was performed.
October 6 mobile build/test checks were not repeated in this block.
Private credentials remain in server `.env`; production/live payments are not enabled.

## Recovery

Open the archive in a separate checkout. Restore databases from protected backups;
after new production writes, returning to an old database needs its own migration/rollback strategy.

## Stage 5 completed locally

Friend requests/accept/decline/cancel/removal, follows, blocks, public-user search, the friends route and profile actions work. Profile/section audiences are public/friends/private. Crossed requests do not duplicate; blocking atomically removes requests, friendship and both follows. Migration 20261007160000_social_relations was applied after backup: old fields in eight tables and all 13,142 current UUIDs/slugs retained hashes. Six new PostgreSQL scenarios pass; db:verify runs 37 checks without skips and restores friendship/follow rows. A production SSR regression checks Unicode profile routes and private metadata/JSON-LD.

Final `pnpm check`: 57 tests, 27 independent of PostgreSQL; the remaining 30 passed separately in `db:verify`. The final website production build and six repeated social PostgreSQL scenarios pass. Browser verification covers search, requests, friendships, follows, blocking/unblocking, owner access to a closed profile and mobile width without horizontal overflow. Temporary accounts were removed; a final comparison confirms the original data is unchanged. [Guide](../operations/FRIENDS.md). Stages 2/4 remain partial and production is unchanged.

## Initial content and 100 demo users

The user explicitly requested realistic fictional activity. The first part of stage 6 now
implements real post/review/timestamp/comment/reply APIs and forms, hashtags, audiences, labels
and server adult filtering. Migration followed backup and preserved original user/library/anime
identities. All 41 PostgreSQL checks pass, including Post/Comment restoration. The working local
DB contains 100 fictional accounts, 499 initial publications, 1,060 comments/replies, 579 friendships,
95 requests, 695 follows and 10 blocks. All 100 unique passwords passed Argon2id verification.
Credentials remain in ignored artifacts/demo-community. Production and real users are unchanged.
Stage 6 remains partial: reports, moderator workflow and revision history are pending. Title scores now aggregate real active-user library votes.

## Catalog restoration — October 8

Dedicated catalog pages now provide extended filters and three random modes. Library actions,
card progress, continue watching, title facts, trailers, screenshots, franchise maps and scored
episode lists are restored. Related seasons resolve active cards by exact external IDs while
retaining historical UUIDs. The 390 px filter drawer has aligned year fields and restores
scrolling on Escape; circular card arrows are removed.

The final `pnpm check` passed builds, types, lint, 35 non-database checks and 419 links.
All 47 `pnpm db:verify` checks passed without skips, including backup/restore; repository
formatting passed. The working database retains 105 users, 13,142 anime, 9,020 published Kodik
titles, 33,256 releases, 1,981 library entries, 499 posts and 1,061 comments.
8,744 titles have source scores; the rest show “—”. Complete legacy application parity remains
unfinished; outstanding functions are listed in [catalog operations](../operations/CATALOG.md).
[Content](../operations/CONTENT.md) · [Demo community](../operations/DEMO_COMMUNITY.md).
