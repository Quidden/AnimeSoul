import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { globalSearch } from "../apps/api/dist/catalog/global-search.js";
import { digest } from "../apps/api/dist/auth/security.js";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";
import {
  globalSearchQuerySchema,
  globalSearchResponseSchema,
} from "../packages/contracts/dist/index.js";

test("universal search returns three suggestions, alternate titles, shorthand, typos and structured filters", async (t) => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  t.after(() => app.close());
  const server = app.getHttpAdapter().getInstance();
  const get = (q = "") =>
    server.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent(q) });
  const initial = await get();
  assert.equal(initial.statusCode, 200);
  assert.match(initial.headers["cache-control"], /no-store/);
  assert.equal(initial.json().anime.length, 3);
  assert.equal(initial.json().people.length, 0);
  assert.equal(globalSearchResponseSchema.safeParse(initial.json()).success, true);
  assert.equal(initial.json().genres[0].name, "Фэнтези");
  for (const alias of ["АОТ", "AOT", "SNK", "Attack on Titan", "Shingeki no Kyojin"]) {
    const result = (await get(alias)).json();
    assert.equal(result.anime[0].slug, "attack-on-titan", alias);
    assert.equal(result.correction, null, alias);
  }
  const typo = (await get("Фрирн")).json();
  assert.equal(typo.anime[0].slug, "frieren");
  assert.equal(typo.correction, "Провожающая в последний путь Фрирен");
  const filter = (await get('tag:"Драма" year:2013 status:released')).json();
  assert.deepEqual(
    filter.anime.map((anime) => anime.slug),
    ["attack-on-titan"],
  );
  assert.equal(filter.people.length, 0);
  assert.deepEqual(
    (await get('tag;"Романтика"')).json().anime.map((anime) => anime.slug),
    ["your-name"],
  );
  assert.deepEqual((await get('tag:"Фэнтези" year:2018')).json().anime, []);
  assert.deepEqual((await get("year:wrong")).json().anime, []);
  assert.equal((await get("soul")).json().people[0].username, "soul");
  assert.equal(
    (await get("00000000-0000-4000-8000-000000000010")).json().people[0].username,
    "soul",
  );
  assert.equal((await get("x".repeat(241))).statusCode, 400);
  assert.equal(
    (await server.inject({ method: "GET", url: "/api/search?q=a&q=b" })).statusCode,
    400,
  );
  assert.equal(
    (await server.inject({ method: "GET", url: "/api/search?userId=forged" })).statusCode,
    400,
  );
  assert.equal(globalSearchQuerySchema.parse({ q: "  AOT  " }).q, "AOT");
});

test("search shares a bounded index across requests and rechecks publication before cache expiry", async () => {
  let loads = 0;
  const records = developmentAnime.map((anime, index) => ({
    ...anime,
    popularity: (4 - index) * 100,
    published: true,
    metadataProvider: "kodik",
    isDevelopment: false,
  }));
  const db = {
    character: {
      async findMany() {
        return [];
      },
    },
    anime: {
      async findMany(input) {
        if (input.select) {
          loads++;
          assert.equal(input.take, 20000);
          assert.equal(input.where.published, true);
          assert.deepEqual(input.where.metadataProvider, { not: "legacy" });
          return records;
        }
        assert.ok(input.take <= 8);
        return records.filter((anime) => anime.published && input.where.id.in.includes(anime.id));
      },
    },
    async $queryRaw() {
      return [{ animeId: records[3].id, viewers: 20 }];
    },
    libraryItem: {
      async groupBy() {
        return [];
      },
    },
    episode: {
      async groupBy() {
        return [];
      },
    },
    userProfile: {
      async findMany() {
        return [];
      },
    },
  };
  const config = readConfig({ NODE_ENV: "test", DEMO_CATALOG: "false" });
  const [first, simultaneous] = await Promise.all([
    globalSearch(db, config, { q: "" }),
    globalSearch(db, config, { q: "" }),
  ]);
  assert.equal(loads, 1);
  assert.equal(first.anime[0].slug, "your-name");
  assert.deepEqual(first, simultaneous);
  records[0].published = false;
  assert.deepEqual((await globalSearch(db, config, { q: "AOT" })).anime, []);
  assert.equal(loads, 1);
});

