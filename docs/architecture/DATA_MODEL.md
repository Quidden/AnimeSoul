[English](DATA_MODEL.md) | [Русский](DATA_MODEL.ru.md)

# Data and public contracts

Stage 4 adds `Episode` (UUID, title, normalized season/number, optional duration) and `EpisodeProvider`
(provider/title/source ID mapped to an episode without URLs). Composite foreign keys prevent cross-title mappings;
conflicts never overwrite established identity. New progress uses `episode:<UUID>` and `activePlaybackId`;
nullable `episodeId` preserves legacy keys/positions. `PlaybackSession` binds user, web auth session and episode
with sequence/lastEventAt/expiry. Row locking rejects stale events and wall time bounds watchedSeconds.
Auth-session deletion cascades playback sessions; starting playback cleans the user's expired sessions.
[Episode contracts](../../packages/contracts/src/episodes.ts) · [Streams](../../packages/contracts/src/streams.ts).

The current [Prisma schema](../../packages/database/prisma/schema.prisma) is applied through twelve SQL migrations.
See [status](../migration/STATUS.md) for PostgreSQL, import and restoration evidence.

| Model                                                        | Implemented purpose                                                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User / UserProfile                                           | Stable UUID, unique nullable email, Argon2id hash, disable flag; username, visibility, presence and private preferences. Unclaimed imports have no credentials |
| Session / UserRole                                           | Hashed random token, web/admin audience, expiry, revocation and MFA confirmation; explicit role grants                                                         |
| LegacyProfile                                                | Legacy ID → UUID, source hash, expiring one-time claim hash and claimed timestamp                                                                              |
| MfaCredential                                                | Encrypted TOTP, expiring pending setup, monotonic used counter and hashed single-use recovery codes                                                            |
| AuthThrottle                                                 | Hashed identity/IP key, attempt count and window retained across restarts                                                                                      |
| LibraryItem                                                  | Unique user/anime, favorite, title score, last episode/dub/season and safe progress/tracking details                                                           |
| LibraryRating                                                | Normalized season/episode scores with unique user/anime/scope/key and owner-library FK                                                                         |
| LibraryFolder / FolderEntry                                  | Owner folders, memberships and private notes. Composite folder/user FK prevents inconsistent ownership                                                         |
| EpisodeProgress                                              | Unique user/anime/episode key; position/duration/watchedSeconds, completion and safe legacy details                                                            |
| Anime / AnimeProvider                                        | Stable internal UUID/slug and metadata; exact external ID mappings                                                                                             |
| Character / AnimeCharacter                                   | Stable Shikimori character identity, cached names/portrait/profile and per-title role relationships                                                            |
| ProviderSetting                                              | Persisted provider switch, off by default and subordinate to environment policy                                                                                |
| AuditEvent                                                   | Import, claim, sessions, password, MFA, profile and operator actions; database append-only privileges remain pending                                           |
| SubscriptionTrial / SubscriptionPlan / SubscriptionPromotion | One registration trial, editable plans and dated promotional discounts; see [subscriptions](../operations/SUBSCRIPTIONS.md)                                    |
| Entitlement                                                  | Dated player access, including audited manual grants and revocations; checked before issuing direct streams                                                    |
| Order / Payment / WebhookEvent                               | Reserved billing boundary; payment processing is not connected                                                                                                 |

User deletion cascades through profiles, sessions and libraries. Anime deletion is restricted while library references exist.
Financial relationships use Restrict. AuditEvent has no actor foreign key.

## Privacy

Migration `20261007220000_catalog_discovery` adds optional Shikimori scores/votes,
popularity, format, translations, known franchise size and validated public details to Anime.
Details hold premiere dates, studios, duration, episode counts and public media/related IDs;
they never hold playback URLs or credentials. Community scores aggregate LibraryItem;
personal preferences derive from persisted watched episodes.

