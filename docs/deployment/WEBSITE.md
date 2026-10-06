[English](WEBSITE.md) | [Русский](WEBSITE.ru.md)

# Hosted accounts and deployment

`ANIMESOUL_RUNTIME=website` enables a separate multi-user runtime. The default
`local` runtime retains Windows/Android saves and integrations. A website
account is distinct from the portable profiles inside its personal library.

## What is implemented

- The home page, catalog, anime pages and provider players are public. The
  header opens sign-in on demand. Guest browser caches are separate from account
  caches; guests never request account saves.
- Email/password registration, login, logout, email verification, password reset,
  username changes, password changes and confirmed email changes.
- Google authorization-code login with PKCE, a browser-bound one-time state,
  nonce and the official Google ID-token verifier. Identity uses Google `sub`.
  Existing email/password accounts require explicit Google linking after login;
  matching email addresses never silently merge accounts.
- `/account` opens the glass profile page; `/account/settings` retains credential
  and access settings. `/users/{database-user-id}` is the public profile link.
  All registered users can select static or animated first-party presets.
  Premium and above can upload PNG/JPEG/GIF/WebP up to 1 MiB, use direct HTTPS
  image URLs or choose GIFs. About text, presence and visibility are saved in the database.
  Admin/premium/custom badges derive from assigned roles and expose CSS hooks
  for future frames and animations; users cannot grant themselves badges.
- Each section (about, favorites, collections, personal ratings, statistics)
  has independent visibility. Library sections start private. Public responses
  omit hidden sections, email, credentials, permissions, folder notes and raw
  playback history. The owner can preview the same filtered public response.
  Content comes from the active library save profile. Presence choices persist:
  online, offline, do not disturb and invisible. Invisible always appears offline;
  online/do not disturb expire publicly after 180 seconds without a visible-tab
  heartbeat. The compact identity fades into the sticky site header on scroll.
- `/admin` provides user search, role assignments, custom role creation/editing,
  permission configuration and an audit log. The built-in player role grants
  `player.use`; the download role grants `downloads.use`; premium grants
  `profile.customize`. `admin.users` and
  `admin.roles` delegate administration. Only the
  owner may grant management permissions; protected roles cannot be edited.
- PostgreSQL tables store users, Google identities, hashed sessions, roles,
  tokens, audit events, save envelopes, profiles and individual save items.
  Favorites, folders, tracking, progress and ratings occupy separate rows.
  JSON columns retain extensible item fields without creating save files.
- Saves use per-account ownership and an optimistic revision. Conflicting tabs
  receive HTTP 409 and must reload. Client writes are serialized. Browser caches
  are account-scoped and never automatically imported into a fresh account.

The configured owner email is `dogemmoze@gmail.com` in the deployment example.
Owner bootstrap occurs once, only after that mailbox is verified by an email
link or Google. Changing the owner's email later does not transfer ownership.
Registration order does not grant privileges.

Profile APIs: GET `/api/profiles/me` (owner), GET `/api/profiles/{id}` (public),
PATCH `/api/auth/profile` (partial changes including a partial `visibility` map),
POST `/api/profiles/presence` (heartbeat). Owner mutations use the existing
session/account/CSRF checks. Run `alembic upgrade head` to apply
`0002_user_profiles` before starting an existing website database.

GET `/api/profiles/media-options` returns the preset library and customization
entitlement. Every media change checks current `profile.customize` or administration
permissions on the server; role names cannot grant access. Administrators can
assign the built-in premium role or include this permission in higher roles.

