import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URLSearchParams } from "node:url";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { csrfToken, digest, randomToken } from "../apps/api/dist/auth/security.js";
const connection = process.env.TEST_DATABASE_URL;
async function fixture() {
  assert.match(new URL(connection).pathname, /_test$/);
  const db = createDatabase(connection),
    users = [],
    animeId = randomUUID(),
    episodeId = randomUUID(),
    app = await createApplication(readConfig({ NODE_ENV: "test", DATABASE_URL: connection })),
    server = app.getHttpAdapter().getInstance();
  await db.anime.create({
    data: {
      id: animeId,
      slug: "content-" + animeId,
      title: "Тестовая история",
      originalTitle: "Test",
      aliases: [],
      description: "Fixture",
      year: 2026,
      genres: [],
      status: "released",
      published: true,
      episodes: { create: { id: episodeId, season: "1", number: "1", duration: 1400 } },
    },
  });
  async function user({ role, audience = "web", mfa = true } = {}) {
    const id = randomUUID(),
      token = randomToken();
    users.push(id);
    await db.user.create({
      data: {
        id,
        email: id + "@example.invalid",
        passwordHash: "fixture-hash",
        ...(role ? { roles: { create: { role } } } : {}),
        profile: {
          create: {
            username: "c-" + id.slice(0, 25),
            usernameKey: "c-" + id.slice(0, 25),
            isPublic: true,
            profileAccess: "public",
            visibility: {
              about: true,
              favorites: true,
              folders: true,
              ratings: true,
              statistics: true,
              posts: "public",
              reviews: "public",
              comments: "public",
            },
            content: {},
          },
        },
        sessions: {
          create: {
            tokenHash: digest(token),
            audience,
            mfaVerifiedAt: mfa ? new Date() : null,
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
      },
    });
    return {
      id,
      cookie: `animesoul_${audience}_session=${token}`,
      csrf: csrfToken(token),
      audience,
    };
  }
  const get = (path, u) =>
    server.inject({ method: "GET", url: path, headers: { cookie: u?.cookie ?? "" } });
  const post = (path, body, u, overrides = {}) =>
    server.inject({
      method: "POST",
      url: path,
      payload: body,
      headers: {
        origin: u?.audience === "admin" ? "http://localhost:8022" : "http://localhost:8021",
        "x-animesoul-request": "1",
        "x-csrf-token": u?.csrf ?? "",
        cookie: u?.cookie ?? "",
        ...overrides,
      },
    });
  const write = (u, extra = {}) =>
    post(
      "/api/account/content/posts",
      {
        kind: "text",
        title: "Что посмотреть вечером",
        body: "Хочу обсудить музыку и темп повествования.",
        audience: "public",
        tags: ["обсуждение"],
        labels: [],
        ...extra,
      },
      u,
    );
  const comment = (u, target, extra = {}) =>
    post(
      "/api/account/content/comments",
      {
        body: "Мне тоже понравилось, как музыка поддерживает настроение.",
        labels: [],
        ...target,
        ...extra,
      },
      u,
    );
  async function close() {
    await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await db.authThrottle.deleteMany({
      where: { key: { in: users.map((id) => digest("content:" + id)) } },
    });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.episode.deleteMany({ where: { id: episodeId } });
    await db.anime.delete({ where: { id: animeId } });
    await app.close();
    await db.$disconnect();
  }
  return { db, user, get, post, write, comment, close, animeId, episodeId };
}
test(
  "content writes enforce actor/CSRF, target validity, timecodes and one active review",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user();
      assert.equal((await f.write()).statusCode, 401);
      assert.equal((await f.write(a, { authorId: b.id })).statusCode, 400);
      assert.equal(
        (
          await f.post(
            "/api/account/content/posts",
            {
              kind: "text",
              title: "Вечерний пост",
              body: "Делюсь впечатлениями о музыке.",
              audience: "public",
              tags: [],
              labels: [],
            },
            a,
            {
              origin: "https://evil.invalid",
            },
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await f.write(a, {
            kind: "episode",
            animeId: f.animeId,
            episodeId: f.episodeId,
            timestamp: 1500,
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await f.write(a, {
            kind: "episode",
            animeId: f.animeId,
            episodeId: f.episodeId,
            timestamp: 125,
          })
        ).statusCode,
        201,
      );
      const p = await f.write(a, { kind: "review", animeId: f.animeId, score: 8 });
      assert.equal(p.statusCode, 201);
      assert.equal((await f.write(a, { kind: "review", animeId: f.animeId })).statusCode, 409);
      assert.equal(
        (await f.post("/api/account/content/posts/delete", { id: p.json().id }, b)).statusCode,
        404,
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "post audiences and profile history are independent; blocking and unfriend revoke direct access",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user(),
        p = (await f.write(a, { audience: "friends" })).json().id;
      assert.equal((await f.get("/api/account/content/posts/" + p)).statusCode, 404);
      assert.equal((await f.get("/api/account/content/posts/" + p, b)).statusCode, 404);
      const pair = a.id < b.id ? { lowId: a.id, highId: b.id } : { lowId: b.id, highId: a.id };
      await f.db.friendship.create({ data: pair });
      assert.equal((await f.get("/api/account/content/posts/" + p, b)).statusCode, 200);
      await f.db.userProfile.update({
        where: { userId: a.id },
        data: {
          visibility: {
            about: true,
            favorites: true,
            folders: true,
            ratings: true,
            statistics: true,
            posts: "private",
            comments: "private",
          },
        },
      });
      assert.equal((await f.get("/api/account/content/posts?authorId=" + a.id, b)).statusCode, 404);
      assert.equal((await f.get("/api/account/content/posts/" + p, b)).statusCode, 200);
      await f.db.userBlock.create({ data: { blockerId: a.id, targetId: b.id } });
      assert.equal((await f.get("/api/account/content/posts/" + p, b)).statusCode, 404);
      assert.equal((await f.comment(b, { postId: p })).statusCode, 404);
      await f.db.userBlock.deleteMany({ where: { blockerId: a.id, targetId: b.id } });
      await f.db.friendship.delete({ where: { lowId_highId: pair } });
      assert.equal((await f.get("/api/account/content/posts/" + p, b)).statusCode, 404);
    } finally {
      await f.close();
    }
  },
);
test(
  "comments validate reply targets, inherit labels, preserve deletion stubs and hide adult text server-side",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user(),
        p = (await f.write(a)).json().id,
        root = (await f.comment(a, { postId: p }, { labels: ["spoiler"] })).json().id;
      assert.equal(
        (await f.comment(b, { animeId: f.animeId }, { parentId: root })).statusCode,
        404,
      );
      const reply = (await f.comment(b, { postId: p }, { parentId: root })).json().id;
      assert.equal((await f.get("/api/account/content/posts/" + p)).json().commentCount, 2);
      const list = (await f.get("/api/account/content/comments?postId=" + p)).json();
      assert.ok(list.items.find((c) => c.id === reply).labels.includes("spoiler"));
      assert.equal((await f.comment(a, { postId: p }, { parentId: reply })).statusCode, 404);
      assert.equal(
        (await f.post("/api/account/content/comments/delete", { id: root }, a)).statusCode,
        201,
      );
      assert.equal(
        (await f.get("/api/account/content/comments?postId=" + p))
          .json()
          .items.find((c) => c.id === root).body,
        "",
      );
      assert.equal((await f.get("/api/account/content/posts/" + p)).json().commentCount, 1);
      const adult = (
        await f.write(a, { body: "ADULT_PRIVATE_TEXT", labels: ["18+", "nsfw"] })
      ).json().id;
      assert.equal((await f.get("/api/account/content/posts/" + adult, a)).statusCode, 404);
      assert.equal(
        (await f.post("/api/account/content/preferences", { enabled: true, confirmed18: false }, b))
          .statusCode,
        400,
      );
      await f.post("/api/account/content/preferences", { enabled: true, confirmed18: true }, b);
      assert.equal((await f.get("/api/account/content/posts/" + adult, b)).statusCode, 200);
      const mature = (
        await f.comment(b, { animeId: f.animeId }, { labels: ["18+"], body: "MATURE_PARENT" })
      ).json().id;
      await f.comment(b, { animeId: f.animeId }, { parentId: mature, body: "MATURE_REPLY" });
      assert.equal(
        (await f.get("/api/account/content/comments?animeId=" + f.animeId)).body.includes(
          "MATURE_",
        ),
        false,
      );
      await f.db.userProfile.update({
        where: { userId: b.id },
        data: { preferences: { adultContent: false } },
      });
      assert.equal((await f.get("/api/account/content/posts/" + adult, b)).statusCode, 404);
    } finally {
      await f.close();
    }
  },
);
test(
  "content pagination is stable and unpublished/disabled/private records stay out of lists",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user();
      await f.db.post.createMany({
        data: Array.from({ length: 23 }, (_, i) => ({
          authorId: a.id,
          title: "Заметка " + i,
          body: "Осмысленный текст",
          audience: "public",
          tags: [],
          labels: [],
          createdAt: new Date(1700000000000 + i * 1000),
        })),
      });
      const one = (await f.get("/api/account/content/posts?authorId=" + a.id)).json();
      assert.equal(one.items.length, 20);
      const q = new URLSearchParams({ authorId: a.id, ...one.next });
      const two = (await f.get("/api/account/content/posts?" + q)).json();
      assert.equal(two.items.length, 3);
      assert.equal(new Set([...one.items, ...two.items].map((p) => p.id)).size, 23);
      await f.db.user.update({ where: { id: a.id }, data: { disabledAt: new Date() } });
      assert.equal((await f.get("/api/account/content/posts/" + one.items[0].id)).statusCode, 404);
    } finally {
      await f.close();
    }
  },
);
test(
  "anime community combines title, episode and post discussions while enforcing audiences and blocks",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user();
      const postId = (await f.write(a, { animeId: f.animeId })).json().id;
      const privatePost = (await f.write(a, { animeId: f.animeId, audience: "private" })).json().id;
      const title = (await f.comment(a, { animeId: f.animeId })).json().id;
      const episode = (await f.comment(a, { episodeId: f.episodeId })).json().id;
      const post = (await f.comment(a, { postId })).json().id;
      const hidden = (
        await f.comment(a, { postId: privatePost }, { body: "HIDDEN_POST_COMMENT" })
      ).json().id;
      const direct = (await f.get("/api/account/content/comments?animeId=" + f.animeId)).json()
        .items;
      assert.deepEqual(
        direct.map((c) => c.id),
        [title],
      );
      const route = `/api/account/content/comments?animeId=${f.animeId}&discussions=all`;
      const combined = await f.get(route, b);
      assert.equal(combined.statusCode, 200);
      assert.deepEqual(
        combined
          .json()
          .items.map((c) => c.id)
          .sort(),
        [title, episode, post].sort(),
      );
      assert.equal(combined.body.includes("HIDDEN_POST_COMMENT"), false);
      assert.ok((await f.get(route, a)).json().items.some((c) => c.id === hidden));
      assert.equal(
        (await f.comment(b, { episodeId: f.episodeId }, { parentId: episode })).statusCode,
        201,
      );
      await f.db.userBlock.create({ data: { blockerId: a.id, targetId: b.id } });
      assert.equal((await f.get(route, b)).json().items.length, 0);
    } finally {
      await f.close();
    }
  },
);