test("search returns fresh viewer-only whole-anime progress, distinct episodes and honest unknown totals", async () => {
  const records = developmentAnime.map((anime, index) => ({
    ...anime,
    published: true,
    metadataProvider: "kodik",
    isDevelopment: false,
    status: index === 1 ? "ongoing" : "released",
    format: index === 3 ? "movie" : "tv",
    details:
      index === 0
        ? { episodesTotal: 4, episodesAired: 4 }
        : index === 1
          ? { episodesTotal: 12, episodesAired: 3 }
          : {},
  }));
  const row = (index, number, completed = false, position = 50, duration = 100) => ({
    animeId: records[index].id,
    episodeKey: "episode:" + index + ":" + number,
    episode: { season: "1", number: String(number) },
    position,
    duration,
    watchedSeconds: position,
    completed,
    updatedAt: new Date("2026-01-02"),
  });
  const saved = new Map([
    [
      "viewer-a",
      [
        row(0, 1, true),
        row(0, 2),
        // The old key for the same episode must not inflate the completion count.
        { ...row(0, 1), episode: null, episodeKey: "1:1", updatedAt: new Date("2026-01-01") },
        ...["1", "legacy:1"].map((episodeKey) => ({
          ...row(0, 1, true),
          episode: null,
          episodeKey,
          updatedAt: new Date("2026-01-01"),
        })),
        ...[1, 2, 3].map((number) => row(1, number, true)),
        row(2, 1, false, 7, 0),
      ],
    ],
    ["viewer-b", [...[1, 2, 3, 4].map((number) => row(0, number, true)), row(1, 1, false, 0)]],
    [
      "viewer-c",
      [
        row(0, 1, false, 0),
        { ...row(0, 1, false, 0), episode: { season: "2", number: "1" }, episodeKey: "season2:1" },
        { ...row(0, 1, true), episode: null, episodeKey: "1" },
      ],
    ],
  ]);
  let personalReads = 0;
  let loads = 0;
  const db = {
    character: {
      async findMany() {
        return [];
      },
    },
    anime: {
      async findMany(input) {
        if (input.select) {
          loads++;
          return records;
        }
        return records.filter((anime) => input.where.id.in.includes(anime.id));
      },
    },
    async $queryRaw() {
      return [];
    },
    userProfile: {
      async findMany() {
        return [];
      },
    },
    episode: {
      async groupBy(input) {
        assert.equal(input.where.animeId.in.length, 4);
        return [{ animeId: records[2].id, _count: { _all: 9 } }];
      },
    },
    episodeProgress: {
      async findMany(input) {
        personalReads++;
        assert.ok(saved.has(input.where.userId));
        assert.equal(input.where.animeId.in.length, 4);
        return saved.get(input.where.userId);
      },
    },
    libraryItem: {
      async groupBy() {
        return [];
      },
      async findMany(input) {
        personalReads++;
        assert.ok(saved.has(input.where.userId));
        assert.equal(input.take, 8);
        return input.where.userId === "viewer-a"
          ? [
              {
                animeId: records[3].id,
                tracking: { status: "completed" },
                lastEpisode: "",
                season: 1,
              },
            ]
          : [];
      },
    },
  };
  const config = readConfig({ NODE_ENV: "test", DEMO_CATALOG: "false" });
  const input = { q: "year:1900-2200" };
  const result = await globalSearch(db, config, input);
  assert.equal(result.anime.length, 4);
  assert.ok(result.anime.every((anime) => anime.watchProgress === null));
  assert.equal(personalReads, 0);
  assert.equal(globalSearchResponseSchema.safeParse(result).success, true);
  const own = await globalSearch(db, config, input, "viewer-a");
  const anime = new Map(own.anime.map((entry) => [entry.slug, entry]));
  assert.deepEqual(anime.get("attack-on-titan").watchProgress, {
    status: "watching",
    completedEpisodes: 1,
    startedEpisodes: 2,
    percent: 37.5,
    lastEpisode: { season: "1", number: "1", percent: 100 },
  });
  assert.deepEqual(anime.get("frieren").episodes, { total: 12, available: 3 });
  assert.equal(anime.get("frieren").watchProgress.status, "caught_up");
  assert.equal(anime.get("frieren").watchProgress.percent, 25);
  assert.deepEqual(anime.get("violet-evergarden").episodes, { total: null, available: 9 });
  assert.equal(anime.get("violet-evergarden").watchProgress.status, "watching");
  assert.equal(anime.get("violet-evergarden").watchProgress.percent, null);
  assert.equal(anime.get("your-name").watchProgress.status, "completed");
  assert.equal(anime.get("your-name").watchProgress.percent, 100);
  assert.equal(anime.get("your-name").watchProgress.completedEpisodes, 0);
  const other = await globalSearch(db, config, input, "viewer-b");
  assert.equal(
    other.anime.find((entry) => entry.slug === "attack-on-titan").watchProgress.status,
    "completed",
  );
  assert.equal(
    other.anime.find((entry) => entry.slug === "frieren").watchProgress.status,
    "not_started",
  );
  assert.equal(other.anime.find((entry) => entry.slug === "frieren").watchProgress.percent, 0);
  const ambiguous = await globalSearch(db, config, input, "viewer-c");
  const uncertain = ambiguous.anime.find((entry) => entry.slug === "attack-on-titan").watchProgress;
  assert.equal(uncertain.status, "watching");
  assert.equal(uncertain.completedEpisodes, 0);
  assert.equal(uncertain.percent, null);
  saved.get("viewer-a")[1].completed = true;
  const updated = await globalSearch(db, config, input, "viewer-a");
  assert.equal(
    updated.anime.find((entry) => entry.slug === "attack-on-titan").watchProgress.percent,
    50,
  );
  assert.equal(loads, 1);
  assert.equal(personalReads, 8);
});

