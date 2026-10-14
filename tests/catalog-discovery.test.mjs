import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { digest } from "../apps/api/dist/auth/security.js";
import { catalogQuerySchema } from "../packages/contracts/dist/index.js";
import { catalogMetadata } from "../apps/api/dist/providers/catalog-metadata.js";
import { saveNormalizedAnime } from "../apps/api/dist/providers/catalog-import.js";
import { animeSchema } from "../packages/contracts/dist/index.js";
const url = process.env.TEST_DATABASE_URL;
test("catalog metadata accepts real ratings and rejects invalid scores and private screenshot URLs", () => {
  const result = catalogMetadata(
    {
      type: "anime-serial",
      translation: { title: "Studio" },
      material_data: {
        shikimori_rating: 8.92,
        shikimori_votes: 1234,
        anime_kind: "tv",
        duration: 24,
        episodes_total: 12,
        anime_studios: ["Studio"],
        screenshots: ["https://i.kodikres.com/a.jpg", "http://127.0.0.1/secret"],
      },
    },
    "kodik",
  );
  assert.equal(result.shikimoriScore, 8.92);
  assert.equal(result.popularity, 1234);
  assert.equal(result.format, "tv");
  assert.equal(
    catalogMetadata({ material_data: { aired_at: "2026-10-08", year: 2012 } }, "kodik").year,
    2026,
  );
  assert.equal(catalogMetadata({ material_data: { duration: 23.5 } }, "kodik").details, undefined);
  assert.deepEqual(result.details.screenshots, ["https://i.kodikres.com/a.jpg"]);
  assert.deepEqual(result.translations, ["Studio"]);
  assert.equal(
    catalogMetadata({ material_data: { shikimori_rating: 100 } }, "kodik").shikimoriScore,
    undefined,
  );
  assert.equal(catalogQuerySchema.safeParse({ from: 2026, to: 2000 }).success, false);
});
async function fixture(t) {
  const target = new URL(url);
  assert.match(target.pathname, /_test$/);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  const db = createDatabase(url),
    tag = "discovery-" + randomUUID();
  const users = [randomUUID(), randomUUID()];
  const definitions = [
    {
      title: "A",
      shikimoriScore: 7,
      popularity: 100,
      genres: ["Драма"],
      format: "movie",
      status: "released",
    },
    {
      title: "B",
      shikimoriScore: 9,
      popularity: 10,
      genres: ["Фэнтези"],
      format: "tv",
      status: "ongoing",
    },
    {
      title: "C",
      shikimoriScore: 8.5,
      popularity: 50,
      genres: ["Фэнтези"],
      format: "tv",
      status: "ongoing",
    },
    {
      title: "D",
      shikimoriScore: 10,
      popularity: 200,
      genres: ["Фэнтези"],
      format: "tv",
      status: "ongoing",
      published: false,
    },
  ];
  const anime = definitions.map((d) => ({
    id: randomUUID(),
    slug: tag + "-" + d.title.toLowerCase(),
    originalTitle: d.title,
    aliases: [],
    description: "Fixture",
    year: 2026,
    poster: null,
    searchText: tag,
    metadataProvider: "kodik",
    published: true,
    translations: ["Studio"],
    ...d,
    title: tag + d.title,
  }));
  await db.anime.createMany({ data: anime });
  await db.user.createMany({
    data: users.map((id) => ({
      id,
      email: id + "@example.invalid",
      passwordHash: "test-sentinel",
    })),
  });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      userId: users[0],
      tokenHash: digest(token),
      audience: "web",
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const app = await createApplication(
    readConfig({ NODE_ENV: "test", DATABASE_URL: url, DEMO_CATALOG: "false" }),
  );
  const server = app.getHttpAdapter().getInstance();
  t.after(async () => {
    await app.close();
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.anime.deleteMany({ where: { id: { in: anime.map((a) => a.id) } } });
    await db.$disconnect();
  });
  const get = (query, cookie = false) =>
    server.inject({
      method: "GET",
      url: query.startsWith("/api/") ? query : "/api/catalog" + query,
      headers: cookie ? { cookie: "animesoul_web_session=" + token } : {},
    });
  return { db, tag, users, anime, get };
}
test(
  "catalog sorts by popularity and rating, combines full filters and excludes unpublished entries",
  { skip: !url },
  async (t) => {
    const { anime, tag, get } = await fixture(t);
    const popular = await get("?q=" + tag + "&sort=popular&pageSize=2");
    assert.equal(popular.statusCode, 200);
    assert.deepEqual(
      popular.json().items.map((a) => a.id),
      [anime[0].id, anime[2].id],
    );
    assert.equal(popular.json().total, 3);
    const filtered = await get(
      "?q=" +
        tag +
        "&sort=rating&minRating=8&genre=" +
        encodeURIComponent("Фэнтези") +
        "&format=tv&status=ongoing&translation=Studio&from=2025&to=2026",
    );
    assert.deepEqual(
      filtered.json().items.map((a) => a.id),
      [anime[1].id, anime[2].id],
    );
    const second = await get("?q=" + tag + "&sort=rating&pageSize=2&page=2");
    assert.deepEqual(
      second.json().items.map((a) => a.id),
      [anime[0].id],
    );
    const excluded = await get("?q=" + tag + "&excludeGenre=" + encodeURIComponent("Фэнтези"));
    assert.deepEqual(
      excluded.json().items.map((a) => a.id),
      [anime[0].id],
    );
    const random = await get("/random?mode=filtered&q=" + tag + "&minRating=9&format=tv");
    assert.equal(random.json().slug, anime[1].slug);
    assert.equal(
      (await get("/random?mode=filtered&q=" + tag + "&translation=Unknown")).statusCode,
      404,
    );
  },
);
test(
  "personal selection uses watched genres, excludes started titles and derives the user from the session",
  { skip: !url },
  async (t) => {
    const { db, tag, users, anime, get } = await fixture(t);
    await db.libraryItem.create({
      data: {
        userId: users[0],
        animeId: anime[1].id,
        score: 9,
        progressDetails: { 1: { completed: true, watchedSeconds: 3600 } },
      },
    });
    await db.libraryItem.create({ data: { userId: users[1], animeId: anime[0].id, score: 10 } });
    assert.equal((await get("?personalized=1&q=" + tag)).statusCode, 401);
    assert.equal((await get("/random?mode=filtered&personalized=1&q=" + tag)).statusCode, 401);
    const result = await get("?personalized=1&q=" + tag, true);
    assert.deepEqual(
      result.json().items.map((a) => a.id),
      [anime[2].id],
    );
    assert.equal(result.json().preferredGenres[0].genre, "Фэнтези");
    assert.match(result.headers["cache-control"], /no-store/);
    const random = await get("/random?mode=taste&q=" + tag, true);
    assert.equal(random.json().slug, anime[2].slug);
    const filteredRandom = await get("/random?mode=filtered&personalized=1&q=" + tag, true);
    assert.equal(filteredRandom.json().slug, anime[2].slug);
    const mine = await get("?ratingSource=mine&q=" + tag + "&userId=" + users[1], true);
    assert.deepEqual(
      mine.json().items.map((a) => a.id),
      [anime[1].id],
    );
    assert.equal(mine.json().items[0].myScore, 9);
  },
);
test("community scores use real votes and ignore disabled users", { skip: !url }, async (t) => {
  const { db, tag, users, anime, get } = await fixture(t);
  await db.libraryItem.createMany({
    data: [
      { userId: users[0], animeId: anime[0].id, score: 8 },
      { userId: users[1], animeId: anime[0].id, score: 10 },
    ],
  });
  const before = await get("?q=" + tag + "&ratingSource=community&minRating=9");
  assert.equal(before.json().items[0].communityScore, 9);
  assert.equal(before.json().items[0].communityVotes, 2);
  await db.user.update({ where: { id: users[1] }, data: { disabledAt: new Date() } });
  assert.equal(
    (await get("?q=" + tag + "&ratingSource=community&minRating=9")).json().items.length,
    0,
  );
});
test(
  "provider reimport preserves fresh Shikimori metadata, identity and translations",
  { skip: !url },
  async (t) => {
    const { db, anime, tag } = await fixture(t);
    const target = anime[1];
    const fetchedAt = new Date().toISOString();
    await db.anime.update({
      where: { id: target.id },
      data: {
        details: { shikimoriFetchedAt: fetchedAt, duration: 24 },
        translations: ["Existing"],
      },
    });
    await db.animeProvider.create({
      data: { animeId: target.id, provider: "kodik-material", externalId: tag },
    });
    const incoming = animeSchema.parse({
      ...target,
      indexable: false,
      shikimoriScore: 6,
      format: "movie",
      year: 2000,
      details: { duration: 12 },
      translations: ["New"],
    });
    await db.$transaction((tx) =>
      saveNormalizedAnime(
        tx,
        { anime: incoming, providers: [{ provider: "kodik-material", externalId: tag }] },
        "kodik",
      ),
    );
    const updated = await db.anime.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(updated.slug, target.slug);
    assert.equal(updated.shikimoriScore, 9);
    assert.equal(updated.year, 2026);
    assert.equal(updated.format, "tv");
    assert.equal(updated.details.duration, 24);
    assert.deepEqual(updated.translations, ["Existing", "New"]);
  },
);
test(
  "franchise reads resolve exact primary Kodik IDs without merging retained legacy identities",
  { skip: !url },
  async (t) => {
    const { db, anime, get } = await fixture(t);
    const external = String(randomBytes(6).readUIntBE(0, 6));
    await db.anime.update({ where: { id: anime[0].id }, data: { metadataProvider: "legacy" } });
    await db.animeProvider.createMany({
      data: [
        { animeId: anime[0].id, provider: "shikimori", externalId: external },
        { animeId: anime[2].id, provider: "kodik-material", externalId: "shikimori:" + external },
      ],
    });
    await db.anime.update({
      where: { id: anime[1].id },
      data: { details: { relatedAnimeIds: [anime[1].id, anime[0].id, anime[3].id] } },
    });
    const result = await get("/api/anime/" + anime[1].slug + "/related");
    assert.equal(result.statusCode, 200);
    assert.deepEqual(
      result.json().items.map((a) => a.id),
      [anime[1].id, anime[2].id],
    );
    assert.equal(await db.anime.count({ where: { id: { in: anime.map((a) => a.id) } } }), 4);
  },
);
