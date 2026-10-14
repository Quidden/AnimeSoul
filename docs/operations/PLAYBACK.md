[English](PLAYBACK.md) | [Русский](PLAYBACK.ru.md)

# Catalog and playback in the new website

Kodik supplies the primary catalog and playback. YummyAnime is an optional, disableable playback reserve.
PostgreSQL owns the catalog; disabling playback providers does not remove title pages.
Credentials live in private `.env`; public responses contain only validated playback DTOs.

## Local startup

```sh
pnpm dev
```

`LOCAL_POSTGRES=true` starts an isolated native cluster in `artifacts/postgres` on
`127.0.0.1:54329` first. It does not manage the Windows PostgreSQL service.
It requires installed PostgreSQL binaries: `POSTGRES_BIN` selects the `bin` directory,
defaulting to `C:/Program Files/PostgreSQL/18/bin`. Docker compose remains an alternative.
`pnpm db:local stop` stops only this cluster and preserves its data.

Initial provider configuration is an operator terminal task:

```sh
pnpm providers:credentials "C:/Users/dogem/Documents/AnimeSoulArchive/app/animesoul.python.json"
```

This imports only Kodik and YummyAnime playback tokens, preserves existing credentials and
does not enable providers automatically. Direct Kodik HLS private keys are not imported;
the custom player is configured separately below. Explicitly set `ALLOW_YUMMY=true` and/or `ALLOW_KODIK=true`:

```sh
pnpm db:migrate
pnpm build
pnpm providers:switch yummy enable "Local playback verification"
pnpm providers:switch kodik enable "Local playback verification"
pnpm catalog:import --pages=3
pnpm catalog:sync
```

Manual Kodik import supports 1–20 pages of 100 releases. catalog:sync starts the full traversal.
Existing UUIDs and slugs remain unchanged. New UUIDs are deterministic from the original
provider mapping; public slugs belong to AnimeSoul. Conflicting secondary IDs are reported
instead of overwriting existing mappings. This imports metadata, not accounts.

Open a catalog title, select an episode, translation/source, and press Play.
Side preview cards select the previous/next episode, with browser-local last episode selection.
Libraries and existing account history are migrated; new timestamps save automatically to the account.

## Franchise parts and the anime page

Every part keeps the connected franchise list available: real titles, formats and years,
with episodes for the selected title beside it. Catalog and search links select the opened
title. Changing parts updates `/anime/:slug`, poster, description, ratings and discussions
together. The player exposes the same choice, including fullscreen. Provider seasons remain
local to the current `animeId`. Direct episode links override saved selection. Completed
episodes are marked, while partially watched episodes show personal progress.

`GET /api/anime/:slug/franchise` follows saved direct, reverse and transitive UUID and
Shikimori/Kodik identity links, replacing legacy duplicates. Directed relationships from
Shikimori's public `/franchise` endpoint are cached for one day and used by the interactive
graph. Source failures preserve cached data; missing relationships are never invented.
Published parts are ordered by premiere, year and title. Films, OVA and crossovers receive
no invented season numbers. Limits are 256 parts and 20,000 registered episodes; overflow
fails explicitly. The current episode list refreshes after loading available playback.
Membership depends on relationships saved in the catalog.

The layout follows the latest archive: poster on the left, description before facts,
compact trailer and ratings on the right. Below the player, parts sit beside episodes;
mobile parts scroll horizontally.

