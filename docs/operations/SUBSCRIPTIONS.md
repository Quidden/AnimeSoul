[English](SUBSCRIPTIONS.md) | [Русский](SUBSCRIPTIONS.ru.md)

# Subscriptions and player access

Billing is disabled. `/subscription` and the player preview show real interface screenshots and plans. Prices start unset and are editable in the MFA-protected admin with UAH/USD/EUR currencies. Selecting a plan does not create an order, payment or paid access.

Both previews include six full-frame screenshots with an accessible enlargement dialog and an
interactive native-player demo. Its single original public clip has 720p/360p versions and two
chapter jumps. It starts only on click and repeats by default; playback/continuation preferences
and quality/speed controls work in the demo. Resume is stored in a separate local browser key,
never in account watch history. Demo playback does not issue or bypass account entitlements.

New email/Google registrations atomically receive one seven-day `SubscriptionTrial`. Login, linking an existing account and importing legacy accounts do not reset it. Native playback requires an active trial, an unrevoked/unexpired `Entitlement(permission=player.native)`, an explicit `UserPermission`, or an owner/admin role (`source=staff`). Manual admin grants are dated, audited and serialized per user; revocation also closes the trial and explicit permission. Staff role access remains until that role is removed or the account is disabled.

Owners and admins have a DEV selector in the site header: their real role, guest, signed-in user without a subscription, trial, or subscriber. `GET/POST /api/auth/developer-access` reads/changes the current web session's `developerAccessMode`; writes require the real staff role, origin and CSRF and are audited. Guest mode disables account features, but the selector can restore the real role using the original session. Other modes hide staff roles/permissions from the site's account response. Real roles, MFA admin sessions, other devices and billing records stay unchanged. The server rechecks the current mode before returning direct file URLs, including requests already in progress. These simulated trial/subscriber rights end with the session. Regular and demoted users cannot use the selector or gain access from a stale mode.

`GET /api/subscription` validates the web session and returns private, uncached state. Direct stream resolution checks access before contacting the provider and again before returning files. The browser refreshes on account changes, focus and every minute, and schedules access expiry. Already-issued provider file URLs remain valid until their provider expiry.

Guests default to Kodik. Authorized viewers default to AnimeSoul when a direct file is available, falling back to the embed otherwise. Explicit Kodik selection persists within the browser session, including franchise navigation. Engine changes preserve position and cancel stale stream requests. A locked AnimeSoul button opens an accessible benefits/plan preview and pauses the embedded player.

Kodik resume retries lost seek commands, keeps unconfirmed jumps out of watch time, and offers retry after twelve seconds of unconfirmed playback events. Progress can continue after failure. Only messages from the current iframe and its exact origin are accepted. Seek and paused-time snapshots update the saved position; episode, season and translation events match the manifest. Unknown selections stop progress reporting and return to the known selection without a reload loop. Completion uses existing franchise navigation. Engine changes preserve pause state; continuation autoplay respects user preferences and browser restrictions.

An expired, unrevoked trial enables 50% off the first monthly plan. `discountRedeemedAt` is reserved for consumption by a future verified payment transaction; no public redemption/grant endpoint exists. General admin promotions select eligible plan durations and start/end dates. Discounts do not stack; the highest active discount wins, rounded in minor currency units. Admin changes require owner/admin, MFA, origin, CSRF and an audit reason. Delegated provider management does not grant billing management.

Admin routes: `GET /api/admin/subscriptions`, `POST .../plan`, `POST .../promotion`, `GET .../access?username=...`, `POST .../access`. Before connecting billing, implement verified orders/webhooks and atomic, idempotent discount consumption and entitlement issuance/revocation. No automatic charging or renewal runs now.

Migration `20261009113000_subscriptions` adds plans, promotions and trials without granting existing accounts access. `20261010210000_developer_access` adds the session mode with an `actual` default. `tests/subscriptions.test.mjs` covers trials, expiry, permissions, concurrent grants, revocation, guest direct requests, admin CSRF/MFA and quote calculation. `tests/developer-access.test.mjs` covers staff access, all simulated modes, guest restoration, role preservation, independent sessions, demotion, logout, origin/CSRF and mode changes during stream loading. `tests/subscriptions-web.test.mjs` verifies viewer cookies, developer mode writes, uncached rights/stream responses and revocation through the web proxy. Quotes consider active offers even when more than 100 newer records exist.

[Playback](PLAYBACK.md) · [Accounts](ACCOUNTS.md)
