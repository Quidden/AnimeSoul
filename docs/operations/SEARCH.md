[English](SEARCH.md) | [Русский](SEARCH.ru.md)

# Universal search

The search button is in the shared website header, including catalog, anime, episode,
profile and account pages. Click it, press **Ctrl+K** (**Cmd+K** on macOS), or press
**/** while outside a text field. The dialog expands with a highlighted search surface
and dimmed background; reduced-motion preferences disable its animations.

The dialog is up to 1180 pixels wide and fits the viewport height. Wide screens show
anime alongside the remaining categories; narrow screens use one column. Results
share a vertical scroll area, without individual section height limits.
An empty search shows only three currently popular
anime and quick settings shortcuts: theme, profile, privacy, security, and email/Google.
Typing a query shows only categories with matches. A single matching category has
no heading or dividers; multiple matching categories each have a heading and their
shared scrolling area. Settings shortcuts
are a curated list, not measured user rankings. Anime ranking first counts distinct
accounts with recorded viewing progress in the previous seven days. Ties, or the
absence of recent progress, use catalog popularity, then Shikimori score and title.
These are AnimeSoul viewing statistics, not a claim about worldwide popularity.

Anime results also show episode counts: the known total and, for ongoing titles,
the number currently released. Counts come from catalog metadata and registered
episodes; an unknown total is left unknown rather than guessed.
After sign-in, a viewing bar and status use that account's saved episode progress
and completion marks.
Partially watched episodes contribute their saved position when duration is known.
An ongoing title with all currently released episodes watched is shown as caught up,
not as a completed title. No saved progress means no viewing recorded in AnimeSoul;
it cannot prove the viewer has never seen the anime elsewhere. Guests have no personal
viewing status or bar.

Pausing the pointer on a card for 900 ms opens an enlarged preview. Anime previews
include the poster, title, ratings, episodes, personal progress and description;
characters include their biography, voice actors and anime appearances with roles;
people include profile information and statistics visible to the viewer. Settings
and filters explain their action. Movement beyond a 6-pixel tremor allowance,
scrolling, typing or closing dismisses the preview. Clicking opens the entity or
applies the filter. Arrow-key selection also previews after a pause; touch opens
the result directly. Character/profile details load only when a preview opens and
requests are cancelled when it closes. Profile previews use no-store responses and
the same visibility rules as the profile page.

## Names, people and settings

Anime can match Russian/original titles and imported aliases. Common abbreviations
include `АОТ`/`AOT`/`SNK`, `КРД`/`KNY`, `JJK`, `МГА`/`MHA`/`BNHA`, `SAO` and `DN`.
Matching also handles bounded spelling errors and accidental Russian/English keyboard
layout changes; unfamiliar abbreviations are not automatically known.

Search people by nickname, optionally prefixed with `@`, or by complete account UUID.
Nickname search requires at least two characters. Guests see public enabled profiles.
Signed-in viewers can also find their own profile and accessible friends-only profiles;
blocks in either direction remove a person from their search results. Responses contain
only nickname, avatar and public identifier, without email or private profile sections.

Settings results link to real controls on `/account`:

| Result                 | Target                         | Controls                                               |
| ---------------------- | ------------------------------ | ------------------------------------------------------ |
| Appearance theme       | `/account#appearance-settings` | Lilac or Graphite, two dark palettes on this device    |
| Profile settings       | `/account#profile-settings`    | Name, biography, avatar, cover and presence            |
| Privacy and visibility | `/account#privacy-settings`    | Profile/section audience, friend requests and indexing |
| Account security       | `/account#security-settings`   | Password and second factor for administrative access   |
| Email and Google       | `/account#identity-settings`   | Email verification/change, Google linking and recovery |

A theme can be changed without sign-in. Lilac is the default; Graphite uses neutral
gray-blue surfaces and accents. Both palettes are dark. The browser stores the choice
on this device; it is not synchronized through the account. Other settings require
sign-in; the requested section is scrolled into view once its data loads.
An account without a password uses the email/recovery section for security. Filters narrow anime results; people and
settings are searched when no anime filter is active.

## Filter syntax

Click a filter chip or type its key and colon. Suggestions appear after the colon;
genre suggestions use the available catalog genres, with popular values first when
the value is empty. Names containing spaces should be quoted.

| Filter | Example                         | Meaning                                                 |
| ------ | ------------------------------- | ------------------------------------------------------- |
| Genre  | `tag:"Психологическое"`         | Anime with this genre                                   |
| Status | `status:онгоинг`                | `онгоинг`, `вышло` or `анонс`                           |
| Format | `type:фильм`                    | `сериал`, `фильм`, `ova`, `ona`, `спецвыпуск` or `клип` |
| Year   | `year:2024` or `year:2020-2026` | Exact year or inclusive range, within 1900–2200         |
| Score  | `rating:8+`                     | Minimum Shikimori score, within 0–10                    |

Combine filters and ordinary title text, for example
`tag:"Психологическое" status:вышло rating:8+ тетрадь`.
`genre:`/`жанр:`, `статус:`, `format:`/`формат:`/`тип:`, `год:` and
`рейтинг:`/`оценка:` are accepted aliases. A semicolon also works as a separator,
for example `tag;"Психологическое"`. One value per filter is supported; repeating
the same filter replaces its earlier value. Multiple required/excluded genres are
not implemented in this syntax.

Use **↑/↓** to select a suggestion, **Tab** to complete it, **Enter** to apply a
filter suggestion or open the selected result, and **Esc** or the backdrop to close.
With no selected result, Enter opens `/search?q=…`. The query limit is 240 characters.
The dialog/results page return up to eight anime and six people, plus matching settings.
For a query containing only filters, the results page also links to the full filtered catalog.

When a suggestion continues the exact input, its remaining text appears in grey inside
the field and Tab appends it while preserving the typed prefix. This preview is hidden
for typo replacements, selected text or a cursor in the middle of the query. Filter
completion preserves existing quotes and following filters, and closes an unfinished
quote. Clear removes the query and keeps the dialog open; the separate close button
returns focus to the header. Opening the search again resets the results to the top.

## Implementation and checks

### Anime screenshot search

Open **Search by frame** from the header search. The `/search/frame` page is linked
from the burger menu and footer sitemap. Ordinary search includes a paste/drop hint.
Select, drop or
paste a JPEG, PNG, WebP or GIF. Recognition starts automatically and stays in the
same search dialog; the dedicated page offers the same workflow.
The public route works for guests. It uses [trace.moe](https://soruly.github.io/trace.moe-api/)
to return up to five distinct anime/episode matches with scene time, similarity and
temporary image/video previews. Below 90% similarity the interface suggests another
frame. Adult previews are hidden. Expired previews do not remove titles or links.
An exact, unambiguous title/alias match links to a published AnimeSoul title; otherwise
the user can search the catalog. Watch shows season, episode and time and opens the
exact registered episode with `?t=…#anime-watch` when the match is unambiguous and
the timestamp fits its duration. Multi-season titles require an exact season; separate
season titles can use local season numbering starting at one. Absolute episode offsets
are never guessed. Unresolved matches open the player with a choose-episode caption.
Season numbers come from explicit provider titles or matched local episodes.
Curated trace.moe `episode_start`/`episode_end` take precedence over filename-derived
episode numbers; multi-episode ranges never produce an exact watch link.
Images and videos retain their proportions without cropping, with a larger side preview
on wide cards and media above the text on narrow cards. Modern previews request size `l`.
Show scene starts playback; Show frame switches back to the image.
Catalog failure does not break recognition. Other matches can be expanded below the best match.

Both image-search views share a local history of the latest 20 successful results.
It stores titles and scene coordinates, without input images, temporary media URLs or
old quotas. Opening a history item makes no external search. Clear removes that history
on this device. The ordinary header search also keeps ten recent text queries with a
separate clear action. Corrupt or unavailable browser storage does not break search.

The dedicated page has a canonical URL, title/description, Open Graph/Twitter metadata,
visible FAQ and matching FAQ/WebApplication/Breadcrumb structured data. It is included
in sitemap/robots for a public HTTPS deployment with `PUBLIC_INDEXING=true`; development
and demo environments remain excluded from indexing. Search results/history are client
state and are not exposed to crawlers.

`POST /api/search/frame` accepts raw image bytes through a same-origin web proxy with
`X-AnimeSoul-Request: 1`, `application/octet-stream` and `no-store`. Both layers enforce
5 MB; the API checks signatures, decoding and a 4096 × 4096 / 16 megapixel limit.
Only the first GIF frame is used. The API strips metadata and sends a JPEG of at most
640 × 360 to a fixed trace.moe URL. Uploads/results are not persisted on the server, and session
cookies and personal account information are not forwarded. Cancel, retry and timeout
states are supported.

`TRACE_MOE_API_KEY` is optional and server-only. AnimeSoul permits ten outbound search
attempts per verified user (guest fallback: normalized socket IP) per 24-hour window,
with a shared ceiling of 100 attempts per 24 hours. Windows start on the first attempt;
reading quota or rejecting an invalid image does not spend a slot. Attempts that reach
the provider count even if it fails. The five-per-minute gate uses the same identity.
One external search runs at a time per API process; provider limits still apply.
Daily counters persist in the namespaced hashed-key `AuthThrottle` store. A PostgreSQL
transaction/advisory lock reserves both budgets atomically across API instances.
Without a configured database, local/demo tests use process-local counters.
Provider quotas, outages and invalid responses return readable errors.
Preview URLs expire after five minutes; retrying obtains fresh previews. Consult
the provider's [terms](https://soruly.github.io/trace.moe-api/#/terms) before commercial use.
`GET /api/search/frame/quota` and `/api/search/frame/limit` return `personal` and `global`
objects with `total`, `used`, `remaining`, and `resetAfter` (seconds). `personal.scope`
is `user` or `ip`. Legacy top-level counts retain provider counts when available;
the new `global` object describes the effective ceiling. Without provider data,
top-level counts describe the local policy ceiling.
Provider `/me` counts are cached for 30 seconds and refreshed after search; they can
only reduce the global remainder. If unavailable, `providerAvailable: false` explicitly
marks that only the local policy counters are known. No provider identity/key is exposed.
429 responses use `RATE_LIMITED`, `retryAfter`, `Retry-After`, and `limitScope`:
`personal`, `global`, `provider`, or `concurrency`.

The API accepts a dedicated, opt-in visitor-IP channel for frame-search budgets:

```http
X-AnimeSoul-Client-IP: 203.0.113.10
X-AnimeSoul-Proxy-Secret: <INTERNAL_PROXY_SECRET>
```

Configure the same private `INTERNAL_PROXY_SECRET` in web and API (32–256 URL-safe
characters; generate with `openssl rand -hex 32`). Also explicitly configure the API's
trusted socket peers: `INTERNAL_PROXY_TRUSTED_HOSTS=web` for Docker Compose, or
comma-separated exact `INTERNAL_PROXY_TRUSTED_IPS` for static addresses. Loopback peers
such as `127.0.0.1,::1` are suitable for local development. IP subnets are not accepted.
A nonempty secret without a source allowlist fails configuration validation. An empty
secret disables the channel, including when visitors supply these headers themselves.

The API requires both a constant-time secret match and an actual socket IP belonging
to the configured web peer. Docker hostnames are resolved afresh per request, with only
concurrent DNS work shared and a one-second timeout; DNS failures do not authorize a
previous web address. IPv4-mapped addresses are canonicalized; source IPv6 peers must
match exactly, not merely share a /64. Visitor IPs must be single IPv4/IPv6 literals,
without ports, lists or zone IDs. Failed checks ignore the claimed IP and retain the
socket identity. Existing guest IPv6 budget grouping remains /64.

Use both headers on `POST /api/search/frame`, `GET /api/search/frame/quota`, and
`GET /api/search/frame/limit`, so reads and reservations use the same visitor identity.
Verified account sessions still take priority. Fastify `trustProxy` remains false;
neither `request.ip` nor the general API traffic/authentication budgets are rewritten.
The API never accepts ordinary `X-Forwarded-For`/`Forwarded` as this authorization.

The existing web route still needs to send these headers. It must overwrite any
incoming `X-AnimeSoul-*` values and derive the visitor IP from its trusted ingress,
not copy a browser-supplied client-IP claim and attach the secret. Keep the secret in
server-only runtime configuration, outside `NEXT_PUBLIC_*`, browser responses and logs.
Use the channel only over the private web-to-API network or protected HTTPS transport.
The API implementation and spoofing tests are in
[`internal-proxy.service.ts`](../../apps/api/src/auth/internal-proxy.service.ts) and
[`internal-proxy.test.mjs`](../../apps/api/tests/internal-proxy.test.mjs).

Code: [UI](../../apps/web/components/FrameSearch.tsx),
[API service](../../apps/api/src/catalog/frame-search.service.ts),
[web proxy](../../apps/web/lib/frame-search-proxy.ts).
Checks: [API/media](../../tests/frame-search.test.mjs),
[client](../../tests/frame-search-client.test.mjs),
[history](../../tests/frame-search-history.test.mjs),
[web integration](../../tests/frame-search-web.test.mjs).

`GET /api/search?q=…` is served by the API and proxied on the website origin with
`no-store`. An optional web session supplies the viewer identity; callers cannot choose
another viewer ID. `/search` is rendered on the server and has `noindex`.
The API caches candidate names/genres for 45 seconds, up to 20,000 catalog entries
and profiles. Publication and viewer access are rechecked before returning results.
Episode counts and the signed-in viewer's saved progress are loaded afresh for the
returned anime, outside this shared candidate cache; another account's progress is
never included. Search uses the last progress saved by the player, not unsaved playback.
The matcher is in the API/shared contracts; PostgreSQL full-text/trigram indexes or a
separate search service remain future work if measured load or relevance requires them.

Source: [dialog](../../apps/web/components/UniversalSearch.tsx),
[syntax and scoring](../../packages/contracts/src/search-syntax.ts),
[API](../../apps/api/src/catalog/global-search.ts),
[settings](../../apps/web/lib/search-settings.ts).
Theme: [account control](../../apps/web/components/AccountAppearance.tsx),
[pre-paint bootstrap](../../apps/web/lib/theme.ts),
[palettes](../../apps/web/styles/theme.css).
Checks: [syntax](../../packages/contracts/tests/search-syntax.test.mjs),
[API and privacy](../../tests/global-search.test.mjs),
[settings](../../tests/search-settings.test.mjs),
[theme and blocked storage](../../tests/theme.test.mjs),
[server pages](../../tests/website.test.mjs).
