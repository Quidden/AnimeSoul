[English](SOCIAL_NETWORK_PLAN.md) | [Русский](SOCIAL_NETWORK_PLAN.ru.md)

# AnimeSoul social network

Product decisions, 2026-10-07: mutual friends, co-watching, private messages, anime/episode comments and scores, profile posts/reviews/comment history, and a Reddit-like community with up/down votes, badges, hashtags, NSFW, 18+ and spoiler labels. This is the target design; stage 5 (friends, follows, blocks and privacy) is implemented locally. Content is partly implemented; messages, rooms and votes remain pending. [Roadmap](WEB_STACK_PLAN.md#3-stages-and-completion-gates) · [Actual status](../migration/STATUS.md).

## Relationships and privacy

Mutual friendship has request/accept/reject/cancel/remove states and a unique ordered pair of user UUIDs. One-way following is separate and grants no private-profile or message access. Blocking overrides friends/follows and prevents direct requests, messages, room invitations and targeted notifications. Access is checked on every API request, socket event and reconnect. Public content remains accessible to guests; blocking does not promise internet-wide concealment.

Users control visibility of friends, posts, reviews, comment history, scores and statistics. Publications support public/friends/private audiences. A profile section's visibility and the underlying content's visibility are distinct: hiding comment history does not remove a public anime comment. The UI explains that distinction. Private/friend content never enters SEO, shared cache or public counters.

## Content and episode identity

Text posts include title, body, author, tags, labels, audience, timestamps and moderation state. Episode posts add the internal anime UUID, stable episode UUID and an optional timestamp in seconds. Posters/titles come from the catalog. Temporary stream/embed URLs are never stored in social content.

The player stage introduces `Episode` with UUID, season/order and provider mappings before social comments or rooms. `/anime/:slug/episodes/:episodeId?t=42` opens an accessible episode at the timestamp. A plain episode number without a season is not an identity. Timestamp bounds use known duration; provider changes preserve social references.

Threaded comments target an anime, episode, post or review; replies inherit the target. Edits, deletions, spoilers and reports are supported, with a tombstone for a removed parent that has replies. A review is long-form anime content with an optional score, one active review per author/anime, and edit history. Personal scores from 1–10 are separate from community votes. Public aggregates only include scores whose publication is allowed by the owner.

Profiles gain Posts, Reviews, Comments, Scores and Friends tabs. Anime pages show discussions, reviews and related posts; episode pages show their discussion and timestamp posts. These views reference the same entities rather than copying publications.

## Community, votes and ranking

Up/down arrows, a selected state, score, badges and tag chips use familiar Reddit-like behavior within AnimeSoul's existing visual style. Clicking the selected arrow clears the vote; the other arrow replaces it. A verified account has at most one `-1`/`0`/`+1` vote per object, enforced by the database and transactional counters. Self-voting on one's own publications/profile is excluded. Votes grant neither roles nor subscriptions.

Public published posts, comments, anime cards and opted-in profiles can have typed `CommunityEntry` records. Reviews are publications of their own type. Favorites, anime scores and upvotes are separate actions. Filters select entry type, tag or anime. The initial Hot order is:

```text
net = upvotes - downvotes
hot = sign(net) * log10(1 + abs(net)) + firstPublishedAtUnixSeconds / 45000
```

The first upvote increases rank and the first downvote decreases it. Larger positive balances keep competing with newer entries longer. Entries do not resurface merely by aging. Edits, comments, vote removal/reapplication and catalog refreshes never reset the initial publication time. Anime/profile entries use their first inclusion in community. The 45,000-second parameter is an initial product choice to validate on real data and version when tuned.

New and Top (day/week/month/all-time) orders are separate. Top uses a Wilson lower confidence bound, so one positive vote does not automatically beat sustained support. Ties use timestamps/UUIDs; cursor or ranking snapshots avoid duplicate pagination. Ranking runs after audience/block/label/moderation filters. Hidden/deleted IDs cannot be voted on. Rate limits, verified email, account age, coordinated-voting signals, recounts and audited invalidation protect against manipulation. Paid promotion is outside this mechanism.

## Hashtags and content labels

Tags use NFC/case normalization, server-owned length/count limits, persistent slugs and `/community/tags/:tag`. Unicode letters, digits and underscores are allowed, not HTML. Moderators manage aliases and prohibited tags.

18+ is an age label, NSFW is a sensitivity label, and spoilers have a separate flag plus optional anime/episode scope. They are distinct fields. Guests and new accounts hide NSFW/18+. Opt-in requires an explicit adulthood declaration and account preference; this is not document-based age verification. Filtering applies to feeds, search, profiles, recommendations, previews and notifications. Hidden text/original media URLs are not returned underneath a blurred image. Sensitive entries use a neutral gate and are excluded from public indexing. Spoilers require deliberate reveal; replies/quotes inherit necessary restrictions. Authors cannot remove stricter moderator labels.

Role/premium/custom badges are server-managed, separate from voting reputation. Content markup cannot create trusted badges or arbitrary executable animations.

## Messages, notifications and co-watching

The first messaging release has two-person conversations, delivery/unread state, optional read receipts, replies and reports. Recipient policies are friends/everyone/nobody, defaulting to friends. Only members can read/search conversations; direct UUID requests, sockets and revoked sessions are checked. Attachments later reuse moderated media processing and quotas. This design does not promise end-to-end encryption.

PostgreSQL stores messages; realtime events have server sequence numbers and gap recovery. Notifications cover friend requests, replies, mentions and room invitations; votes are grouped. Category preferences and sensitive previews are respected. Email/push notifications require separate opt-in.

A watch room stores owner, members, invite/friends/public admission, leader, anime/episode identity and play/pause/position. Authorization is checked on entry, events and reconnect; room chat follows block/moderation policies. Leadership transfer, removal and closure are supported. Server sequences/time snapshots resolve delays and reconnects. Each participant obtains video from their permitted provider and saves their own progress; the room neither relays video/credentials nor grants premium/player access. Verified HLS controls, episode-duration compatibility and authentication are prerequisites.

## Storage and release gates

Planned modules: messaging, watch-rooms, community, moderation. Post/Comment already exist; reviews use Post.kind=review. Planned tables: Tag, PostTag, ContentLabel, CommunityEntry, Vote, Conversation, ConversationMember, Message, Notification, WatchRoom, WatchRoomMember, Report, ModerationAction. These are future migrations, not existing Prisma models.

Baseline moderation must accompany publication: reports, blocks, deletion, sanctions, reasons and audit. Tests cover duplicate relationships/votes, concurrent writes, privacy changes, blocking after socket connection, foreign conversations, XSS, spoilers/NSFW, ranking manipulation and room recovery. Load tests include messages and votes. The planned initial public release includes all social stages; staged releases require a user decision and per-feature completion gates/flags. Unverified modules are never counted as complete.

FriendRequest/Friendship/Follow/UserBlock and Episode exist from stages 4–5. [Implemented friendships](../operations/FRIENDS.md).
