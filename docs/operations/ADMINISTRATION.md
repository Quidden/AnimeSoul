# Administration

Local URL: `http://localhost:8022`. The panel reuses administrative cookies, `owner`/`admin`,
mandatory MFA, Origin/CSRF and live authorization. First-owner/MFA setup is documented in
[Accounts](ACCOUNTS.md). Payments remain disabled. HTML with status 200 is not administrative access.

The login checkbox “Не выходить 30 дней” keeps an administrative session for 30 days from login,
including browser restarts. Without it the lifetime remains one hour. New logins still require MFA.
Logout, password changes and blocking revoke saved access; the server checks permissions on every request.

## Interface and operations

One nested sidebar links overview, analytics, users, subscriptions, messages, catalog, appearance
and system. Group collapse, compact navigation, dark/light/system theme and user-table settings
persist locally. Mobile navigation opens with a button; wide tables scroll within their containers.

User search/filtering/sorting/pagination runs on the backend, including name/email/ID, roles,
existing permissions, plans/access state, registration/activity dates and launches in a selected
month. Columns are configurable and filters can be reset. Details show effective rights, related
counts, access history, 30-day activity and links to personal analytics/journal/technical errors.

Only an owner changes administrative roles and permanent permissions of other accounts. An admin
cannot edit administrative-account security. Self changes/elevation are rejected, and at least
one enabled owner/admin is preserved. Blocking uses existing `disabledAt`, revokes sessions and
keeps data. Unchanged permissions are not reissued during a profile edit. Bulk blocking/unblocking
is limited to 50 accounts and requires a reason/confirmation. Version conflicts require review;
repeating the same operation ID and payload is idempotent, while changed payloads are rejected.

## Analytics rules

The normalized `AnalyticsEvent` table collects new observations; past visits/playback are not
invented. The rollout date is visible. Existing registrations and safe user audits remain usable.

- Pageviews record route categories, excluding private URLs/search text/query parameters; rerenders
  and refreshes of the same route are suppressed.
- A visit rotates after 30 minutes of inactivity. Unique visitors are hashed browser identifiers,
  not necessarily unique people.
- DAU/WAU/MAU count authenticated accounts with site events or existing user actions in the 1/7/30
  days ending at the period boundary. Admin sign-in is excluded.
- Playback starts require successful playback, not page opening or playback-session creation.
  Stored fields include user where available, anime, episode/season where available and actual
  native/Kodik/Yummy source. Retries reuse the event ID; pause, quality/dub/player changes and
  reconnection do not count the same episode twice within a visit.
- Features include successful text/frame search, GIF selection and already audited profile/social/
  community actions. Unmeasured functions are not represented as measured.
- trace.moe quota history stores verified server responses without IP/keys. Each bucket uses its
  latest observation; missing observations remain unknown rather than fabricated zeros.

Periods include today/7/30/90/custom up to 366 days; grouping is daily/weekly/monthly in Kyiv/UTC,
with previous-period comparison, series controls, exact values and CSV. User/anime ID filters are
available. Plan/access distribution is current inventory, without fabricated subscription history.
CSV includes individual feature counts and quota observations. Best-effort telemetry cannot block
playback and is not financial accounting or proof of a human view.

## Plans, content and winter

The existing plan/promotion/trial/entitlement models are extended with descriptions, prices/currency,
duration, ordering, availability and plan eligibility. `player.native` is the only implemented paid
privilege; an enabled plan must include it. No per-user playback limits are invented. Existing media,
diagnostic and frame-search limits are shown in System. New manual grants retain plan/price/currency
snapshots and prior grants. Plan edits do not rewrite orders/snapshots. Revocation stops grants,
permanent native permission and remaining trial. Existing seven-day trial and 50% first-month rule
remain; promotions do not stack.

