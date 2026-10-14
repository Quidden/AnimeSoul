[English](ACCOUNTS.md) | [Русский](ACCOUNTS.ru.md)

# Accounts and library migration

Stage 2 implements registration, sign-in, private profiles, libraries and separate admin authentication.
PostgreSQL is required; `DEMO_CATALOG=true` still uses a fixture public profile.

## Use

Run `pnpm dev` and open `http://localhost:8021/account`. Register with email, username and a password
of 6–128 characters, or claim an imported profile with an operator-issued code.
Anime pages offer favorites, scores and folder membership. `/library` supports folders, private notes,
season/episode ratings and imported playback positions. `/account` edits identity, about, presence,
publication, indexing consent and section visibility. The header's user button opens `/users/:username`
for the current web session; signed-out visitors go to `/account`. Owners can change avatar and cover
images in the avatar/cover account section; bundled presets remain available. Clicking the owner's
profile avatar opens this section. A small icon beside the name opens profile settings and appears
on hover or keyboard focus (always available on touch screens). The inline profile editor is removed.
Profiles default to private. Owners see their own profile and hidden sections; other visitors cannot access private profiles.
Public `invisible` becomes `offline`. Password changes and logout-all revoke sessions across both audiences.

The signed-in account page has seven sections with a pinned menu: profile, avatar/cover, privacy,
player, security, email/Google and appearance. One section is shown at a time; switching preserves
unsaved form values. Existing section hash links still work. Profile and privacy have separate save
buttons, and session logout controls are in security. The mobile menu stays below the site header.

## Avatar and cover images

JPEG, PNG, WebP and GIF are supported, including animation. Avatars allow 5 MiB, covers 10 MiB;
each frame allows 4096 × 4096, with at most 300 frames and 40 million decoded pixels in total.
Selecting a file shows a preview; its save button uploads it. Preset changes and resets save immediately.
Other profile fields retain their own save button.

The avatar/cover editor includes a combined profile miniature with the cover, avatar, name and status.
It previews both local files and selected GIPHY images before saving. Cancelling a selection restores
the saved image without cancelling the other field's pending file. Settings shortcuts carry an explicit
section query as well as the existing hash, so client navigation selects the requested panel.

`POST /api/account/profile/media/:kind` accepts binary image data.
`POST /api/account/profile/media` accepts `{ kind: "avatar" | "banner", value: preset | null }`.
The web proxy bounds streamed bodies; the API checks the web session, Origin and CSRF before parsing.
The server validates the signature, format and dimensions and decodes every frame. Uploaded SVG,
corrupt images and external URLs are rejected; bundled SVG presets are trusted application assets.
Original bytes are retained to preserve GIF animation.

Files live in `artifacts/profile-media` or `PROFILE_MEDIA_DIR`; PostgreSQL stores their URLs.
Use persistent writable API storage and back it up alongside PostgreSQL. Multiple API instances need
a shared persistent volume. The session owner controls uploads; another user's file cannot be assigned.
Replacement and reset remove the old upload, and a failed database write removes the new upload.
`GET /api/profile-media/:userId/:kind/:filename` serves the current image subject to profile visibility
for guests, friends and the owner, with `nosniff` and no caching. Binary uploads have separate 5/10 MiB
limits; ordinary JSON requests remain limited to 64 KiB.

