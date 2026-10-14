import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { csrfToken, digest, randomToken } from "../apps/api/dist/auth/security.js";
const connection = process.env.TEST_DATABASE_URL;
async function fixture() {
  const url = new URL(connection);
  assert.match(url.pathname, /_test$/);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const db = createDatabase(connection),
    users = [],
    animeIds = [],
    ip = "127.0.0." + (10 + Math.floor(Math.random() * 200));
  const config = readConfig({ NODE_ENV: "test", DATABASE_URL: connection });
  const app = await createApplication(config),
    server = app.getHttpAdapter().getInstance();
  const get = (path, user = {}) =>
    server.inject({
      method: "GET",
      url: path,
      remoteAddress: ip,
      headers: { cookie: user.cookie ?? "" },
    });
  const post = (path, body, user = {}, origin = "http://localhost:8021") =>
    server.inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      payload: body,
      headers: {
        origin,
        "x-animesoul-request": "1",
        "x-csrf-token": user.csrf ?? "",
        cookie: user.cookie ?? "",
      },
    });
  async function user(overrides = {}) {
    const id = randomUUID(),
      username = "social-" + id.slice(0, 25),
      token = randomToken();
    users.push(id);
    await db.user.create({
      data: {
        id,
        passwordHash: "fixture-password-hash",
        email: username + "@example.invalid",
        profile: {
          create: {
            username,
            usernameKey: username,
            isPublic: true,
            profileAccess: "public",
            visibility: {
              about: false,
              favorites: false,
              folders: false,
              ratings: false,
              statistics: false,
            },
            content: {},
            ...overrides,
          },
        },
        sessions: {
          create: { tokenHash: digest(token), expiresAt: new Date(Date.now() + 600000) },
        },
      },
    });
    return { id, username, cookie: "animesoul_web_session=" + token, csrf: csrfToken(token) };
  }
  const change = (actor, target, action) =>
    post("/api/account/social", { targetId: target.id, action }, actor);
  const profile = (owner, viewer = {}) => get("/api/account/profiles/" + owner.username, viewer);
  const list = (actor, section = "friends", after = "") =>
    get("/api/account/social?section=" + section + (after ? "&after=" + after : ""), actor);
  async function close() {
    await app.close();
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.anime.deleteMany({ where: { id: { in: animeIds } } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await db.authThrottle.deleteMany({
      where: { key: { in: users.map((id) => digest("social:" + id)) } },
    });
    await db.$disconnect();
  }
  return {
    db,
    app,
    config,
    server,
    users,
    animeIds,
    user,
    get,
    post,
    change,
    profile,
    list,
    close,
  };
}
test(
  "social changes enforce session, Origin/CSRF, actor identity and UUID constraints",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user();
      assert.equal((await f.change({}, b, "request")).statusCode, 401);
      assert.equal((await f.change({ ...a, csrf: "wrong" }, b, "request")).statusCode, 403);
      assert.equal(
        (
          await f.post(
            "/api/account/social",
            { targetId: b.id, action: "request" },
            a,
            "https://evil.invalid",
          )
        ).statusCode,
        403,
      );
      assert.equal((await f.change(a, a, "request")).statusCode, 400);
      assert.equal(
        (
          await f.post(
            "/api/account/social",
            { targetId: b.id, action: "request", actorId: b.id },
            a,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (await f.get("/api/account/social?section=friends&userId=" + b.id, a)).statusCode,
        400,
      );
      assert.equal((await f.get("/api/account/social/search?q=so")).statusCode, 401);
      assert.equal((await f.get("/api/account/social/search?q=%", a)).statusCode, 400);
      assert.equal((await f.change(a, { id: b.id.toUpperCase() }, "request")).statusCode, 201);
      assert.equal(
        (await f.get("/api/account/social/" + b.id.toUpperCase(), a)).json().state,
        "outgoing",
      );
      await f.db.session.updateMany({ where: { userId: a.id }, data: { revokedAt: new Date() } });
      assert.equal((await f.change(a, b, "block")).statusCode, 401);
    } finally {
      await f.close();
    }
  },
);
test(
  "friend requests preserve direction, cancel/decline/retry correctly and remain independent of follows",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user({
          about: "FRIEND_ONLY_ABOUT",
          visibility: {
            about: "friends",
            favorites: "private",
            folders: "private",
            ratings: "private",
            statistics: "private",
          },
        }),
        c = await f.user();
      assert.equal((await f.change(a, b, "request")).statusCode, 201);
      assert.equal((await f.change(a, b, "request")).statusCode, 201);
      assert.equal(await f.db.friendRequest.count({ where: { requestedBy: a.id } }), 1);
      assert.equal((await f.change(a, b, "accept")).statusCode, 409);
      assert.equal((await f.change(a, b, "decline")).statusCode, 403);
      assert.equal((await f.change(b, a, "cancel")).statusCode, 403);
      assert.equal((await f.change(c, b, "accept")).statusCode, 409);
      assert.equal((await f.list(b, "incoming")).json().items[0].id, a.id);
      assert.equal((await f.list(a, "outgoing")).json().items[0].id, b.id);
      assert.equal((await f.change(b, a, "decline")).statusCode, 201);
      await f.change(a, b, "request");
      await f.change(a, b, "cancel");
      assert.equal((await f.list(b, "incoming")).json().items.length, 0);
      await f.change(a, b, "follow");
      assert.equal((await f.profile(b, a)).body.includes("FRIEND_ONLY_ABOUT"), false);
      assert.equal((await f.list(a, "following")).json().items[0].id, b.id);
      assert.equal((await f.list(b, "followers")).json().items[0].id, a.id);
      await f.change(a, b, "request");
      assert.equal((await f.change(b, a, "accept")).statusCode, 201);
      assert.equal((await f.get("/api/account/social/" + b.id, a)).json().state, "friends");
      assert.equal((await f.profile(b, a)).json().about, "FRIEND_ONLY_ABOUT");
      await f.change(a, b, "unfriend");
      assert.equal((await f.profile(b, a)).json().about, undefined);
      assert.equal((await f.get("/api/account/social/" + b.id, a)).json().following, true);
      await f.change(a, b, "unfollow");
      assert.equal((await f.list(a, "following")).json().items.length, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  "crossed and concurrent requests serialize with accept/unfriend/block and enforce database pair invariants",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user();
      const responses = await Promise.all([
        f.change(a, b, "request"),
        f.change(b, a, "request"),
        f.change(a, b, "request"),
        f.change(b, a, "request"),
      ]);
      assert.ok(
        responses.every((r) => r.statusCode === 201),
        responses.map((r) => r.body).join("\n"),
      );
      assert.equal(await f.db.friendship.count(), 1);
      assert.equal(await f.db.friendRequest.count(), 0);
      const lowId = [a.id, b.id].sort()[0],
        highId = [a.id, b.id].sort()[1];
      await assert.rejects(f.db.friendship.create({ data: { lowId: highId, highId: lowId } }));
      await assert.rejects(
        f.db.friendRequest.create({ data: { lowId, highId, requestedBy: randomUUID() } }),
      );
      await Promise.all([f.change(a, b, "follow"), f.change(b, a, "follow")]);
      await f.change(a, b, "unfriend");
      await f.change(a, b, "request");
      const race = await Promise.all([
        f.change(b, a, "accept"),
        f.change(a, b, "block"),
        f.change(b, a, "follow"),
      ]);
      assert.ok(race.every((r) => [201, 404].includes(r.statusCode)));
      assert.equal(await f.db.friendship.count(), 0);
      assert.equal(await f.db.friendRequest.count(), 0);
      assert.equal(await f.db.follow.count(), 0);
      assert.equal((await f.list(a, "blocked")).json().items[0].id, b.id);
      assert.equal((await f.get("/api/account/social/" + a.id, b)).statusCode, 404);
      assert.equal((await f.profile(a, b)).statusCode, 404);
      assert.equal((await f.change(b, a, "request")).statusCode, 404);
      assert.equal(
        (await f.get("/api/account/social/search?q=" + a.username, b)).json().items.length,
        0,
      );
      assert.equal(
        (await f.get("/api/profiles/" + a.username)).statusCode,
        200,
        "public data remains available to guests",
      );
      await f.change(a, b, "unblock");
      assert.equal((await f.list(a)).json().items.length, 0);
      assert.equal((await f.list(a, "following")).json().items.length, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  "profile audiences protect friend/private sections, revoke access immediately and keep metadata guest-safe",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user(),
        b = await f.user(),
        c = await f.user();
      const edit = {
        username: b.username,
        about: "PRIVATE_SOCIAL_ABOUT",
        presence: "invisible",
        isPublic: true,
        indexable: true,
        profileAccess: "public",
        friendRequests: "nobody",
        visibility: {
          about: "friends",
          favorites: "private",
          folders: "private",
          ratings: "private",
          statistics: "private",
          friends: "private",
          posts: "friends",
          reviews: "private",
          comments: "private",
        },
      };
      const updated = await f.post("/api/account/profile", edit, b);
      assert.equal(updated.statusCode, 201, updated.body);
      assert.equal((await f.change(a, b, "request")).statusCode, 403);
      edit.friendRequests = "everyone";
      await f.post("/api/account/profile", edit, b);
      await f.change(a, b, "request");
      await f.change(b, a, "accept");
      const guest = await f.get("/api/profiles/" + b.username),
        stranger = await f.profile(b, c),
        friend = await f.profile(b, a),
        owner = await f.profile(b, b);
      for (const response of [guest, stranger]) {
        assert.equal(response.body.includes(edit.about), false);
        assert.equal(response.json().friends, undefined);
        assert.equal(response.json().presence, "offline");
      }
      assert.equal(friend.json().about, edit.about);
      assert.equal(owner.json().about, edit.about);
      for (const marker of [
        "preferences",
        "passwordHash",
        "email",
        "csrfToken",
        "visibility",
        "profileAccess",
      ])
        assert.equal(friend.body.includes('"' + marker + '"'), false, marker);
      edit.profileAccess = "friends";
      edit.isPublic = false;
      await f.post("/api/account/profile", edit, b);
      assert.equal((await f.get("/api/profiles/" + b.username)).statusCode, 404);
      assert.equal((await f.profile(b, c)).statusCode, 404);
      assert.equal((await f.profile(b, a)).statusCode, 200);
      assert.equal((await f.get("/api/sitemap/profiles")).body.includes(b.username), false);
      assert.equal((await f.get("/api/account/profile", b)).json().indexable, false);
      await f.change(a, b, "unfriend");
      assert.equal((await f.profile(b, a)).statusCode, 404);
      assert.equal((await f.profile(b, b)).statusCode, 200);
      edit.profileAccess = "private";
      await f.post("/api/account/profile", edit, b);
      await f.db.user.update({ where: { id: b.id }, data: { disabledAt: new Date() } });
      assert.equal((await f.profile(b, b)).statusCode, 401);
    } finally {
      await f.close();
    }
  },
);
test(
  "lists paginate without exposing hidden profiles, and friend list visibility is enforced at its direct endpoint",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const a = await f.user({
          visibility: {
            about: false,
            favorites: false,
            folders: false,
            ratings: false,
            statistics: false,
            friends: "friends",
          },
        }),
        c = await f.user();
      const friend = await f.user();
      await f.change(a, friend, "request");
      await f.change(friend, a, "accept");
      assert.equal(
        (await f.get("/api/account/profiles/" + a.username + "/friends", c)).statusCode,
        404,
      );
      assert.equal((await f.profile(a, c)).json().friends, undefined);
      assert.equal((await f.profile(a, friend)).json().friends[0].id, friend.id);
      for (let i = 0; i < 52; i++) {
        const p = await f.user({ isPublic: false, profileAccess: "private" });
        const [lowId, highId] = [a.id, p.id].sort();
        await f.db.friendship.create({ data: { lowId, highId } });
      }
      const first = (await f.list(a)).json();
      assert.equal(first.items.length, 50);
      assert.ok(first.next);
      const second = (await f.list(a, "friends", first.next)).json();
      assert.equal(second.items.length, 3);
      assert.equal(second.next, null);
      assert.equal(new Set([...first.items, ...second.items].map((p) => p.id)).size, 53);
      assert.equal(
        (await f.profile(a, friend)).json().friends.length,
        1,
        "private identities are excluded from other viewers' lists",
      );
      assert.equal(
        (await f.get("/api/account/profiles/" + a.username + "/friends?after=" + first.next, c))
          .statusCode,
        404,
      );
      await f.change(a, friend, "block");
      assert.equal(
        (await f.list(a)).json().items.some((p) => p.id === friend.id),
        false,
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "social rate limits survive application restart and do not reuse authentication limits",
  { skip: !connection },
  async () => {
    const f = await fixture();
    let other;
    try {
      const a = await f.user(),
        b = await f.user();
      await f.db.authThrottle.create({ data: { key: digest("social:" + a.id), attempts: 60 } });
      other = await createApplication(f.config);
      const response = await other
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "POST",
          url: "/api/account/social",
          headers: {
            origin: "http://localhost:8021",
            "x-animesoul-request": "1",
            "x-csrf-token": a.csrf,
            cookie: a.cookie,
          },
          payload: { targetId: b.id, action: "request" },
        });
      assert.equal(response.statusCode, 429);
      assert.equal((await f.get("/api/account/social", a)).statusCode, 200);
      assert.equal((await f.change(b, a, "request")).statusCode, 201);
    } finally {
      await other?.close();
      await f.close();
    }
  },
);
