import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import {
  normalizeKodikAnime,
  kodikPage,
  saveImportedKodikAnime,
} from "../apps/api/dist/providers/kodik-catalog.js";
import { saveImportedAnime } from "../apps/api/dist/providers/catalog-import.js";
const connectionString = process.env.TEST_DATABASE_URL,
  option = { skip: !connectionString };
function row(id, title = "Example title", shiki = id) {
  return {
    id: "serial-" + id,
    type: "anime-serial",
    shikimori_id: String(shiki),
    year: 2026,
    translation: { title: "Studio" },
    material_data: {
      anime_title: title,
      title_en: title,
      year: 2026,
      anime_genres: ["Adventure"],
      anime_status: "ongoing",
    },
    link: "//kodik.info/serial/" + id + "/hash",
    seasons: { 1: { episodes: { 1: "//kodik.info/seria/" + id + "/hash" } } },
  };
}
test("Kodik metadata excludes playback URLs and groups translations by material ID", () => {
  const raw = row(1200);
  raw.material_data.anime_poster_url = "https://images.example.invalid/poster.jpg";
  const a = normalizeKodikAnime(raw),
    b = normalizeKodikAnime({ ...raw, id: "serial-1201", translation: { title: "Other studio" } });
  assert.equal(a.anime.id, b.anime.id);
  assert.equal(a.providers[0].externalId, "shikimori:1200");
  assert.equal(a.anime.status, "ongoing");
  assert.equal(a.anime.poster, raw.material_data.anime_poster_url);
  assert.equal(JSON.stringify(a).includes("kodik.info"), false);
  assert.equal(
    normalizeKodikAnime({ ...raw, shikimori_id: null, kinopoisk_id: null }).providers[0].externalId,
    "release:serial-1200",
  );
  assert.throws(() => normalizeKodikAnime({ ...raw, id: "https://video.invalid/file" }));
});
test("Kodik pagination strips tokens and rejects forged, malformed and repeated cursors", () => {
  const raw = row(1230),
    page = {
      results: [raw],
      total: 1,
      next_page: "https://kodik-api.com/list?token=SECRET&next=cursor-A",
    };
  assert.equal(kodikPage(page, null).next, "cursor-A");
  assert.equal(JSON.stringify(kodikPage(page, null)).includes("SECRET"), false);
  for (const next of [
    "https://attacker.invalid/list?next=A",
    "http://kodik-api.com/list?next=A",
    "https://kodik-api.com.attacker.invalid/list?next=A",
    "https://u:p@kodik-api.com/list?next=A",
    "https://kodik-api.com/search?next=A",
    "https://kodik-api.com/list?next=A%26token%3DSECRET",
    "https://kodik-api.com/list?token=SECRET",
  ]) {
    assert.throws(() => kodikPage({ ...page, next_page: next }, null), /invalid-page/);
  }
  assert.throws(() => kodikPage(page, "cursor-A"), /invalid-page/);
  assert.throws(() => kodikPage({ ...page, results: [] }, null), /invalid-page/);
  assert.throws(() => kodikPage({ ...page, results: [raw, raw] }, null), /invalid-page/);
  assert.throws(() => kodikPage({ error: "SECRET" }, null), /invalid-page/);
  assert.equal(kodikPage({ results: [], next_page: null }, null).next, null);
});
async function fixture() {
  const url = new URL(connectionString);
  assert.match(url.pathname, /_test$/);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const db = createDatabase(connectionString),
    tag = randomUUID(),
    number = randomInt(20000000, 90000000),
    ids = [],
    users = [];
  const previous = await db.providerSetting.findMany({
    where: { key: { in: ["kodik", "yummy"] } },
  });
  for (const key of ["kodik", "yummy"])
    await db.providerSetting.upsert({
      where: { key },
      create: { key, enabled: true },
      update: { enabled: true },
    });
  const config = readConfig({
    NODE_ENV: "test",
    DATABASE_URL: connectionString,
    ALLOW_KODIK: "true",
    ALLOW_YUMMY: "true",
    KODIK_TOKEN: "KODIK_SECRET_SENTINEL",
    YUMMY_TOKEN: "YUMMY_SECRET_SENTINEL",
  });
  async function save(raw) {
    const saved = await saveImportedKodikAnime(db, raw);
    ids.push(saved.id);
    return saved;
  }
  async function legacy(id, title) {
    const raw = {
      anime_id: id,
      title,
      original: title,
      year: 2026,
      remote_ids: { shikimori_id: id },
    };
    const saved = await saveImportedAnime(db, raw);
    ids.push(saved.id);
    return saved;
  }
  async function close() {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.episode.deleteMany({ where: { animeId: { in: ids } } });
    await db.anime.deleteMany({ where: { id: { in: ids } } });
    for (const key of ["kodik", "yummy"]) {
      const old = previous.find((p) => p.key === key);
      if (old) await db.providerSetting.update({ where: { key }, data: { enabled: old.enabled } });
      else await db.providerSetting.deleteMany({ where: { key } });
    }
    await db.$disconnect();
  }
  return { db, tag, number, ids, users, config, save, legacy, close };
}
test(
  "Kodik deduplicates translations and preserves a matching legacy UUID, slug and library",
  option,
  async () => {
    const f = await fixture();
    try {
      const old = await f.legacy(f.number, f.tag);
      const before = await f.db.anime.findUnique({ where: { id: old.id } });
      const user = await f.db.user.create({
        data: {
          library: { create: { animeId: old.id, favorite: true, score: 8 } },
          episodeProgress: {
            create: { animeId: old.id, episodeKey: "1", position: 42, duration: 120 },
          },
        },
      });
      f.users.push(user.id);
      const first = await f.save(row(f.number, f.tag)),
        second = await f.save(row(f.number + 1, f.tag, f.number));
      assert.equal(first.id, old.id);
      assert.equal(second.id, old.id);
      assert.equal(await f.db.kodikRelease.count({ where: { animeId: old.id } }), 2);
      const after = await f.db.anime.findUnique({ where: { id: old.id } });
      assert.equal(after.slug, before.slug);
      assert.equal(after.metadataProvider, "kodik");
      assert.equal(
        (await f.db.libraryItem.findFirst({ where: { userId: user.id } })).favorite,
        true,
      );
      assert.equal(
        (await f.db.episodeProgress.findFirst({ where: { userId: user.id } })).position,
        42,
      );
      const mismatch = await f.legacy(f.number + 2, f.tag + " Season 2");
      const separate = await f.save(row(f.number + 2, f.tag + " Season 3"));
      assert.notEqual(separate.id, mismatch.id);
      assert.equal(
        (await f.db.anime.findUnique({ where: { id: mismatch.id } })).title,
        f.tag + " Season 2",
      );
      assert.equal(
        await f.db.providerMappingConflict.count({ where: { incomingAnimeId: separate.id } }),
        1,
      );
      const shared = await f.legacy(f.number + 3, f.tag + " Shared");
      await f.db.animeProvider.create({
        data: { animeId: shared.id, provider: "kinopoisk", externalId: String(f.number + 100) },
      });
      await f.db.providerMappingConflict.create({
        data: {
          provider: "shikimori",
          externalId: String(f.number + 4),
          incomingAnimeId: shared.id,
          previousExternalId: String(f.number + 3),
        },
      });
      const other = await f.save({
        ...row(f.number + 4, f.tag + " Shared"),
        kinopoisk_id: String(f.number + 100),
      });
      assert.notEqual(other.id, shared.id);
      assert.equal(
        (await f.db.anime.findUnique({ where: { id: shared.id } })).metadataProvider,
        "legacy",
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "Kodik playback is primary; anonymous viewers cannot select providers and fallback is automatic",
  option,
  async () => {
    const f = await fixture();
    let app;
    try {
      const legacy = await f.legacy(f.number, f.tag),
        raw = row(f.number, f.tag);
      await f.save(raw);
      const anime = await f.db.anime.findUnique({ where: { id: legacy.id } });
      let healthy = true;
      const calls = [];
      app = await createApplication(f.config, async (input) => {
        const url = new URL(String(input));
        calls.push(url.hostname + url.pathname);
        if (url.hostname === "kodik-api.com") {
          assert.equal(url.searchParams.get("shikimori_id"), String(f.number));
          return Response.json({ results: healthy ? [raw] : [] });
        }
        assert.equal(url.hostname, "api.yani.tv");
        assert.equal(url.pathname, "/anime/" + f.number + "/videos");
        return Response.json({
          response: [
            {
              video_id: 1,
              number: 1,
              iframe_url: "//kodik.info/seria/200/hash",
              data: { player: "Reserve", dubbing: "Studio" },
            },
          ],
        });
      });
      const server = app.getHttpAdapter().getInstance(),
        endpoint = "/api/anime/" + anime.slug + "/playback";
      let result = await server.inject({ url: endpoint });
      assert.equal(result.statusCode, 200);
      assert.equal(result.json().sources[0].translation, "Studio");
      assert.equal("provider" in result.json().sources[0], false);
      assert.equal("player" in result.json().sources[0], false);
      assert.equal("providers" in result.json(), false);
      assert.equal(
        calls.some((call) => call.startsWith("api.yani.tv")),
        false,
      );
      assert.equal(result.body.includes("KODIK_SECRET_SENTINEL"), false);
      calls.length = 0;
      result = await server.inject({ url: endpoint + "?provider=yummy" });
      assert.equal(result.statusCode, 400);
      assert.equal(calls.length, 0);
      assert.equal((await server.inject({ url: endpoint + "?provider=attacker" })).statusCode, 400);
      // A fresh application clears its short-lived upstream cache.
      await app.close();
      app = undefined;
      healthy = false;
      calls.length = 0;
      app = await createApplication(f.config, async (input) => {
        const url = new URL(String(input));
        calls.push(url.hostname + url.pathname);
        return Response.json(
          url.hostname === "kodik-api.com"
            ? { results: [] }
            : {
                response: [
                  {
                    video_id: 2,
                    number: 1,
                    iframe_url: "//kodik.info/seria/200/hash",
                    data: { player: "Reserve", dubbing: "Studio" },
                  },
                ],
              },
        );
      });
      result = await app.getHttpAdapter().getInstance().inject({ url: endpoint });
      assert.equal(result.json().sources[0].translation, "Studio");
      assert.equal("provider" in result.json().sources[0], false);
      assert.deepEqual(
        calls.map((call) => call.split("/")[0]),
        ["kodik-api.com", "api.yani.tv"],
      );
      await f.db.providerSetting.update({ where: { key: "yummy" }, data: { enabled: false } });
      calls.length = 0;
      result = await app.getHttpAdapter().getInstance().inject({ url: endpoint });
      assert.equal(result.json().sources.length, 0);
      assert.equal(
        calls.some((call) => call.startsWith("api.yani.tv")),
        false,
      );
      result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ url: endpoint + "?provider=yummy" });
      assert.equal(result.statusCode, 400);
      assert.equal(
        calls.some((call) => call.startsWith("api.yani.tv")),
        false,
      );
    } finally {
      await app?.close();
      await f.close();
    }
  },
);
test(
  "Playback reserve resolution checks exact IDs without importing Yummy metadata",
  option,
  async () => {
    const f = await fixture();
    let app;
    try {
      const saved = await f.save(row(f.number, f.tag));
      const anime = await f.db.anime.findUnique({ where: { id: saved.id } });
      const calls = [];
      app = await createApplication(f.config, async (input) => {
        const url = new URL(String(input));
        calls.push(url.hostname + url.pathname);
        if (url.hostname === "kodik-api.com") return Response.json({ results: [] });
        if (url.pathname === "/anime")
          return Response.json({
            response: [
              {
                anime_id: f.number + 1,
                title: f.tag,
                original: f.tag,
                year: 2026,
                remote_ids: { shikimori_id: f.number },
              },
            ],
          });
        return Response.json({
          response: [
            {
              video_id: 3,
              number: 1,
              iframe_url: "//kodik.info/seria/200/hash",
              data: { player: "Reserve", dubbing: "Studio" },
            },
          ],
        });
      });
      const result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ url: "/api/anime/" + anime.slug + "/playback" });
      assert.equal(result.json().sources[0].translation, "Studio");
      assert.deepEqual(calls, [
        "kodik-api.com/search",
        "api.yani.tv/anime",
        "api.yani.tv/anime/" + (f.number + 1) + "/videos",
      ]);
      assert.equal(
        await f.db.animeProvider.count({ where: { animeId: saved.id, provider: "yummy" } }),
        0,
      );
      assert.equal(
        (await f.db.anime.findUnique({ where: { id: saved.id } })).metadataProvider,
        "kodik",
      );
    } finally {
      await app?.close();
      await f.close();
    }
  },
);