const connection = process.env.TEST_DATABASE_URL;
async function fixture(t) {
  const target = new URL(connection);
  assert.match(target.pathname, /_test$/);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  const db = createDatabase(connection);
  const prefix = "search_" + randomUUID().slice(0, 8);
  const roles = ["viewer", "public", "private", "friend", "incoming", "outgoing", "disabled"];
  const people = Object.fromEntries(
    roles.map((role) => [role, { id: randomUUID(), username: prefix + "_" + role }]),
  );
  for (const [role, person] of Object.entries(people))
    await db.user.create({
      data: {
        id: person.id,
        email: person.username + "@example.invalid",
        passwordHash: "fixture-password-hash",
        ...(role === "disabled" ? { disabledAt: new Date() } : {}),
        profile: {
          create: {
            username: person.username,
            usernameKey: person.username.toLowerCase(),
            avatar: "/profile-presets/avatar-moon.svg",
            isPublic: !["viewer", "private", "friend"].includes(role),
            profileAccess:
              role === "friend"
                ? "friends"
                : ["viewer", "private"].includes(role)
                  ? "private"
                  : "public",
            about: "PRIVATE_ABOUT_MUST_NOT_LEAK",
            content: {},
            visibility: {
              about: false,
              favorites: false,
              folders: false,
              ratings: false,
              statistics: false,
            },
          },
        },
      },
    });
  const [lowId, highId] = [people.viewer.id, people.friend.id].sort();
  await db.friendship.create({ data: { lowId, highId } });
  await db.userBlock.createMany({
    data: [
      { blockerId: people.incoming.id, targetId: people.viewer.id },
      { blockerId: people.viewer.id, targetId: people.outgoing.id },
    ],
  });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      userId: people.viewer.id,
      audience: "web",
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const anime = [
    {
      id: randomUUID(),
      title: prefix + " Первый",
      genres: ["Психологическое"],
      year: 2013,
      status: "ongoing",
      format: "tv",
      shikimoriScore: 8.9,
      popularity: 100,
    },
    {
      id: randomUUID(),
      title: prefix + " Второй",
      genres: ["Драма"],
      year: 2023,
      status: "released",
      format: "movie",
      shikimoriScore: 7,
      popularity: 1000,
    },
    {
      id: randomUUID(),
      title: prefix + " Unpublished",
      genres: ["Психологическое"],
      year: 2013,
      status: "ongoing",
      format: "tv",
      shikimoriScore: 10,
      popularity: 900000,
      published: false,
    },
    {
      id: randomUUID(),
      title: prefix + " Legacy",
      genres: ["Психологическое"],
      year: 2013,
      status: "ongoing",
      format: "tv",
      shikimoriScore: 10,
      popularity: 900000,
      metadataProvider: "legacy",
    },
  ].map((record) => ({
    slug: "search-" + record.id,
    originalTitle: record.title,
    aliases: [prefix + " Alternate " + record.id],
    description: "Search integration fixture",
    published: true,
    metadataProvider: "kodik",
    ...record,
  }));
  await db.anime.createMany({ data: anime });
  await db.episodeProgress.createMany({
    data: [
      {
        userId: people.viewer.id,
        animeId: anime[0].id,
        episodeKey: "legacy:1",
        watchedSeconds: 120,
      },
      {
        userId: people.public.id,
        animeId: anime[0].id,
        episodeKey: "legacy:1",
        watchedSeconds: 120,
      },
      {
        userId: people.viewer.id,
        animeId: anime[1].id,
        episodeKey: "legacy:1",
        watchedSeconds: 120,
      },
      {
        userId: people.viewer.id,
        animeId: anime[1].id,
        episodeKey: "legacy:2",
        watchedSeconds: 120,
      },
      {
        userId: people.disabled.id,
        animeId: anime[1].id,
        episodeKey: "legacy:1",
        watchedSeconds: 120,
      },
    ],
  });
  await db.libraryItem.createMany({
    data: [
      { userId: people.friend.id, animeId: anime[0].id, progressDetails: { 1: { position: 10 } } },
      {
        userId: people.friend.id,
        animeId: anime[1].id,
        progressDetails: { 1: { completed: false, position: 0 } },
      },
    ],
  });
  const app = await createApplication(
    readConfig({ NODE_ENV: "test", DATABASE_URL: connection, DEMO_CATALOG: "false" }),
  );
  const server = app.getHttpAdapter().getInstance();
  t.after(async () => {
    await app.close();
    await db.user.deleteMany({
      where: { id: { in: Object.values(people).map((person) => person.id) } },
    });
    await db.episode.deleteMany({ where: { animeId: { in: anime.map((entry) => entry.id) } } });
    await db.anime.deleteMany({ where: { id: { in: anime.map((entry) => entry.id) } } });
    await db.$disconnect();
  });
  const get = (q, authenticated = false) =>
    server.inject({
      method: "GET",
      url: "/api/search?q=" + encodeURIComponent(q),
      headers: authenticated ? { cookie: "animesoul_web_session=" + token } : {},
    });
  return { db, people, anime, get, prefix };
}

