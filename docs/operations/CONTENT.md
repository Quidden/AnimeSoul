[English](CONTENT.md) | [Русский](CONTENT.ru.md)

# Publications and discussions

The first part of stage 6 works locally: text posts, reviews with optional scores,
episode posts with timestamps, comments and one reply level. `/community` lists new content;
`/posts/:id` opens a discussion. Profiles and related anime/episode pages read the same records.
Voting belongs to stage 9. The community feed supports recency and discussion activity ranking.

Posts have public/friends/private audiences, hashtags and independent spoiler/18+/nsfw labels.
Adult filtering defaults off; enabling it requires a session and explicit age declaration.
The server excludes hidden content from lists and direct responses. Spoilers expand separately.
Community/post pages use noindex; private content never enters SEO. Bodies render as text with
safe internal references; arbitrary HTML is not executed.

The shared post/comment editor suggests anime and characters while a name is being typed.
An explicit `@` also starts name lookup. Choose with the mouse or arrow keys and Enter; Escape
closes suggestions. Anime references can point to the title or to a selected season/episode,
with an optional timestamp such as `12:34` or `1:02:03`. The "Add reference" button provides
the same picker when writing outside an anime page. Episode links open the selected player
at `?t=<seconds>#anime-watch`, including an explicit `t=0` for the beginning.

References are stored in the existing body string using Markdown link syntax, targeting
`/anime/...` or `/characters/...`; users see styled link labels inside the editor. Rendering accepts
only catalog routes and valid episode timestamps. Same-origin pasted catalog URLs also become
links. Other text and unsafe URLs remain literal text. Existing records need no migration;
spoiler references remain hidden until their spoiler is expanded. Post/comment body length
limits still apply to the serialized text, including references.

Profile section visibility is independent of publication audience: hiding comment history does
not remove a public anime comment. Two-way blocking and revoked friendship affect every read
and reply. Authors alone edit/delete; deleted comments leave placeholders. One active review
per author/title is enforced. Writes require web session, Origin, request header and CSRF;
PostgreSQL enforces 30 writes per author/minute. Replies inherit labels and cannot change targets.

Under `/api/account/content`: GET/POST posts, GET posts/:id, POST posts/delete,
GET/POST comments, POST comments/delete and POST preferences. Guest GET reads only permitted
content. Pages contain 20 posts or 50 comments; before/beforeId orders by createdAt/id.
The session determines the author.

`GET /api/account/content/tags?period=day|week|month&limit=16` returns
`{ items: [{ tag, count }], period, since, until }`. The default period is a rolling seven days;
day/month mean 24 hours/30 days, with inclusive `since` and exclusive `until`. Counts cover all
public posts and reviews in that interval, respecting adult preferences, blocks, disabled
authors, deleted posts and unpublished anime. They are not estimated from a feed page.

Posts accept `sort=new|discussed|top`, `q` (up to 200 characters, case-insensitive literal
substring in title/body), `kind=text|episode|review`, `animeId` without `authorId`, and
`pinned=true|false`. `section=posts` excludes reviews; `section=reviews` selects them.
`new` is the default; `discussed` orders by the latest visible non-deleted comment (or post
creation when there are none); `top` orders by the number of visible non-deleted comments,
including replies. Both break ties by post creation and ID descending. Post DTOs include
`commentCount` and `pinned`. Counts apply the reader's access rules and exclude deletion stubs.
For ranked pagination, send all returned `next` fields alongside the original filters:
`beforeActivity` for `discussed` or `beforeCount` for `top`, plus `before`/`beforeId`.

`GET /api/account/content/comments` with no target or author returns the global discussion feed,
newest first, with the same 50-item cursor pagination. It excludes deletion stubs and comments
on friends/private posts even for their author. Targeted threads retain deletion placeholders.
Comment `q` searches the body; `href` opens the original anime, episode or post discussion.
The `/community` discussions tab uses this feed; search, sort, format and anime filters survive
navigation and pagination. The topic cloud uses the tags endpoint and supports period selection.

`POST /api/admin/platform/community/posts/:id/pin` accepts
`{ pinned: true|false, reason, operationId }`. It requires an admin/owner admin session with MFA,
Origin, request header and CSRF, and uses idempotent audited operations. Ordinary post writes
cannot set `pinned`. Only public posts may be pinned; changing audience to friends/private
automatically unpins the post. The unfiltered community shows pins separately above the feed;
search results include matching pins without duplication. Apply migration
`202611020001_community_content` before deploying the API.

Stage 6 remains partial: reports, moderator workflow, revision history, public score aggregates
and deeper threads are pending. Messages, rooms and votes remain planned. Fictional accounts
support local testing; this is not a public release.

[Demo community](DEMO_COMMUNITY.md) · [Status](../migration/STATUS.md) · [Data](../architecture/DATA_MODEL.md).