Global announcements, anime announcements and inbox campaigns are separate. Forms support type,
audience, publication window, preview and disabling. Audiences use existing authentication, roles
or plans; inbox campaigns may target one user. Read/dismiss receipts are individual and access is
rechecked server-side. Anime scope uses the selected season or actual saved franchise graph;
title similarity is never used. Global banners are not duplicated inside anime content. Open pages
refresh publication changes within a minute; expired banners hide locally and account changes reload
audience data.

Winter supports off/manual/scheduled modes, snow intensity/speed, garlands and light/dark preview.
Manual mode overrides schedules; typed `SiteSetting` configuration is refreshed about once a minute.
One canvas has at most 80 desktop or 32 mobile particles at up to 30 fps plus 16 lights; it respects
visibility/reduced motion, does not intercept pointers and provides a locally persisted opt-out.

## Templates and site maintenance

The template library supports notifications, global/anime announcements, plans, promotions,
winter and maintenance configurations. Create/save, copy/edit/save, pin/unpin and publish/apply
from the same server-filtered, 25-row paginated list (up to 1000 presets). Existing forms can save
current values as a template. Editing a preset does not alter a previously published message.
Publication creates a new message/promotion; applying a configuration updates its existing resource.
Preview, confirmation, publication windows, optimistic versions and idempotent operation IDs apply.
Templates reuse typed `SiteSetting` records keyed `template.<UUID>` and existing transactional writers.
Account credentials, arbitrary commands and per-account role/blocking changes are outside presets.

System → Maintenance closes public pages and API using a configurable, responsive dedicated page
(`/maintenance`) with HTTP 503, `Retry-After: 60`, no-store/noindex. Administrator access/login and
health/ready/availability remain available. Plain text is HTML-escaped. An optional end date
actually reopens the site automatically; the server configuration cache lasts at most 500 ms.
An already open page updates on its next request/refresh. Static assets remain accessible and
issued external media URLs are not revoked by maintenance. Backend outages return a safe 503 page.
Configuration reuses `availability.maintenance` in `SiteSetting`; no extra migration is needed.
Maintenance review is isolated to the test database, never the user's main local site.

Protected endpoints also include maintenance, templates/list/detail/preview/copy/publish;
public `/api/availability` exposes only active state and public text/end date.

## Endpoints, security and verification

Protected `/api/admin/platform` resources: users/detail/access/bulk, journal, analytics,
announcements, notifications, winter, global search and system; CSV endpoints are `users.csv`,
`journal.csv`, `analytics.csv`. Existing `/api/admin/subscriptions` serves plans/promotions.
Public `/api/experience` returns only eligible messages/winter; event ingestion is validated;
inbox uses the existing web session. Frontend never accesses the DB directly.

Mutations recheck privileges inside a transaction and use a common PostgreSQL advisory lock,
optimistic version, operation ID and safe audit. CSV is capped at 10,000 rows, formula-safe,
protected and audited. Admin/inbox responses are not cached and admin pages are noindex.
Technical failures use [existing diagnostics](DIAGNOSTICS.md) separately from administrative audit.

Sources: [contracts](../../packages/contracts/src/administration.ts),
[controller](../../apps/api/src/admin/platform.controller.ts),
[analytics SQL](../../apps/api/src/admin/analytics.service.ts),
[shared native access lifecycle](../../apps/api/src/subscriptions/native-access.ts).
`node --env-file=.env scripts/workspace/test-admin-local.mjs` runs all tests on guarded local
`animesoul_test`. `verify-admin-schema.mjs` is a read-only comparison. Additive migrations
`20261010003000_admin_platform` and `20261010005000_admin_metrics`, `20261010006000_admin_episode_number` are applied to local main/test.

## Remaining boundaries

No billing or new subscription privileges. Old grants may lack issue date/plan/price, which remain
unknown. Provider configuration is not continuous external uptime monitoring. The existing franchise
resolver retains its bounds (50,000 published graph records/256 parts) and minute cache. Long-term
analytics retention/rollups and centralized multi-server diagnostic storage require separate design.
Existing social-table and SubscriptionTrial foreign keys differ from Prisma in ON UPDATE behavior;
new administration tables are aligned and this work does not change those old relationships.