New favorites, folders, scores and progress use normalized tables. UserProfile.content remains a baseline compatibility
field and receives no new library writes; preferences are private. Visibility controls about/favorites/folders/ratings/statistics.
Public DTOs omit flags, email, preferences, notes, sessions, MFA, roles and hashes; hidden blocks are removed before
API, HTML and metadata serialization. Invisible appears offline. Publication and indexing consent are separate.
Watched counts titles with completed episodes; minutes derive from persisted watchedSeconds.
The new player submits timestamps automatically when its source supplies playback events.

## Import and temporary URLs

Four local profiles were imported without invented credentials or privileges. Three UUIDs survive unchanged; one legacy ID
has a deterministic mapping. Repeat import preserves newer edits; changed source profiles require reviewed reconciliation.
Unknown titles remain unpublished metadata with exact provider IDs for later catalog enrichment.
There is no video URL column. Legacy video/iframe/credential URLs are excluded. Current iframe sources are resolved
on playback requests and provider responses cached only in RAM for 60 seconds. Signed HLS/MP4 URLs are not persisted.

Contracts: [account.ts](../../packages/contracts/src/account.ts), [profiles.ts](../../packages/contracts/src/profiles.ts),
[catalog.ts](../../packages/contracts/src/catalog.ts), [playback.ts](../../packages/contracts/src/playback.ts).
[Account operations](../operations/ACCOUNTS.md) · [Routes](SITE_MAP.md) · [Playback](../operations/PLAYBACK.md).

## Stage 3 catalog and queue

Anime.searchText is materialized from titles/aliases by a database trigger.
Anime.metadataProvider separates Kodik, manual and retained legacy metadata.
KodikRelease maps translations to UUIDs without video URLs; CatalogImportPage hashes detect cursor cycles. CatalogImportJob stores
provider, Kodik strategy, API release count, opaque cursor, lease, counters and fixed error codes. A partial unique index
allows one queued/running/paused job per provider. ProviderMappingConflict records candidate IDs,
ownership snapshot, version and decision; ProviderMappingOverride preserves reviewed policy on
reimport. Secondary IDs can move without merging Anime or changing library/folder/progress references.
Jobs and AuditEvent contain no credentials, raw provider responses or video URLs.
[Catalog operations](../operations/CATALOG.md).

## Account identity

Migration `20261007093000_account_identity` adds `User.emailVerifiedAt`, unique nullable `googleSubject` and `authVersion`. Existing UUIDs/data survive; old emails are not automatically verified. `AccountToken` stores one token per user/purpose (verify/reset/change), SHA256, targetEmail, issuedVersion, expiry and consumedAt. `OAuthAttempt` stores state/browser hashes, nonce, encrypted PKCE verifier, optional user/session binding, expiry/consumption. Google access/refresh tokens are not persisted.

Voting, messaging and room models remain future work. Friendship arrived in stage 5 and initial Post/Comment content in stage 6; both are outside the earlier episode migration: [Social network plan](SOCIAL_NETWORK_PLAN.md).

## Stage 5 relationships

FriendRequest/Friendship use lowId/highId compound keys with ordered UUID CHECK constraints; requestedBy must be a participant. Follow/UserBlock use directed keys and reject self-relations. User FKs cascade. UserProfile.profileAccess/friendRequests extend settings; isPublic remains the guest boundary. Visibility supports public/friends/private sections, reading legacy booleans compatibly. [Behavior and migration](../operations/FRIENDS.md).

## Local community content

Migration `20261007200000_content` adds Post and Comment. Review is Post.kind=review,
with one active author/title pair enforced by a partial unique index. Posts store audiences,
tags, labels, anime/episode UUIDs and timestamps. Comments target exactly one anime, episode
or post and optionally a parent. Soft deletion leaves a placeholder. Audience/block checks
run in transactions; adult preferences remain in profile.preferences.
[Behavior](../operations/CONTENT.md) · [Demo data](../operations/DEMO_COMMUNITY.md).

## Administration data

`AnalyticsEvent`, `Announcement`, `NotificationCampaign`, `NotificationReceipt`, `SiteSetting`;
existing User/AuditEvent/SubscriptionPlan/SubscriptionPromotion/Entitlement receive additive fields and indexes.

[Migrations, collection and storage boundaries](../operations/ADMINISTRATION.md).