test(
  "Kodik titles without third-party IDs use their native release ID for primary playback",
  option,
  async () => {
    const f = await fixture();
    let app;
    try {
      const raw = { ...row(f.number, f.tag), shikimori_id: null, kinopoisk_id: null },
        saved = await f.save(raw);
      const anime = await f.db.anime.findUnique({ where: { id: saved.id } });
      let calls = 0;
      app = await createApplication(f.config, async (input) => {
        const url = new URL(String(input));
        calls++;
        assert.equal(url.hostname, "kodik-api.com");
        assert.equal(url.searchParams.get("id"), raw.id);
        return Response.json({ results: [raw] });
      });
      const result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ url: "/api/anime/" + anime.slug + "/playback" });
      assert.equal(result.json().sources[0].translation, "Studio");
      assert.equal(calls, 1);
    } finally {
      await app?.close();
      await f.close();
    }
  },
);

test(
  "Reserve playback does not match another season through a shared Kinopoisk ID",
  option,
  async () => {
    const f = await fixture();
    let app;
    try {
      const raw = { ...row(f.number, f.tag), kinopoisk_id: String(f.number + 100) },
        saved = await f.save(raw);
      const anime = await f.db.anime.findUnique({ where: { id: saved.id } });
      let videos = 0;
      app = await createApplication(f.config, async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "kodik-api.com") return Response.json({ results: [] });
        if (url.pathname === "/anime")
          return Response.json({
            response: [
              {
                anime_id: f.number + 1,
                title: f.tag,
                year: 2026,
                remote_ids: { shikimori_id: f.number + 1, kp_id: f.number + 100 },
              },
            ],
          });
        videos++;
        return Response.json({ response: [] });
      });
      const result = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ url: "/api/anime/" + anime.slug + "/playback" });
      assert.equal(result.json().sources.length, 0);
      assert.equal(videos, 0);
    } finally {
      await app?.close();
      await f.close();
    }
  },
);