test(
  "universal people search honors public/friend/self access, both block directions and current privacy",
  { skip: !connection },
  async (t) => {
    const { db, people, get, prefix } = await fixture(t);
    const guests = await get(prefix);
    assert.equal(guests.statusCode, 200);
    assert.deepEqual(
      new Set(guests.json().people.map((person) => person.id)),
      new Set([people.public.id, people.incoming.id, people.outgoing.id]),
    );
    const signed = await get(prefix, true);
    assert.deepEqual(
      new Set(signed.json().people.map((person) => person.id)),
      new Set([people.public.id, people.friend.id, people.viewer.id]),
    );
    for (const role of ["private", "disabled", "incoming", "outgoing"])
      assert.deepEqual((await get(people[role].id, true)).json().people, [], role);
    assert.equal((await get(people.public.id.toUpperCase())).json().people[0].id, people.public.id);
    assert.deepEqual((await get(people.friend.id)).json().people, []);
    assert.equal((await get(people.friend.id, true)).json().people[0].id, people.friend.id);
    assert.equal((await get(people.viewer.id, true)).json().people[0].id, people.viewer.id);
    const body = signed.body;
    assert.doesNotMatch(
      body,
      /PRIVATE_ABOUT_MUST_NOT_LEAK|@example\.invalid|passwordHash|visibility|preferences/,
    );
    for (const person of signed.json().people)
      assert.deepEqual(Object.keys(person).sort(), ["avatar", "id", "username"]);
    await db.userProfile.update({
      where: { userId: people.public.id },
      data: { isPublic: false, profileAccess: "private" },
    });
    assert.deepEqual((await get(people.public.username)).json().people, []);
    await db.friendship.deleteMany({
      where: { OR: [{ lowId: people.viewer.id }, { highId: people.viewer.id }] },
    });
    assert.deepEqual((await get(people.friend.username, true)).json().people, []);
    await db.session.updateMany({
      where: { userId: people.viewer.id },
      data: { revokedAt: new Date() },
    });
    assert.deepEqual((await get(people.viewer.id, true)).json().people, []);
  },
);

