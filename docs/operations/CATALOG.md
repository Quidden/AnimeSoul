[English](CATALOG.md) | [Русский](CATALOG.ru.md)

# Catalog and providers

Kodik supplies the primary catalog and playback. YummyAnime is an optional, disableable playback reserve.
PostgreSQL holds refreshable Kodik metadata: names, descriptions, posters and external IDs.
Stable UUIDs/slugs connect titles to libraries, ratings and SEO. Credentials and video links are never
stored in catalog records, jobs or audit. Current embed URLs are resolved on playback requests:
[playback](PLAYBACK.md).

## Discovery pages and restored interface

`/catalog` has separate shelves. Popular, ongoing, new, highly rated, completed,
announced, movies, series, personal recommendations and all titles have dedicated
`/catalog/:section` pages. Genres use `/catalog/genres/:genre`.
Filters combine title, included/excluded genre, format, status, translation,
known franchise membership, years, minimum score and source before pagination.
Popularity uses Shikimori vote counts. AnimeSoul scores average title scores from
active users. Personal scores and watched-genre recommendations derive identity
from the web session, never request actor IDs.

Random selection covers the full catalog, current form values, or watched genres.
The last mode excludes started titles and announcements and normalizes genre count.
Missing history produces an explanation. Mobile filters have an Escape/focus dialog.
Cards show a Shikimori score or an unknown marker, without a hover arrow circle.
Full cards expose community/personal scores, progress, known franchises and
favorite/folder actions. The logo returns home. Home resumes actual viewing history.
Title pages restore facts, available trailers/screenshots, known franchise titles,
season/episode listings and episode scores alongside current social content.

Comparison used `AnimeSoulArchive/app/frontend/src`. Full legacy parity is still
pending: offline downloads, Chromecast/desktop integration and collapsing franchise
cards need separate migration. Franchise maps contain published exact-ID matches only.

## Characters and franchise navigation

Anime and episode pages display character portraits, names and roles for that title.
`/characters/:slug` opens a shared character profile with alternative names, a description,
voice actors and appearances in published catalog entries. Roles belong to the anime-character
relationship, so the same character can have different roles in different seasons. Descriptions
are always expanded, with section navigation for the profile, description, voice actors and anime.
Both the title cast and character appearances use horizontal rails that advance one card per wheel tick.
Rails are centered and fit a whole number of cards, including the final scroll position and short lists.
Global search includes character names and aliases.

Shikimori character IDs provide stable identities. Public character metadata and cast relationships
are stored in PostgreSQL; provider failures retain cached information. Exact anime provider IDs
connect appearances to the catalog. Unpublished titles and production development fixtures are excluded.
The source does not provide a structured episode/event timeline; no event associations are inferred.

The franchise board displays anime posters and a horizontally scrollable season strip. Selecting
a season displays its characters and their links to other seasons. The board pages large casts,
while selecting a character highlights its appearance links and opens its description, per-title roles
and profile link in the left panel. Details load on selection, with an in-place retry after failure.
Story relations determine franchise membership. Crossovers, shared characters and other external links
open the target anime's own franchise map under “Другие франшизы”. Complete provider graphs supersede
legacy untyped links so reverse crossover references cannot merge independent stories.

API: `GET /api/anime/:slug/characters`, `GET /api/characters/:slug`; franchise responses include
character appearances and `externalLinks`, and `GET /api/search?q=…` includes a `characters` group.
[Character contracts](../../packages/contracts/src/characters.ts).

After building and applying migrations, `pnpm catalog:characters --limit=50` preloads a batch
of popular titles with stale or missing cast metadata in the local database. `--slug=anime-slug`
selects one title. Opening an anime also refreshes its cast automatically.

## Metadata-only refresh

```powershell
pnpm catalog:metadata
```

This local-only command snapshots metadata in ignored `artifacts/catalog-restore`
and updates established KodikRelease mappings without changing UUIDs, slugs or accounts.
The normal worker also updates these fields. Premiere dates correct season-specific years.
Title reads supplement stored facts with public Shikimori using exact IDs and a
24-hour cache; fresh direct facts take precedence over provider metadata. Source failure
keeps stored metadata. Trailers/screenshots are public HTTPS URLs, never credentials or
temporary playback media. The command uses the configured server-side Kodik token.

## Full refresh

```powershell
pnpm build
pnpm catalog:sync
pnpm catalog:worker
```

The catalog commands enqueue and process a PostgreSQL job. Existing active jobs are reused.
Private `.env` `CATALOG_WORKER=true` starts the worker with `pnpm dev`; the default is false.
It requires `DATABASE_URL`, `ALLOW_KODIK=true`, a Kodik server credential and enabled Kodik setting.
YummyAnime never supplies catalog imports. Idle workers make no upstream calls.
[Local development](LOCAL_DEVELOPMENT.md).

The worker reads Kodik `/list` in batches of 100 releases with `types=anime,anime-serial` and
`with_material_data=true`. Completion follows the API next-page marker, not the result count.
Only the opaque `next` parameter is extracted from a validated `next_page`. Credential-bearing URLs
are neither persisted nor followed. Repeated pages and cursor cycles are rejected.

Translations share one material identity: Shikimori, then Kinopoisk, otherwise the native Kodik release ID.
KodikRelease stores only `movie-N`/`serial-N` to UUID mappings, without video URLs.
Reimports preserve UUIDs/slugs. A legacy UUID is reused only with an exact primary external ID, matching metadata
and one unambiguous candidate. Unmatched legacy records remain accessible to saved libraries and old URLs,
but are excluded from primary catalog listings, genres and sitemap.

The queue stores its cursor, processed releases, pages, rejection and conflict counts.
Release counts include translations and differ from unique anime counts. Leases with `SKIP LOCKED`
prevent competing workers. A whole page and checkpoint commit atomically. Restarts resume the last
checkpoint; leases expire after two minutes. Retries are limited to five attempts with backoff and
bounded `Retry-After` up to ten minutes. Errors use fixed local codes. Redis is not required.
`pnpm catalog:import --pages=3` manually imports up to 20 Kodik pages; `--q` is unsupported.

## Administration

[Admin](http://localhost:8022) requires a separate admin session, explicit owner/admin role and MFA:
[account operations](ACCOUNTS.md). Imported profiles receive no automatic roles.
Mutations require exact Origin, CSRF and a reason, recorded in audit.

The panel shows provider roles, credential presence without values, progress and ID review.
Operators can refresh, cancel or resume Kodik jobs. Environment restrictions and missing credentials
cannot be bypassed. Disabling Kodik pauses imports and discards in-flight results; reenabling requires
an explicit resume. Disabling YummyAnime only disables reserve playback.
Catalog/search continue reading persisted metadata.

```powershell
pnpm providers:switch yummy disable "Playback reserve disabled"
pnpm providers:switch kodik disable "Catalog refresh paused"
```

Secondary Shikimori/Kinopoisk mappings may be retained or reassigned after review.
Decisions check versions and current ownership, persist reimport policy and never merge UUIDs or user data.
Primary identities cannot be reassigned through this screen.

## Search and verification

Filters apply to the whole primary catalog before pagination, up to 60 titles per page with totals.
Genre facets cover the catalog. Alias searches are case-insensitive; a trigger refreshes search text.
Libraries retrieve published metadata by UUID independently of catalog pages.

`pnpm db:verify` checks migrations, leases, restart recovery, atomic rollback, cycles, independent switches,
playback order, mappings, library preservation, MFA/Origin/CSRF, search and backup/restore.
`pnpm check` checks builds, types, lint, tests and local documentation links.