Both avatar and cover editors also provide a GIPHY picker with a search field (1–50 characters),
initial query `anime`, `pg-13` rating, previews, pagination, retry and attribution. Subsequent pages
keep the submitted query, and a new search clears the previous selection. Set `GIPHY_API_KEY` in `.env`
(the archived `ANIMESOUL_GIPHY_API_KEY` name also works). This is the public **web integration** key:
`GET /api/profile-giphy/config` supplies it at runtime, and browsers call GIPHY directly.
Use a key dedicated to the web profile integration; other credentials never enter this response.
Profiles store `giphy:<ID>`, not a cached GIPHY URL or a downloaded copy. Display resolves the ID
through GIPHY and uses an animated rendition from its HTTPS media hosts unchanged. Removed or
unavailable GIFs fall back to initials/default cover. GIPHY changes use the same session, CSRF,
owner checks and replacement cleanup as presets. Local file validation limits apply to uploads.
[GIPHY API integration and delivery requirements](https://developers.giphy.com/docs/api/).

## Legacy profiles

The archive contains four local profiles without emails or passwords. Import does not invent credentials,
publish profiles or assign roles. Three UUIDs are preserved; the fourth receives a deterministic UUID
with an explicit `LegacyProfile` mapping. Seven favorites, six folders, 412 episode progress records
and 11 title/season/episode scores were transferred. Notes, tracking and safe preferences are retained.
Stream URLs, provider credentials, iframes and remote preference URLs are excluded; the original remains archived.

```sh
pnpm profiles:import C:/Users/dogem/Documents/AnimeSoulArchive/app/data/animesoul-storage.json C:/Users/dogem/Documents/AnimeSoulArchive/app/data/animesoul-anime-identities.json
pnpm account:operator claim <profile-UUID>
```

Reports/codes stay in ignored `artifacts/stage2`. The code expires after 24 hours; reissuing invalidates
the previous code. Use “Перенос профиля” on `/account`, paste the code and choose your own email/password.
The UUID/library remain unchanged. PostgreSQL stores only the code hash, removed atomically on claim.
Expired, reused and already-claimed codes are rejected.
Repeated import skips unchanged profiles without overwriting subsequent edits. Changed source profiles
require an explicitly reviewed merge. Unknown legacy anime retain exact YummyAnime IDs as unpublished metadata records.
Kodik supplies catalog updates; enrichment requires a confirmed exact material identity.
Unmatched records await review, retaining internal UUIDs and library references.

## Sessions and security

Native Argon2id requires Node.js 24.7+: 64 MiB, three passes, one lane, unique 16-byte salts.
Sessions use random 32-byte tokens, SHA256 hashes in PostgreSQL and host-only HttpOnly cookies;
production adds Secure. Web sessions last seven days. Admin sessions last one hour by default, or
30 days from login when “Не выходить 30 дней” is selected. Distinct cookie names
and server audiences prevent moving a web session into admin by renaming the cookie.
Mutations require exact Origin, `X-AnimeSoul-Request: 1` and a session-bound CSRF token.
For a loopback `SITE_URL` or `ADMIN_URL`, `localhost`, `127.0.0.1` and `[::1]` are accepted
only with the configured scheme and port. Public origins remain exact; preview ports do not gain access.
Cookies remain host-only, so switching local hostnames requires signing in on that hostname.
Registration/login/claim require Origin and the custom header before authentication.
Web password login returns a specific failure code for a missing account, wrong password,
blocked account (after a correct password), Google-only account or missing password. The form
maps these codes to fixed messages; admin login keeps its generic credentials error.
Every login attempt still passes Origin checks, throttling and password hashing, including missing accounts.
Next proxies only an allowlist of paths and bounds request streams to 64 KiB.
PostgreSQL limits authentication attempts to 10 per identity and 60 per actual API connection IP
per ten minutes. Argon2 concurrency is bounded to four per process. Forwarded headers are untrusted;
Next requests share a local IP until stage 12 configures trusted proxies and distributed protection.

## Email verification and recovery

`MAIL_MODE=file` writes local test mail to ignored `artifacts/dev-mail`; it does not send
to the recipient. This mode requires a non-production environment and loopback `SITE_URL`.
`pnpm setup` adds it to an existing local `.env` when absent. `MAIL_MODE=disabled` hides
email actions; `MAIL_MODE=smtp` sends through the configured server.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` and optional
`SMTP_USER`/`SMTP_PASSWORD`. Typically 465 uses `SMTP_SECURE=true`; 587 uses `false`
with mandatory STARTTLS. Keep credentials in private `.env`. Real delivery must be
verified in a configured environment; local integrations inject test delivery.

After registration, choose email verification. Its link lasts 24 hours; reissuing replaces
the old link. Address changes require the current password and take effect only after
confirmation at the new address. Reset/password creation requires a verified address
on an active account. Reset requests return the same response for present/absent emails.
Change/reset links last 30 minutes and can be used once.

Tokens travel in the URL fragment, which the page clears before explicit confirmation.
PostgreSQL stores only SHA256. Email/password changes revoke all web/admin sessions;
`authVersion` invalidates older links. Google-only users first create a password through
verified email before email changes, MFA or admin sign-in.

## Google

Create a Web application OAuth client in Google Console. Set private `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `MFA_ENCRYPTION_KEY`. The authorized redirect URI must exactly
match `SITE_URL` plus `/api/auth/google/callback`: locally
`http://localhost:8021/api/auth/google/callback`, production uses your HTTPS website.
Restart the application. Without configuration, the Google button is hidden.

Sign-in creates a private account without password/roles or opens an already linked account.
A matching existing email never auto-links Google. Sign in with the existing password and
explicitly link Google after password confirmation. Linking binds the same browser and
active web session and revokes other sessions. Google does not replace separate admin
password, role and MFA checks.

Checks cover one-time state, browser cookie, S256 PKCE, nonce, RS256 signature, issuer,
audience, time claims and verified Google email. Access/refresh tokens are not persisted.
Integrations use cryptographically signed test responses; real Google consent requires
configured credentials and separate verification before release.
[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) ·
[Web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) ·
[SMTP transport](https://nodemailer.com/smtp).

## Admin access

`pnpm setup` creates a private 32-byte hex `MFA_ENCRYPTION_KEY`. Back it up with the database.
TOTP secrets use AES-256-GCM bound to the user UUID. Confirm your password on `/account`, add the
provided secret to an authenticator and confirm a code. Eight recovery codes are displayed once
and stored hashed; each can be consumed once. TOTP uses SHA1, six digits, 30 seconds and ±1 window.
Atomic counter comparison rejects replay, including reuse of the setup confirmation code.

Owner bootstrap is an explicit local command for an already registered/claimed account:

```sh
pnpm account:operator owner <user-UUID|email|username> "Reason for explicit owner assignment"
```

It writes an audit record; the first registrant receives no administrative role.
Admin sign-in at `http://localhost:8022` requires owner/admin role, password and a new TOTP or recovery code. If MFA is not enabled yet, sign in on the site, open Security, confirm the password, add the displayed secret to Aegis/Google Authenticator and enter the generated six-digit code. This code is not emailed.
Production requires separate HTTPS `SITE_URL` and `ADMIN_URL` hosts.
User management, analytics, subscriptions and catalog operations are described in [Administration](ADMINISTRATION.md); social moderation remains a separate milestone.

## Verification and remaining boundaries

`pnpm check`, `pnpm format:check`, `pnpm db:verify` cover builds, DTOs, owner isolation, private responses,
Origin/CSRF, revoked/expired sessions, MFA/replay/recovery, repeatable migration and account/library restoration.
`tests/identity.test.mjs` also checks Google/email, one-time/concurrent reset, both-audience
revocation, refusal of email auto-linking and safe presets. Real external Google/SMTP checks,
distributed infrastructure remain pending. Uploaded media is covered by `tests/profile-media.test.mjs`
and `tests/profile-media-web.test.mjs`; GIPHY contracts and client requests by `tests/profile-giphy.test.mjs`.
Stage 4 implements automatic
position persistence from embeds and the custom HLS player.
Public production release requires later stages.

## Friends and visibility

Stage 5 adds friendship, subscriptions and blocks. `/account` selects an audience for the whole
profile and each section: everyone, friends or the owner. Existing boolean preferences remain
compatible; new sections default to private. Indexing requires a public profile and separate consent.
Comment history on a profile and the comment under an anime have separate visibility rules.
Posts, reviews and comments work in the first part of stage 6; section preferences are enforced.
[Behavior, limits and API](FRIENDS.md).

[Stage status](../migration/STATUS.md) · [Data model](../architecture/DATA_MODEL.md) · [Playback](PLAYBACK.md).