test(
  "popular tags aggregate the whole period and only accessible public posts",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user(),
        disabled = await f.user();
      const tag = randomUUID().replaceAll("-", ""),
        oldTag = "old" + tag.slice(0, 12);
      const now = Date.now();
      const data = (extra = {}) => ({
        authorId: a.id,
        title: "Тема",
        body: "Публичный текст",
        tags: [tag],
        labels: [],
        ...extra,
      });
      await f.db.post.createMany({
        data: [
          ...Array.from({ length: 45 }, () => data()),
          data({ createdAt: new Date(now - 2 * 86400000) }),
          data({ createdAt: new Date(now - 8 * 86400000), tags: [tag, oldTag] }),
          data({ createdAt: new Date(now - 31 * 86400000) }),
          data({ audience: "friends" }),
          data({ audience: "private" }),
          data({ deletedAt: new Date() }),
          data({ labels: ["18+"] }),
          data({ authorId: disabled.id }),
          data({ animeId: f.animeId }),
        ],
      });
      await f.db.user.update({ where: { id: disabled.id }, data: { disabledAt: new Date() } });
      await f.db.anime.update({ where: { id: f.animeId }, data: { published: false } });
      for (const [period, count] of [
        ["day", 45],
        ["week", 46],
        ["month", 47],
      ]) {
        const response = await f.get("/api/account/content/tags?period=" + period);
        assert.equal(response.statusCode, 200, response.body);
        const result = response.json();
        assert.equal(result.items.find((item) => item.tag === tag)?.count, count);
        assert.equal(result.period, period);
        assert.ok(Date.parse(result.since) < Date.parse(result.until));
      }
      const own = (await f.get("/api/account/content/tags", a)).json();
      assert.equal(own.items.find((item) => item.tag === tag)?.count, 46);
      await f.db.userBlock.create({ data: { blockerId: a.id, targetId: b.id } });
      assert.equal(
        (await f.get("/api/account/content/tags", b)).json().items.some((item) => item.tag === tag),
        false,
      );
      assert.equal((await f.get("/api/account/content/tags?period=year")).statusCode, 400);
      assert.equal((await f.get("/api/account/content/tags?limit=51")).statusCode, 400);
      assert.equal((await f.get("/api/account/content/tags?limit=1")).json().items.length, 1);
    } finally {
      await f.close();
    }
  },
);