Docked navigation and the header use one `site-navigation-glass` surface, with shared
translucent `--navigation-bg` and blur, preventing a seam between separate blur samples.
Before docking, navigation has no background or border. The graph's dotted board continues
behind both glass surfaces.
The same navigation stays available on the franchise and community pages, with links
back to the title's sections; both pages attach it directly below the header. The franchise is a full-viewport board with pan, wheel/button
zoom and a pinned legend. Format sliders start enabled; selecting a legend category or a
node label frames and highlights that group, while selecting a point highlights only its
immediate connections. Other visible nodes and edges fade. Hidden formats remove their
edges, and camera transitions respect reduced motion. Screenshots center when they fit,
otherwise scroll as a carousel with arrows. Screenshots above the player open in an
animated modal viewer, and YouTube trailers embed directly. Posts, reviews and discussions
of the title, its episodes and publications are collected at `/anime/:slug/community`.
Colored format switches start enabled and are hidden for franchises with only one format.
Compact episode cards show watched status and remaining time. Only confirmed title premieres
and next-episode dates are shown; individual episode dates are not inferred.
Poster colors are sampled through Next's image optimizer and saved in browser-local
storage, softly complementing the selected theme across pages until another poster is
opened. Animations respect reduced-motion preferences.

## Episodes, timestamps and custom playback

The central player occupies 90% of the viewing area, with neighboring episode previews at its sides.
Previews are smaller 16:9 frames centered beside and underneath the central player; their visible outer strips are clickable.
The top-left menu selects the franchise part, season, episode and dubbing. It also works in fullscreen;
additional playback options remain in the settings menu.
The current player remains visible while the destination route loads. Only after the route commits,
the destination runs one continuous 480 ms swap: the incoming frame grows from the selected side,
while an outgoing screenshot shrinks toward the opposite side. Routing and stream loading do not
pause the animation midway. A prepared episode list initializes before paint, and a screenshot
covers video preparation. Layout changes above the player are compensated during the swap;
manual scrolling interrupts that adjustment. Reduced motion skips the swap.
Public episode metadata shares in-flight requests, survives route remounts for five seconds, and retries a temporary failure once.
An unsuccessful background revision check preserves the loaded player and retries at the next check;
a confirmed provider policy change stops playback until the updated policy is validated.
Loading and error states reserve the player dimensions,
and a short-lived canonical transition intent restores its viewport position before paint.
At the last/first episode, the
sequence moves to the next/previous enabled franchise part in premiere order, including films and
OVA when enabled. Format filters persist for that franchise during the browser session. The native
player also advances on `ended`; iframe progression depends on provider events. Canonical episode
identity, title metadata and account progress stay tied to the selected part. Provider editions with
different season labels are not automatically replayed as another catalog season.
The glow samples four video edges from a 24×14 canvas at most once per 300 ms. It stops reading when
paused, offscreen, in a hidden tab or with reduced motion. An inaccessible/CORS-blocked video or
external iframe keeps poster colors. No video images or sampled pixels are transmitted or stored.

Validated playback creates stable `Episode` UUIDs and provider mappings without storing URLs.
Identity belongs to title/season/episode, surviving translation/provider changes. Numeric labels `01` and `1`
match; special labels remain distinct. Conflicting reassignment rolls back.
`/anime/:slug/episodes/:episodeId?t=125` selects the episode and timestamp. SSR metadata/TVEpisode JSON-LD
and links are public; canonical excludes `t`. Invalid/foreign/hidden episodes and invalid/repeated timestamps return 404.
Timestamp deep links remain supported without a copy toolbar below the player. Episode sitemaps have 256 fixed UUID-prefix shards:
`/episodes/sitemap-index.xml` and `/episodes/sitemap/0.xml` through `/episodes/sitemap/255.xml`.
Only registered, published, non-development episodes appear; indexing-disabled maps are empty.

Configure the private server `.env`, then restart `pnpm dev`:

```dotenv
ALLOW_KODIK_DIRECT=true
KODIK_PRIVATE_KEY=your-private-api-key
```