test(
  "database search combines typed filters and ranks popular now by distinct recent viewers",
  { skip: !connection },
  async (t) => {
    const { db, anime, get, prefix } = await fixture(t);
    const initial = (await get("")).json();
    assert.equal(initial.anime.length, 3);
    assert.equal(initial.anime[0].id, anime[0].id);
    assert.deepEqual(
      (await get(prefix)).json().anime.map((entry) => entry.id),
      [anime[0].id, anime[1].id],
    );
    const filters = `${prefix} tag:"Психологическое" year:2013 status:ongoing type:tv rating:8`;
    const result = await get(filters);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(
      result.json().anime.map((entry) => entry.id),
      [anime[0].id],
    );
    assert.equal(
      result.json().genres.find((entry) => entry.name === "Психологическое").count,
      await db.anime.count({
        where: {
          published: true,
          metadataProvider: { not: "legacy" },
          genres: { has: "Психологическое" },
        },
      }),
    );
    const alias = (await get(anime[1].aliases[0])).json();
    assert.equal(alias.anime[0].id, anime[1].id);
    await db.anime.update({ where: { id: anime[0].id }, data: { published: false } });
    assert.deepEqual((await get(filters)).json().anime, []);
  },
);

test(
  "authenticated search reads actual episode progress freshly and never shares it with guests",
  { skip: !connection },
  async (t) => {
    const { db, people, anime, get, prefix } = await fixture(t);
    await db.anime.update({
      where: { id: anime[0].id },
      data: { details: { episodesTotal: 4, episodesAired: 2 } },
    });
    const episodes = [1, 2].map((number) => ({
      id: randomUUID(),
      animeId: anime[0].id,
      season: "1",
      number: String(number),
    }));
    await db.episode.createMany({ data: episodes });
    await db.episodeProgress.update({
      where: {
        userId_animeId_episodeKey: {
          userId: people.viewer.id,
          animeId: anime[0].id,
          episodeKey: "legacy:1",
        },
      },
      data: { completed: true, duration: 100, position: 100, updatedAt: new Date("2025-01-01") },
    });
    await db.episodeProgress.createMany({
      data: episodes.map((episode, index) => ({
        userId: people.viewer.id,
        animeId: anime[0].id,
        episodeId: episode.id,
        episodeKey: "episode:" + episode.id,
        duration: 100,
        position: index === 0 ? 100 : 50,
        completed: index === 0,
        updatedAt: new Date(Date.now() - (1 - index) * 1000),
      })),
    });
    const query = prefix + " Первый";
    const guest = (await get(query)).json().anime[0];
    assert.deepEqual(guest.episodes, { total: 4, available: 2 });
    assert.equal(guest.watchProgress, null);
    const signed = await get(query, true);
    assert.equal(signed.statusCode, 200);
    assert.equal(globalSearchResponseSchema.safeParse(signed.json()).success, true);
    assert.match(signed.headers["cache-control"], /no-store/);
    assert.deepEqual(signed.json().anime[0].watchProgress, {
      status: "watching",
      completedEpisodes: 1,
      startedEpisodes: 2,
      percent: 37.5,
      lastEpisode: { season: "1", number: "2", percent: 50 },
    });
    await db.episodeProgress.update({
      where: {
        userId_animeId_episodeKey: {
          userId: people.viewer.id,
          animeId: anime[0].id,
          episodeKey: "episode:" + episodes[1].id,
        },
      },
      data: { completed: true, position: 100 },
    });
    const refreshed = (await get(query, true)).json().anime[0].watchProgress;
    assert.equal(refreshed.completedEpisodes, 2);
    assert.equal(refreshed.percent, 50);
    assert.equal(refreshed.status, "caught_up");
    assert.equal((await get(query)).json().anime[0].watchProgress, null);
    await db.session.updateMany({
      where: { userId: people.viewer.id },
      data: { revokedAt: new Date() },
    });
    assert.equal((await get(query, true)).json().anime[0].watchProgress, null);
  },
);
