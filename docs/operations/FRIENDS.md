[English](FRIENDS.md) | [Русский](FRIENDS.ru.md)

# Friends and privacy

Stage 5 is implemented locally. `/friends` provides public-user search, friends, incoming/outgoing
requests, following, followers and blocks. Profiles have relationship actions, preserving AnimeSoul styling.

The page uses a section sidebar on desktop and a two-column section menu on mobile, with search
and the selected list in the main area. Each section has its own loading, error and empty states.
The count describes loaded profiles and shows `+` while more pages are available. Accepting a
request is prominent; removing a friend and blocking are grouped in an actions menu. Motion
respects the device's reduced-motion preference.

Requests can be accepted, declined or cancelled; friends can be removed. Repeats do not duplicate.
Crossed requests become a friendship because both users expressed consent. Following is one-way and
grants no friends-only access. New requests/follows require a public target; requests also require
the recipient's permission. Private profiles are excluded from search. Existing requests can be accepted
after a profile closes.

`/account` independently controls the whole profile and each section: public, friends or private.
Public sections do not override the whole profile's audience. Post/review/comment-history settings
prepare stage 6; content remains pending. Hiding comment history does not remove a public anime comment.

A block atomically removes requests, friendship and both follows, preventing subsequent social actions
and authenticated profile access between the pair. Unblocking restores no previous relationships.
Public content remains available to guests. Future messages, notifications and rooms must check these
blocks on every request, event and reconnect.

| API                                                    | Purpose                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| GET /api/account/social?section=friends&after=UUID     | Own list; also incoming/outgoing/following/followers/blocked                           |
| GET /api/account/social/search?q=name                  | Up to 20 public profiles; minimum two characters                                       |
| GET /api/account/social/:userId                        | Own relationship, without private account fields                                       |
| POST /api/account/social                               | targetId; action: request/accept/decline/cancel/unfriend/follow/unfollow/block/unblock |
| GET /api/account/profiles/:username                    | Owner/friend/block-aware profile with section filtering                                |
| GET /api/account/profiles/:username/friends?after=UUID | Accessible friend-list pagination; hidden lists return 404                             |

These routes require a web session. Writes also require Origin, application header and CSRF. Actor UUID
comes only from the session; responses and Next proxy use `no-store`. Lists return at most 50 items,
ordered by UUID, with a `next` cursor. Owners see identities of their own friends. Other viewers' lists
exclude inaccessible profiles without exposing hidden counts. Guest DTOs include up to 50 public friends
when the section is open; later pages require sign-in. Hidden lists expose no array, count or cursor.

`FriendRequest`/`Friendship` store one ordered UUID pair; `Follow`/`UserBlock` store directed pairs.
CHECK constraints validate pair order and requester. Mutations lock both User rows in UUID order,
serializing crossed requests and block races. Actions are audited and limited to 60 per user per minute
in PostgreSQL, surviving process restarts separately from authentication limits.

Legacy boolean visibility retains public/private meaning; new sections default to private. Guest DTOs,
metadata and JSON-LD use public data only; authenticated HTML has noindex. Private profiles are excluded
from sitemaps; invisible presence is serialized as offline. Unicode route names are decoded once and
validated before API access.

Six PostgreSQL scenarios cover sessions/CSRF, request direction, races, blocks, audit, three audiences,
revocation, direct list access, pagination and persistent limits. A production SSR test verifies Unicode
routes, access and exclusion of private text from metadata/JSON-LD. `db:verify` includes friendship/follow
backup restoration. Migration `20261007160000_social_relations` was applied to the local working database
after backup: old fields in eight tables and all 13,142 current anime UUIDs/slugs retained their hashes.

[Data](../architecture/DATA_MODEL.md) · [Social design](../architecture/SOCIAL_NETWORK_PLAN.md) · [Status](../migration/STATUS.md).