A valid `KODIK_TOKEN` and enabled Kodik are also required. Optional `KODIK_MEDIA_HOSTS` restricts CDN hosts
with a comma-separated allowlist. HTML5/HLS supports quality/speed and browser-native fullscreen/PiP.
`ALLOW_KODIK` permits the provider overall; `ALLOW_KODIK_DIRECT` separately permits streams for the custom player.
The custom player's appearance is restored from the AnimeSoul archive: glass episode/translation menus,
circular play button, purple timeline and bottom controls. `PlayerMenus.tsx` shares navigation between
the idle screen and HLS; `custom-player.css` retains the original styles.
HLS prefers `hls.js` when MediaSource is supported; native HLS is the fallback.
Expiring URLs renew in place, preserving time, pause state and player settings. HLS performs one
media recovery or bounded URL refresh for network errors. Unrecoverable errors and missing streams
fall back to the approved embedded player.
Signed CDN URLs exist only in no-store responses/client memory, never database/localStorage.
HMAC requests use the fixed `kodikres.com/api/video-links` endpoint and a server-selected source; callers
cannot supply upstream URLs or viewer IPs. JSON is limited to 1 MiB, redirects forbidden, concurrency four.
Development discovers the public IP via ipify or optional `KODIK_VIEWER_IP`. Fixed IPs are forbidden in production.
Production requires a trusted real viewer address; the current loopback Next proxy intentionally does not trust
forwarded headers, so production keeps embeds until infrastructure supplies that address.

Watch sessions bind account web session and episode ID. Updates occur every ten seconds, on pause/end,
and best-effort on page exit. The latest opened tab owns progress; duplicate/old sequence values are ignored.
Watched time is bounded by wall time and 30 seconds per event; seeking does not add minutes. This remains
user history, not trusted business analytics. Legacy rows stay intact without ambiguous automatic mapping.
Library links resume new canonical progress. Guests receive a login hint and save failures show status.
Iframe events require the exact current window and origin, with bounded validated data; seek commands use
that origin. Reserve iframe timestamp/progress capabilities depend on its own API.

## Preferences and resuming

`/account#player-settings` and the player menu offer resuming (on by default) and automatic
continuation playback (off by default). Home/library links use `?resume=1` to read fresh database
progress, smoothly scroll to the player and restore the position. Browser autoplay restrictions
may still require a user gesture. Explicit `?t=` links retain their requested timestamp.

`EpisodeProgress.details.dubbing` records the actual voice. Global settings/favorites use
`UserProfile.preferences.player`; explicit per-title choices use `LibraryItem.tracking.playerDubbing`.
Priority is manual title voice, saved episode voice, available favorite, fallback. Explicit choices
save before playback. User locks preserve other JSON preferences; progress cannot erase manual
choices. Guests use device storage. Account player GET and preference/favorite/dubbing POST routes
require the standard session/CSRF checks; favorites are limited to 50 names.

Progress also flushes on visibility loss and route exit. A final keepalive write can supersede
an in-flight periodic write with a higher sequence. Home, cards and episode indicators refresh
after successful writes. Network loss or browser crashes remain best-effort.

The custom player lazily loads Anime4K WebGPU for 1080p, 2K/1440p and 4K/2160p. The default light
profile uses one CNNx2M pass to double the source dimensions, then fits the selected canvas size;
advanced uses Mode C for denoising and more detailed upscaling. Light skips x2 processing when the
source already meets the target. New frame callbacks are registered before rendering without
waiting for GPU completion; at most two GPU submissions are pending. The animation-frame fallback
skips duplicate decoded frames. Pause and seeking refresh the still frame. Processing
runs on the viewer GPU; source quality remains labeled separately. GPU resources are released on
disable/source changes/PiP. Unsupported WebGPU or errors leave native video; external embeds cannot
be processed. Styled keyboard menus and shared format switches cover both player and episode list.
The quality menu also offers Anime4K targets; selecting a source quality disables upscale. The
settings selector shares the same state. Dropdown portals belong to the player, so page scrolling
and carousel transforms keep them attached; clipped triggers close their lists. Both episode menus
use a full-width franchise part above equal-width season and episode fields.
On narrow screens both panels expand below the site header; their lists use viewport portals.