Set `ANIMESOUL_GIPHY_API_KEY` in the server environment to enable the embedded
[GIPHY search](https://developers.giphy.com/docs/api/). This public web API key
is sent to the browser. Requests go directly to GIPHY, without proxying or caching.
Selections persist only `giphy:ID`; displays resolve the current rendition by ID.
The picker includes official Powered by GIPHY attribution. Presets and custom
uploads still work when a key is absent.

## Deployment

Install Docker with Compose on the deployment host. The host needs a domain
pointing to it and reachable ports 80/443. The database and backend have no
published ports.

1. Copy [`../deploy/.env.example`](../../app/deploy/.env.example) to `app/deploy/.env`.
2. Set the domain and exact HTTPS origin, a long random database password and
   matching database URL. URL-encode password characters in the URL.
3. Configure Google and SMTP as described below. Configure provider keys only
   in server environment variables.
4. From `app/deploy`, run `docker compose up --build -d`. Compose waits for
   PostgreSQL, applies Alembic migrations and starts the backend behind Caddy.
   Caddy obtains HTTPS certificates automatically.
5. Register or sign in with the configured owner email and confirm it. Open
   `/account` → administration to grant the player role and create other roles.

[`../deploy/compose.yaml`](../../app/deploy/compose.yaml) includes persistent PostgreSQL
and cache volumes. [`../deploy/Dockerfile`](../../app/deploy/Dockerfile) builds the UI
without source maps and runs the application as a non-root user with a read-only
root filesystem. Database migrations run as a separate one-shot service.

Do not expose the backend port directly: Uvicorn trusts forwarded IP/scheme
headers from the private reverse-proxy network. Before deploying multiple web
workers, confirm provider account limitations and server-side caching behavior.

## Local preview

From `app`, run `python -m tools.website_preview --live-catalog --provider-env deploy/.env`.
The website at `http://localhost:8013` uses the real catalogue and player with
the YummyAnime/Kodik keys from that file. Only provider credentials are imported;
production database, origin, SMTP and Google settings are excluded. Preview
accounts and saves are temporary; email and OAuth remain disabled.

Without `--live-catalog`, this is an isolated UI preview: `--profile-demo` adds
eight mock cards, with no anime playback. GET `/api/health` reports
`catalog: "live"` or `"demo"`. Restart the server after changing keys.
The regular backend reads `app/backend/.env` and `app/.env`; Docker Compose
loads `app/deploy/.env` automatically, while this local preview reads it only
with an explicit `--provider-env` argument.

## Google setup

Create a Google OAuth web application and set its authorized redirect URI to:

```text
https://YOUR_DOMAIN/api/auth/google/callback
```

Set `ANIMESOUL_AUTH_GOOGLE_CLIENT_ID` and
`ANIMESOUL_AUTH_GOOGLE_CLIENT_SECRET`. Configure the OAuth consent screen and
test users/public availability in Google Cloud. These credentials are separate
from the desktop Google Drive OAuth client. Only `openid email profile` scopes
are requested; Google tokens are not retained.

See Google's [OpenID Connect server-flow documentation](https://developers.google.com/identity/openid-connect/openid-connect).

## Mail and providers

Set `ANIMESOUL_SMTP_HOST`, `ANIMESOUL_SMTP_PORT`, `ANIMESOUL_SMTP_FROM` and, if
required, SMTP user/password. Port 587 uses STARTTLS; port 465 uses TLS from the
start. Production requires TLS. The sender address/domain must be authorized by
the provider. Email registration stays disabled until SMTP is configured;
Google login can work independently. Verification/email-change links expire
after one hour; password-reset links after 30 minutes. Tokens appear in a URL
fragment, are consumed once, and are stored only as hashes.

The catalog reads `YUMMYANIME_TOKEN`. Server playback reads
`ANIMESOUL_KODIK_PUBLIC_KEY` and `ANIMESOUL_KODIK_PRIVATE_KEY`. Keys are not
returned to the client and cannot be changed through the public website API.
Provider iframe playback remains available; `player.use` controls the AnimeSoul
direct-stream endpoint and custom player, including manual API requests. Revoking
access prevents future stream resolutions; already issued external media URLs
remain subject to the provider's expiry.

`downloads.use` separately protects POST `/api/kodik/download`. Assign the built-in
player and download roles, or create a role with both permissions for future
subscriptions. Billing and subscription expiry are not implemented. Access
requires an active session and verified email.

Downloads on anime pages save selected episodes on the user's device without a
shared server offline library. Browsers supporting a folder picker write files
as a stream. Other browsers use file downloads with a 1 GB buffer limit per
episode and may require permission for multiple downloads. Direct video and fMP4
save as MP4; ordinary HLS saves as TS, playable in compatible media players.
VOD playlists, byte ranges and AES-128 are supported; separate audio tracks and
other encryption formats need another source. The external provider must allow
browser requests through CORS. Live provider compatibility still needs testing
with working credentials. Signing out or switching accounts cancels active
downloads. Every new link resolution checks current permissions; previously
issued links expire at the provider.

## Security boundary

Passwords use Argon2id. Sessions are opaque, hashed in PostgreSQL, expire after
seven days and rotate after authentication. Production cookies use `Secure`,
host prefixes, `HttpOnly` for the session and `SameSite`. Sensitive changes
require the current password; Google-only accounts require a login from the
last five minutes. Password changes/reset and confirmed email changes revoke
existing sessions. Every signed-in mutation checks the account ID, exact Origin
and session-bound CSRF token. Rate limits live in the database and span workers.

The website uses an explicit API allowlist, trusted Host validation, body-size
limits, CSP, anti-framing, no-sniff, referrer policy and HSTS. Desktop endpoints
for filesystem/offline-library management, LAN, Discord, Google Drive, provider credential changes and
Watch Party are unavailable. Matching UI sections are hidden. Anonymous aggregate
ratings remain readable; website personal ratings are saved to the account,
without publishing anonymous desktop votes.

This implementation still needs real Google/SMTP credentials, DNS/TLS and a
deployment-host smoke test. No live Google exchange, real mail delivery, Docker
build or PostgreSQL service was exercised by the local Windows checks. A
dedicated CI job runs the account contracts against PostgreSQL.

Server dependencies are pinned in `requirements-server.txt` and
`requirements-website.txt`; CI audits them with `pip-audit`. To repeat the check
from `app`, install `pip-audit` and run
`python -m pip_audit -r backend/requirements-website.txt`. Audit frontend runtime
dependencies with `npm audit --omit=dev` from `app/frontend`.

## Local testing with the server stack

Use the same [`../deploy/compose.yaml`](../../app/deploy/compose.yaml) and Dockerfile as
the deployed host: PostgreSQL 17, Alembic, the application and Caddy. Install
Docker Desktop with Linux containers. Copy
[`../deploy/.env.local.example`](../../app/deploy/.env.local.example) to `app/deploy/.env`
if the file does not exist. Set a random database password in both settings and
add provider, Google and SMTP credentials. `app/.env` remains the configuration
for Python running on the host; Docker Compose reads `app/deploy/.env`. Actual
secret files are excluded from Git and the Docker build context.

Local settings:

```dotenv
ANIMESOUL_DOMAIN=localhost
ANIMESOUL_PUBLIC_ORIGIN=https://localhost
ANIMESOUL_WEBSITE_DEVELOPMENT=0
ANIMESOUL_BIND_ADDRESS=127.0.0.1
ANIMESOUL_DATABASE_URL=postgresql+psycopg://animesoul:DATABASE_PASSWORD@db:5432/animesoul
```

`db` is the Docker service hostname. PostgreSQL and the application expose no
ports; Caddy accepts connections only from this PC. Production Secure cookies,
CSRF and HTTPS remain enabled. SQLite and development mode are not used.
`-p animesoul-local` separates the containers and persistent volumes of this
local stack. Account and save data remain in the PostgreSQL volume after shutdown.

```powershell
# Working directory: app/deploy. Configure .env first.
docker compose -p animesoul-local up --build -d
```

Compose waits for PostgreSQL and applies migrations before starting the app.
Caddy creates a local certificate authority for `localhost`. After startup,
copy its public root certificate and trust it in the current Windows user's
root certificate store so the browser can verify HTTPS:

```powershell
New-Item -ItemType Directory -Force ../.website-local | Out-Null
docker compose -p animesoul-local cp gateway:/data/caddy/pki/authorities/local/root.crt ../.website-local/caddy-local-root.crt
Import-Certificate -FilePath ../.website-local/caddy-local-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Open `https://localhost`. Keep the exact configured origin rather than replacing
`localhost` with an IP. Importing this certificate trusts the local Caddy CA for
the current user. The private key stays in the Caddy volume; only the public
certificate is copied. If that volume is removed, install the new certificate.
See [Caddy Local HTTPS](https://caddyserver.com/docs/automatic-https#local-https).

Email registration is disabled without SMTP, and Google login is unavailable
without Google credentials. For a Google OAuth client of type Web application,
add the exact redirect URI `https://localhost/api/auth/google/callback` and
include your email in test users when the Google app is in Testing mode. Google
login works independently of SMTP. Owner email is `dogemmoze@gmail.com`; privileges
are granted only after verification.

Stop with `docker compose -p animesoul-local stop`, then restart with
`docker compose -p animesoul-local up -d`. Avoid `down -v` if you want to preserve
accounts and saves. Before deploying on a server, change the origin, domain,
port bind address and credentials using the production env example; transfer
data with a PostgreSQL backup.

## Checks

From `app`, install `backend/requirements-website.txt` in the project's venv.
For Python running outside Docker, process environment variables take precedence
over env files. The older `app/backend/.env` takes precedence over `app/.env` if
both exist.

Set `ANIMESOUL_TEST_DATABASE_URL` to an isolated PostgreSQL test database to run
the same contracts there. Each test creates and removes a unique temporary
schema; it does not touch existing account tables. Run account contracts with
`python -m unittest discover -s backend/website_tests -v`. The standard local
backend suite remains `python -m unittest discover -s backend/tests -v`.

## Operations

Back up PostgreSQL regularly and test restoration. Back up before schema
upgrades; do not remove the Compose volumes during routine updates. Provider
caches in the runtime volume are not the account save database. Rotate OAuth,
SMTP and provider credentials in the server environment and recreate the web
container. Protect database backups, environment files and administrator email
access. Owner recovery currently requires trusted database/operator access;
ownership cannot be reassigned from the public administration UI.
