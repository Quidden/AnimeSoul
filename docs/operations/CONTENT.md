[English](CONTENT.md) | [Русский](CONTENT.ru.md)

# Publications and discussions

The first part of stage 6 works locally: text posts, reviews with optional scores,
episode posts with timestamps, comments and one reply level. `/community` lists new content;
`/posts/:id` opens a discussion. Profiles and related anime/episode pages read the same records.
Voting and hot ranking belong to stage 9.

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

Stage 6 remains partial: reports, moderator workflow, revision history, public score aggregates
and deeper threads are pending. Messages, rooms and votes remain planned. Fictional accounts
support local testing; this is not a public release.

[Demo community](DEMO_COMMUNITY.md) · [Status](../migration/STATUS.md) · [Data](../architecture/DATA_MODEL.md).