Timeline previews decode the lowest-quality stream independently of the main video. A 100 ms debounce,
two-second time buckets, 192×108 JPEG frames and a 48-frame memory cache limit work. Leaving the
timeline releases its decoder; main-video buffering takes priority. CORS/decoder failure shows only
the time. Frames, signed media URLs and GPU data are never sent to the database.

## Disabling and verification

```sh
pnpm providers:switch yummy disable "Operator disabled provider"
pnpm db:verify
```

Changes persist in `ProviderSetting` with an `AuditEvent`. Environment restrictions override
the stored setting; disabled, missing credentials and failure are distinct states.
Policy is checked before cache reads and after requests. Disabled policy clears the cache
and cancels pending requests when next checked. Catalog/fallback paths cannot bypass it.
The process cache holds at most 128 responses for one minute, with at most eight requests
in flight. Redirects are forbidden, requests time out after 10 seconds, JSON is limited to 4 MiB.

`db:verify` operates only on isolated loopback `animesoul_test` and `animesoul_restore_test`.
It checks migrations, HTTP privacy, UUIDs, provider policy and a backup/restore containing a
real test record and Unicode. It never writes to the working database.

## Current boundaries

- `GET /api/anime/:slug/playback` tries Kodik first, using enabled YummyAnime only when no usable episodes remain.
- Viewers cannot choose providers: `?provider=yummy` is rejected. The owner or an explicitly delegated account changes the site-wide reserve through a separate admin MFA session. Player provider names are hidden.
- New titles resolve the reserve by exact external IDs and matching metadata without importing a YummyAnime catalog.
- Next.js offers the matching same-origin route without exposing backend credentials.
- Only trusted HTTPS embed hosts are accepted; clients cannot supply arbitrary upstream URLs.
- External players load only after pressing Play. Video availability depends on the source.
- Secure provider controls, background jobs, full import and ID review work: [catalog](CATALOG.md).
- Accounts, libraries, episode IDs/pages, custom HLS and new progress work; media uploads remain stage 4 work.

On October 6, 2026, local HTTP checks confirmed episodes and successful embed pages for
Attack on Titan, Frieren and Violet Evergarden. The in-app browser policy blocked visual
playback verification at that time.

On October 7, 2026, the embedded Frieren episode played successfully in the browser: 640×360 video,
`readyState=4`, position advanced from 129 to 147 seconds after opening the 2:05 link.
The episode link tracked playback position; video was paused after verification.
After configuring the private key the same day, custom HLS playback was verified: 720p decodes,
switching to 480p preserves position and 1.5× speed. The API supplies 720p/480p/360p;
starting at 2:05, advancement to 3:14 and pausing were checked. This covers the local environment and the Frieren episode.

Quality changes prepare a second decoder while the current video remains visible. Rapid selections cancel only the pending decoder; a replacement commits when it can play at the saved position, retaining pause, volume and speed. Failed replacements keep the working stream. Open select menus remain attached during page scrolling and hold the player controls visible.
Timeline previews retain a lowest-quality decoder and an LRU cache across hovers. New seeks supersede old targets and never show an old frame with a new timestamp; an uncached position still depends on the source network response. The preview decoder is hidden explicitly to avoid a second video layer. Anime4K output is drawn above the native video, with direct GPU frame import and a compatibility bitmap fallback.
All title, season and episode ratings use one star-triggered slider, integer steps from 0 to 10, with a warmer color and stronger glow toward 10. Zero is stored distinctly from an unset rating. Episode tiles use compact rectangular rows.
Anime and episode pages have per-title descriptions, canonical links, poster Open Graph/Twitter cards and escaped JSON-LD (Movie/TVSeries, TVEpisode and breadcrumbs). Aggregate ratings use only real AnimeSoul votes. Local and demo pages retain noindex; public indexing remains controlled by the deployment configuration.
