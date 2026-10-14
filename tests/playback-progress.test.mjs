import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { EpisodeService } from "../apps/api/dist/playback/episode.service.js";
import { DirectStreamService } from "../apps/api/dist/playback/direct-stream.service.js";
import { digest } from "../apps/api/dist/auth/security.js";
const connection = process.env.TEST_DATABASE_URL;
async function fixture() {
  const url = new URL(connection);
  assert.match(url.pathname, /_test$/);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const db = createDatabase(connection),
    animeId = randomUUID(),
    users = [],
    emails = [],
    ip = "127.0.0." + (10 + Math.floor(Math.random() * 200));
  const anime = await db.anime.create({
    data: {
      id: animeId,
      slug: "episode-test-" + animeId,
      title: "Episode test",
      originalTitle: "Episode test",
      description: "",
      year: 2026,
      genres: [],
      aliases: [],
      status: "released",
      published: true,
    },
  });
  const app = await createApplication(readConfig({ NODE_ENV: "test", DATABASE_URL: connection })),
    server = app.getHttpAdapter().getInstance();
  const post = (path, body, user = {}, origin = "http://localhost:8021") =>
    server.inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      payload: body,
      headers: {
        origin,
        "x-animesoul-request": "1",
        cookie: user.cookie ?? "",
        "x-csrf-token": user.csrf ?? "",
      },
    });
  const get = (path, user = {}) =>
    server.inject({
      method: "GET",
      url: path,
      remoteAddress: ip,
      headers: { cookie: user.cookie ?? "" },
    });
  async function register() {
    const username = "episode-" + randomUUID().slice(0, 30),
      email = username + "@example.invalid";
    emails.push(email);
    const response = await post("/api/auth/register", {
      username,
      email,
      password: "Playback testing пароль 2026",
    });
    assert.equal(response.statusCode, 201, response.body);
    const cookie = response.headers["set-cookie"].split(";")[0],
      me = (await get("/api/auth/me", { cookie })).json();
    users.push(me.id);
    return { cookie, csrf: me.csrfToken, id: me.id };
  }
  async function close() {
    await app.close();
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.episode.deleteMany({ where: { animeId } });
    await db.anime.delete({ where: { id: animeId } });
    await db.authThrottle.deleteMany({
      where: {
        key: {
          in: [
            digest("ip:" + ip),
            ...emails.map((email) => digest("identity:registration:" + email)),
          ],
        },
      },
    });
    await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await db.$disconnect();
  }
  return { db, app, anime, register, get, post, close };
}
function source(provider, id, season = "01", episode = "001") {
  return {
    provider,
    id,
    season,
    episode,
    player: "player",
    translation: "Dub",
    embedUrl: "https://kodik.info/seria/123/hash/720p",
  };
}
test(
  "episode identity survives translation/provider changes and rejects reassigned provider IDs",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const service = f.app.get(EpisodeService),
        a = source("kodik", "a"),
        b = source("yummy", "b", "1", "1");
      const original = (await service.register(f.anime.id, [a])).get("kodik:a");
      const mappings = await service.register(f.anime.id, [a, b, { ...a, id: "another-dub" }]);
      assert.equal(mappings.get("yummy:b"), original);
      assert.equal(mappings.get("kodik:another-dub"), original);
      assert.equal(await f.db.episode.count({ where: { animeId: f.anime.id } }), 1);
      await assert.rejects(
        service.register(f.anime.id, [{ ...a, episode: "2" }]),
        /mapping needs review/,
      );
      assert.equal(
        await f.db.episode.count({ where: { animeId: f.anime.id } }),
        1,
        "conflicted transaction rolled back",
      );
      const list = (await f.get(`/api/anime/${f.anime.slug}/episodes`)).json();
      assert.equal(list.episodes[0].id, original);
      assert.equal(list.episodes[0].number, "1");
      assert.equal(JSON.stringify(list).includes("kodik.info"), false);
      assert.equal(
        (await f.get(`/api/anime/${f.anime.slug}/episodes/${original}`)).statusCode,
        200,
      );
      const bucket = parseInt(original.slice(0, 2), 16);
      assert.ok(
        (await f.get(`/api/sitemap/episodes/${bucket}`))
          .json()
          .some((item) => item.id === original),
      );
      await f.db.anime.update({ where: { id: f.anime.id }, data: { isDevelopment: true } });
      assert.equal(
        (await f.get(`/api/sitemap/episodes/${bucket}`))
          .json()
          .some((item) => item.id === original),
        false,
      );
      await f.db.anime.update({ where: { id: f.anime.id }, data: { isDevelopment: false } });
      assert.equal((await f.get("/api/sitemap/episodes/256")).statusCode, 400);
      assert.equal((await f.get(`/api/anime/unknown/episodes/${original}`)).statusCode, 404);
      assert.equal((await f.get(`/api/anime/${f.anime.slug}/episodes/not-uuid`)).statusCode, 400);
      await f.db.anime.update({ where: { id: f.anime.id }, data: { published: false } });
      assert.equal(
        (await f.get(`/api/sitemap/episodes/${bucket}`))
          .json()
          .some((item) => item.id === original),
        false,
      );
      assert.equal(
        (await f.get(`/api/anime/${f.anime.slug}/episodes/${original}`)).statusCode,
        404,
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "progress isolates users, authenticates CSRF, bounds watched time and ignores stale tabs/events",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const owner = await f.register(),
        other = await f.register();
      const mappings = await f.app
        .get(EpisodeService)
        .register(f.anime.id, [source("kodik", "first"), source("kodik", "second", "1", "2")]);
      const episodeId = mappings.get("kodik:first"),
        sessionPath = "/api/account/playback/session";
      assert.equal((await f.post(sessionPath, { episodeId })).statusCode, 401);
      assert.equal(
        (await f.post(sessionPath, { episodeId }, { ...owner, csrf: "wrong" })).statusCode,
        403,
      );
      assert.equal(
        (await f.post(sessionPath, { episodeId }, owner, "https://foreign.example")).statusCode,
        403,
      );
      assert.equal((await f.post(sessionPath, { episodeId: randomUUID() }, owner)).statusCode, 404);
      const first = await f.post(sessionPath, { episodeId }, owner);
      assert.equal(first.statusCode, 201, first.body);
      const sessionId = first.json().sessionId;
      await f.db.playbackSession.update({
        where: { id: sessionId },
        data: { lastEventAt: new Date(Date.now() - 5000) },
      });
      const input = {
        sessionId,
        sequence: 1,
        position: 100,
        duration: 120,
        watchedDelta: 30,
        completed: false,
        dubbing: "Dub",
      };
      assert.equal((await f.post("/api/account/playback/progress", input, other)).statusCode, 404);
      const save = await f.post("/api/account/playback/progress", input, owner);
      assert.equal(save.statusCode, 201, save.body);
      let row = await f.db.episodeProgress.findFirst({ where: { userId: owner.id, episodeId } });
      assert.equal(row.position, 100);
      assert.equal(row.details.dubbing, "Dub");
      assert.equal(
        (await f.get(`/api/account/playback/${f.anime.id}`, owner)).json().progress[0].dubbing,
        "Dub",
      );
      assert.ok(row.watchedSeconds >= 5 && row.watchedSeconds < 7, row.watchedSeconds);
      assert.equal(
        (await f.post("/api/account/playback/progress", { ...input, position: 20 }, owner)).json()
          .ignored,
        true,
      );
      assert.equal(
        (
          await f.post(
            "/api/account/playback/progress",
            { ...input, sequence: 2, position: 130 },
            owner,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await f.post(
            "/api/account/playback/progress",
            { ...input, sequence: 2, position: 20, completed: true },
            owner,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (await f.get(`/api/account/playback/${f.anime.id}`, other)).json().progress.length,
        0,
      );
      const newer = (await f.post(sessionPath, { episodeId }, owner)).json().sessionId;
      assert.equal(
        (await f.post("/api/account/playback/progress", { ...input, sequence: 2 }, owner)).json()
          .ignored,
        true,
      );
      const complete = await f.post(
        "/api/account/playback/progress",
        { ...input, sessionId: newer, position: 120, completed: true },
        owner,
      );
      assert.equal(complete.json().ignored, false);
      row = await f.db.episodeProgress.findFirst({ where: { userId: owner.id, episodeId } });
      assert.equal(row.completed, true);
      assert.equal(row.position, 120);
      assert.ok(row.watchedSeconds < 7);
      const library = (await f.get("/api/account/library", owner)).json();
      assert.equal(library.progress[0].episode.number, "1");
      assert.equal(JSON.stringify(library).includes("activePlaybackId"), false);
      await f.db.playbackSession.update({ where: { id: newer }, data: { expiresAt: new Date(0) } });
      assert.equal(
        (
          await f.post(
            "/api/account/playback/progress",
            { ...input, sessionId: newer, sequence: 2 },
            owner,
          )
        ).statusCode,
        404,
      );
      await f.post("/api/auth/logout", {}, owner);
      assert.equal((await f.get(`/api/account/playback/${f.anime.id}`, owner)).statusCode, 401);
    } finally {
      await f.close();
    }
  },
);
test(
  "player settings preserve other preferences, isolate accounts and remember an explicit title voice",
  { skip: !connection },
  async () => {
    const f = await fixture();
    try {
      const owner = await f.register(),
        other = await f.register();
      const path = "/api/account/player";
      assert.equal((await f.get(path)).statusCode, 401);
      assert.deepEqual((await f.get(path, owner)).json(), {
        preferences: { resume: true, autoplay: false, favoriteDubbings: [] },
        dubbing: null,
      });
      await f.db.userProfile.update({
        where: { userId: owner.id },
        data: { preferences: { adultContent: true, demoDataset: "preserve-me" } },
      });
      assert.equal(
        (await f.post(path + "/preferences", { autoplay: true }, { ...owner, csrf: "wrong" }))
          .statusCode,
        403,
      );
      assert.equal(
        (await f.post(path + "/preferences", { favoriteDubbings: ["Injected"] }, owner)).statusCode,
        400,
      );
      assert.equal(
        (await f.post(path + "/preferences", { autoplay: true }, owner)).statusCode,
        201,
      );
      await Promise.all([
        f.post(path + "/favorite", { dubbing: "AniLibria.TV", favorite: true }, owner),
        f.post(path + "/favorite", { dubbing: "Dream Cast", favorite: true }, owner),
        f.post(path + "/preferences", { resume: false }, owner),
      ]);
      const state = (await f.get(path, owner)).json();
      assert.equal(state.preferences.autoplay, true);
      assert.equal(state.preferences.resume, false);
      assert.deepEqual([...state.preferences.favoriteDubbings].sort(), [
        "AniLibria.TV",
        "Dream Cast",
      ]);
      assert.equal((await f.get(path, other)).json().preferences.favoriteDubbings.length, 0);
      await f.post(path + "/favorite", { dubbing: "anilibria.tv", favorite: true }, owner);
      assert.equal((await f.get(path, owner)).json().preferences.favoriteDubbings.length, 2);
      assert.equal(
        (await f.post(path + "/dubbing", { animeId: randomUUID(), dubbing: "Dub" }, owner))
          .statusCode,
        404,
      );
      await f.post(path + "/dubbing", { animeId: f.anime.id, dubbing: "Manual Dub" }, owner);
      const episodeId = (
        await f.app.get(EpisodeService).register(f.anime.id, [source("kodik", "voice")])
      ).get("kodik:voice");
      const sessionId = (await f.post("/api/account/playback/session", { episodeId }, owner)).json()
        .sessionId;
      const payload = {
        sessionId,
        sequence: 3,
        position: 600,
        duration: 1400,
        completed: false,
        watchedDelta: 0,
        dubbing: "Actual Dub",
      };
      await f.post("/api/account/playback/progress", payload, owner);
      assert.equal(
        (
          await f.post(
            "/api/account/playback/progress",
            { ...payload, sequence: 2, position: 50 },
            owner,
          )
        ).json().ignored,
        true,
      );
      const progress = (await f.get(`/api/account/playback/${f.anime.id}`, owner)).json()
        .progress[0];
      assert.equal(progress.position, 600);
      assert.equal(progress.dubbing, "Actual Dub");
      assert.equal(
        (await f.get(path + "?animeId=" + f.anime.id, owner)).json().dubbing,
        "Manual Dub",
        "a progress write must not erase a manual title preference",
      );
      assert.equal((await f.get(path + "?animeId=" + f.anime.id, other)).json().dubbing, null);
      const profile = await f.db.userProfile.findUnique({ where: { userId: owner.id } });
      assert.equal(profile.preferences.adultContent, true);
      assert.equal(profile.preferences.demoDataset, "preserve-me");
      await f.post(path + "/dubbing", { animeId: f.anime.id, dubbing: null }, owner);
      assert.equal((await f.get(path + "?animeId=" + f.anime.id, owner)).json().dubbing, null);
    } finally {
      await f.close();
    }
  },
);
function directFixture(
  overrides = {},
  reply = { links: { 720: [{ Src: "https://media.example.com/video.m3u8", Type: "hls" }] } },
) {
  const calls = [],
    config = readConfig({
      NODE_ENV: "test",
      ALLOW_KODIK_DIRECT: "true",
      KODIK_PRIVATE_KEY: "PRIVATE_SECRET",
      KODIK_TOKEN: "PUBLIC_SECRET",
      ...overrides,
    });
  let enabled = true;
  const providers = {
    state: async () => (enabled ? "enabled" : "disabled"),
    hidesCredential: (url) => url.includes(config.KODIK_TOKEN),
  };
  const playback = {
    find: async () => ({
      sources: [{ id: "a".repeat(24), embedUrl: "https://kodik.info/seria/123/hash/720p" }],
    }),
  };
  const service = new DirectStreamService(
    config,
    async (url, options) => {
      calls.push({ url: new URL(url), options });
      return Response.json(reply);
    },
    providers,
    playback,
    { access: async (userId) => ({ nativeAccess: userId === "test-viewer" }) },
  );
  return {
    service: { resolve: (...args) => service.resolve(...args, "test-viewer") },
    rawService: service,
    calls,
    config,
    disable: () => {
      enabled = false;
    },
  };
}
test("direct playback signs a fixed upstream request and never accepts caller URLs or exposes secrets", async () => {
  const f = directFixture(),
    result = await f.service.resolve("anime", "a".repeat(24), "8.8.8.8");
  assert.equal(result.mode, "direct");
  assert.equal(f.calls.length, 1);
  const { url, options } = f.calls[0];
  assert.equal(url.origin + url.pathname, "https://kodikres.com/api/video-links");
  assert.equal(options.redirect, "error");
  assert.equal(url.searchParams.get("ip"), "8.8.8.8");
  assert.equal(url.searchParams.get("d").length, 10);
  assert.equal(
    url.searchParams.get("s"),
    createHmac("sha256", f.config.KODIK_PRIVATE_KEY)
      .update(`${url.searchParams.get("link")}:8.8.8.8:${url.searchParams.get("d")}`)
      .digest("hex"),
  );
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
  assert.equal(
    (await f.service.resolve("anime", "https://localhost/secret", "8.8.8.8")).mode,
    "embed",
  );
  assert.equal(f.calls.length, 1);
  f.disable();
  assert.equal((await f.service.resolve("anime", "a".repeat(24), "8.8.8.8")).mode, "embed");
  assert.equal(f.calls.length, 1);
});
test("direct playback degrades safely for missing keys, local URLs, restricted hosts and oversized payloads", async () => {
  for (const options of [{ KODIK_PRIVATE_KEY: "" }, { ALLOW_KODIK_DIRECT: "false" }]) {
    const f = directFixture(options);
    assert.equal((await f.service.resolve("a", "a".repeat(24), "8.8.8.8")).mode, "embed");
    assert.equal(f.calls.length, 0);
  }
  for (const url of [
    "http://media.example.com/v",
    "https://127.0.0.1/v",
    "https://media.local/v",
    "https://user:pass@media.example.com/v",
    "https://media.example.com/PUBLIC_SECRET",
    "https://media.example.com/PRIVATE_SECRET",
  ]) {
    const f = directFixture({}, { links: { 720: [{ src: url }] } });
    assert.equal((await f.service.resolve("a", "a".repeat(24), "8.8.8.8")).mode, "embed", url);
  }
  const restricted = directFixture({ KODIK_MEDIA_HOSTS: "allowed.example.com" });
  assert.equal((await restricted.service.resolve("a", "a".repeat(24), "8.8.8.8")).mode, "embed");
  const huge = directFixture({}, { links: {}, padding: "x".repeat(1048577) });
  assert.equal((await huge.service.resolve("a", "a".repeat(24), "8.8.8.8")).mode, "embed");
});
test("production direct playback requires a real viewer address and forbids a fixed development IP", async () => {
  const env = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://x:x@localhost/db",
    SITE_URL: "https://site.example.com",
    ADMIN_URL: "https://admin.example.com",
    MFA_ENCRYPTION_KEY: "a".repeat(64),
  };
  assert.throws(() => readConfig({ ...env, KODIK_VIEWER_IP: "8.8.8.8" }), /fixed viewer IP/);
  const f = directFixture(env);
  assert.equal((await f.service.resolve("a", "a".repeat(24), "127.0.0.1")).mode, "embed");
  assert.equal(f.calls.length, 0);
});