test(
  "ranked post feeds support filters, visible comment totals and tied keyset pagination",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user();
      const tag = randomUUID().replaceAll("-", ""),
        createdAt = new Date(Date.now() - 3600000);
      const rows = Array.from({ length: 26 }, (_, i) => ({
        id: randomUUID(),
        authorId: a.id,
        animeId: f.animeId,
        title: i === 0 ? "Уникальный ЗАГОЛОВОК" : "Тема " + i,
        body: i === 1 ? "Уникальное СОДЕРЖИМОЕ %_" : "Содержательный текст",
        kind: i === 2 ? "episode" : "text",
        episodeId: i === 2 ? f.episodeId : null,
        tags: [tag],
        labels: [],
        createdAt,
      }));
      await f.db.post.createMany({ data: rows });
      const comments = rows.flatMap((p, i) =>
        Array.from({ length: i % 4 }, () => ({
          id: randomUUID(),
          authorId: b.id,
          postId: p.id,
          body: "Комментарий",
          labels: [],
          createdAt: new Date(createdAt.getTime() + ((i % 5) + 1) * 1000),
        })),
      );
      await f.db.comment.createMany({ data: comments });
      await f.db.post.createMany({
        data: [
          { ...rows[0], id: randomUUID(), audience: "private" },
          { ...rows[0], id: randomUUID(), labels: ["18+"] },
          { ...rows[0], id: randomUUID(), deletedAt: new Date() },
        ],
      });
      for (const sort of ["new", "discussed", "top"]) {
        const seen = [],
          query = { tag, sort, animeId: f.animeId };
        let next;
        do {
          const response = await f.get(
            "/api/account/content/posts?" + new URLSearchParams({ ...query, ...next }),
          );
          assert.equal(response.statusCode, 200, response.body);
          seen.push(...response.json().items);
          next = response.json().next;
        } while (next);
        assert.equal(seen.length, rows.length);
        assert.equal(new Set(seen.map((p) => p.id)).size, rows.length);
        const expected = [...rows].sort((left, right) => {
          const metric = (p) => {
            const list = comments.filter((c) => c.postId === p.id);
            return sort === "top"
              ? list.length
              : sort === "discussed"
                ? Math.max(createdAt.getTime(), ...list.map((c) => c.createdAt.getTime()))
                : 0;
          };
          return metric(right) - metric(left) || right.id.localeCompare(left.id);
        });
        assert.deepEqual(
          seen.map((p) => p.id),
          expected.map((p) => p.id),
          sort,
        );
        for (const p of seen)
          assert.equal(p.commentCount, comments.filter((c) => c.postId === p.id).length);
        for (const [q, id] of [
          ["заголовок", rows[0].id],
          ["содержимое", rows[1].id],
          ["%_", rows[1].id],
        ]) {
          const response = await f.get(
            "/api/account/content/posts?" + new URLSearchParams({ tag, sort, q }),
          );
          assert.equal(response.statusCode, 200, response.body);
          assert.deepEqual(
            response.json().items.map((p) => p.id),
            [id],
          );
        }
        const episodes = await f.get(
          "/api/account/content/posts?" + new URLSearchParams({ tag, sort, kind: "episode" }),
        );
        assert.deepEqual(
          episodes.json().items.map((p) => p.id),
          [rows[2].id],
        );
      }
      const root = comments[0];
      await f.db.comment.createMany({
        data: [
          { authorId: a.id, postId: root.postId, parentId: root.id, body: "Ответ", labels: [] },
          {
            authorId: a.id,
            postId: root.postId,
            body: "Удалён",
            labels: [],
            deletedAt: new Date(),
          },
          { authorId: a.id, postId: root.postId, body: "Только взрослым", labels: ["18+"] },
        ],
      });
      await f.db.userBlock.create({ data: { blockerId: a.id, targetId: b.id } });
      const direct = (await f.get("/api/account/content/posts/" + root.postId, a)).json();
      assert.equal(direct.commentCount, 0); // The reply's blocked parent also hides the reply.
      const ranked = (
        await f.get("/api/account/content/posts?" + new URLSearchParams({ tag, sort: "top" }), a)
      ).json();
      assert.ok(ranked.items.every((p) => p.commentCount === 0));
      await f.db.userProfile.update({
        where: { userId: a.id },
        data: { visibility: { posts: "public", reviews: "private", comments: "public" } },
      });
      await f.write(a, { kind: "review", animeId: f.animeId });
      for (const sort of ["new", "discussed", "top"]) {
        assert.equal(
          (
            await f.get(
              "/api/account/content/posts?" +
                new URLSearchParams({ authorId: a.id, kind: "review", sort }),
            )
          ).statusCode,
          404,
        );
      }
      assert.equal(
        (
          await f.get(
            "/api/account/content/posts?sort=top&before=" +
              createdAt.toISOString() +
              "&beforeId=" +
              rows[0].id,
          )
        ).statusCode,
        400,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "global comments paginate across targets, omit stubs and protect private discussions",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        disabled = await f.user(),
        marker = randomUUID();
      const publicPost = (await f.write(a)).json().id;
      const privatePost = (await f.write(a, { audience: "private" })).json().id;
      const friendsPost = (await f.write(a, { audience: "friends" })).json().id;
      const parentId = randomUUID(),
        replyId = randomUUID();
      await f.db.comment.createMany({
        data: [
          ...Array.from({ length: 53 }, () => ({
            authorId: a.id,
            animeId: f.animeId,
            body: marker,
            labels: [],
          })),
          {
            id: parentId,
            authorId: a.id,
            postId: publicPost,
            body: "",
            labels: [],
            deletedAt: new Date(),
          },
          { id: replyId, authorId: a.id, postId: publicPost, parentId, body: marker, labels: [] },
          { authorId: a.id, episodeId: f.episodeId, body: marker, labels: [] },
          { authorId: a.id, postId: privatePost, body: marker, labels: [] },
          { authorId: a.id, postId: friendsPost, body: marker, labels: [] },
          { authorId: a.id, animeId: f.animeId, body: marker, labels: ["nsfw"] },
          { authorId: disabled.id, animeId: f.animeId, body: marker, labels: [] },
        ],
      });
      await f.db.user.update({ where: { id: disabled.id }, data: { disabledAt: new Date() } });
      const first = await f.get("/api/account/content/comments?q=" + marker, a);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().items.length, 50);
      const second = await f.get(
        "/api/account/content/comments?" + new URLSearchParams({ q: marker, ...first.json().next }),
        a,
      );
      const all = [...first.json().items, ...second.json().items];
      assert.equal(all.length, 55);
      assert.equal(new Set(all.map((c) => c.id)).size, 55);
      assert.ok(all.every((c) => !c.deleted && ![privatePost, friendsPost].includes(c.postId)));
      assert.ok(all.some((c) => c.id === replyId && c.href === "/posts/" + publicPost));
      assert.ok(all.some((c) => c.episodeId === f.episodeId && c.href.includes("/episodes/")));
      assert.ok(
        (await f.get("/api/account/content/comments?postId=" + publicPost))
          .json()
          .items.some((c) => c.id === parentId && c.deleted),
      );
      assert.equal((await f.get("/api/account/content/comments")).statusCode, 200);
      await f.db.anime.update({ where: { id: f.animeId }, data: { published: false } });
      const hiddenAnime = (await f.get("/api/account/content/comments?q=" + marker)).json();
      assert.deepEqual(
        hiddenAnime.items.map((c) => c.id),
        [replyId],
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "community pins require an administrator, MFA, CSRF and idempotent audited writes",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const author = await f.user(),
        admin = await f.user({ role: "admin", audience: "admin" });
      const member = await f.user({ audience: "admin" }),
        noMfa = await f.user({ role: "admin", audience: "admin", mfa: false });
      const id = (await f.write(author)).json().id,
        other = (await f.write(author)).json().id;
      const route = "/api/admin/platform/community/posts/" + id + "/pin";
      const input = { operationId: randomUUID(), reason: "Правила сообщества", pinned: true };
      for (const actor of [undefined, author, member, noMfa])
        assert.ok([401, 403].includes((await f.post(route, input, actor)).statusCode));
      assert.equal(
        (await f.post(route, input, admin, { "x-csrf-token": "wrong" })).statusCode,
        403,
      );
      assert.equal((await f.write(author, { pinned: true })).statusCode, 400);
      for (let i = 0; i < 2; i++) assert.equal((await f.post(route, input, admin)).statusCode, 201);
      assert.equal(await f.db.auditEvent.count({ where: { operationId: input.operationId } }), 1);
      const collision = await f.post(
        "/api/admin/platform/community/posts/" + other + "/pin",
        input,
        admin,
      );
      assert.equal(collision.statusCode, 409);
      assert.equal((await f.get("/api/account/content/posts/" + id)).json().pinned, true);
      assert.deepEqual(
        (await f.get("/api/account/content/posts?pinned=true")).json().items.map((p) => p.id),
        [id],
      );
      assert.equal(
        (await f.get("/api/account/content/posts?pinned=false"))
          .json()
          .items.some((p) => p.id === id),
        false,
      );
      assert.equal(
        (await f.post(route, { ...input, operationId: randomUUID(), pinned: false }, admin))
          .statusCode,
        201,
      );
      assert.equal((await f.get("/api/account/content/posts/" + id)).json().pinned, false);
      await f.post(route, { ...input, operationId: randomUUID() }, admin);
      await f.write(author, { id, audience: "private" });
      assert.equal((await f.db.post.findUnique({ where: { id } })).pinned, false);
      assert.equal(
        (await f.post(route, { ...input, operationId: randomUUID() }, admin)).statusCode,
        400,
      );
    } finally {
      await f.close();
    }
  },
);
