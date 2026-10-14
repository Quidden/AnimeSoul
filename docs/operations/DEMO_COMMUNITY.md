[English](DEMO_COMMUNITY.md) | [Русский](DEMO_COMMUNITY.ru.md)

# 100 fictional users

The user requested 100 realistic fictional local accounts. Each has an individual password
and a genuine Argon2id hash, no administrative role, an example.invalid email and indexing off.
Bodies contain invented opinions and discussions, not statements from real users.

```sh
pnpm demo:community
pnpm demo:community verify
```

Only the existing loopback animesoul database on 54329 outside production is accepted.
Before creation the command checks pg_dump and snapshots original user/library/anime identities.
All accounts and activity are inserted in one transaction. Repeating the command exports existing
credentials without resetting passwords or activity. Missing accounts or a mismatched manifest
stop the command. verify checks all 100 Argon2id passwords.

Ignored `artifacts/demo-community` contains credentials in CSV/TXT, a private manifest, backup
and preservation evidence. Sign in at `/account` using email, not nickname. The first account,
Sora_NightTea, has over 50 friends, requests and blocks. Each credentials row describes its scenario.

Profiles vary in tastes, presence and audiences. They have folders/notes, ratings, real episode
progress, friendships, follows, requests and blocks. Posts, reviews, comments, replies and
timestamps use the real APIs. Existing episode IDs are reused. No background bot is started;
activity is prepared once and remains available for manual tests in community/profile/friends/library.

[Content](CONTENT.md) · [Friends](FRIENDS.md).
