import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { saveImportedAnime } from "../apps/api/dist/providers/catalog-import.js";
const connectionString = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL preserves UUIDs and filters private content on real API reads",
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString);
    assert.match(url.pathname, /_test$/);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(url.hostname),
      "Tests require an isolated local database.",
    );
    const database = createDatabase(connectionString);
    const userId = randomUUID();
    const animeId = randomUUID();
    const username = "test-" + userId;
    let app;
    try {
      await database.user.create({
        data: {
          id: userId,
          email: username + "@example.invalid",
          profile: {
            create: {
              username,
              usernameKey: username,
              isPublic: true,
              indexable: true,
              presence: "invisible",
              about: "PRIVATE_SQL_MARKER",
              visibility: {
                about: false,
                favorites: false,
                folders: false,
                ratings: false,
                statistics: false,
              },
              content: { folders: [{ name: "PRIVATE_SQL_MARKER", animeIds: [] }] },
            },
          },
        },
      });
      await database.anime.create({
        data: {
          id: animeId,
          slug: "test-" + animeId,
          title: "SQL boundary test",
          originalTitle: "SQL boundary test",
          aliases: [],
          description: "Test",
          year: 2026,
          genres: [],
          status: "released",
          published: true,
        },
      });
      app = await createApplication(
        readConfig({ NODE_ENV: "test", DATABASE_URL: connectionString, DEMO_CATALOG: "false" }),
      );
      const server = app.getHttpAdapter().getInstance();
      assert.equal((await server.inject({ method: "GET", url: "/api/ready" })).statusCode, 200);
      const profile = await server.inject({ method: "GET", url: "/api/profiles/" + username });
      assert.equal(profile.json().id, userId);
      assert.equal(profile.json().presence, "offline");
      assert.equal(profile.body.includes("PRIVATE_SQL_MARKER"), false);
      const attack = await server.inject({
        method: "GET",
        url: "/api/catalog?q=" + encodeURIComponent('\' OR 1=1; DROP TABLE "User"; --'),
      });
      assert.deepEqual(attack.json().items, []);
      assert.equal((await database.user.findUnique({ where: { id: userId } })).id, userId);
      await database.userProfile.update({ where: { userId }, data: { isPublic: false } });
      assert.equal(
        (await server.inject({ method: "GET", url: "/api/profiles/" + username })).statusCode,
        404,
      );
      const sitemap = await server.inject({ method: "GET", url: "/api/sitemap/profiles" });
      assert.equal(sitemap.body.includes(username), false);
    } finally {
      await app?.close();
      await database.episode.deleteMany({ where: { animeId } });
      await database.anime.deleteMany({ where: { id: animeId } });
      await database.user.deleteMany({ where: { id: userId } });
      await database.$disconnect();
    }
  },
);

test(
  "provider settings gate real playback, revoke cached sources and keep tokens server-side",
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString);
    assert.match(url.pathname, /_test$/);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    const database = createDatabase(connectionString);
    const animeId = randomUUID();
    const slug = "test-playback-" + animeId;
    let app;
    let calls = 0;
    const upstream = async (url, options) => {
      calls++;
      assert.equal(new URL(url).hostname, "api.yani.tv");
      assert.equal(options.headers["X-Application"], "SERVER_KEY_SENTINEL");
      return new Response(
        JSON.stringify({
          response: [
            {
              video_id: 100,
              number: "1",
              iframe_url: "//kodik.info/seria/100/hash",
              data: { dubbing: "Dub", player: "Kodik" },
              token: "SERVER_KEY_SENTINEL",
            },
          ],
        }),
        { status: 200 },
      );
    };
    try {
      await database.anime.create({
        data: {
          id: animeId,
          slug,
          title: "Playback integration",
          originalTitle: "Test",
          aliases: [],
          description: "Test",
          year: 2026,
          genres: [],
          status: "released",
          published: true,
          providers: { create: { provider: "yummy", externalId: "integration-" + animeId } },
        },
      });
      await database.providerSetting.upsert({
        where: { key: "yummy" },
        create: { key: "yummy", enabled: true },
        update: { enabled: true },
      });
      app = await createApplication(
        readConfig({
          NODE_ENV: "test",
          DATABASE_URL: connectionString,
          ALLOW_YUMMY: "false",
          YUMMY_TOKEN: "SERVER_KEY_SENTINEL",
        }),
        upstream,
      );
      let server = app.getHttpAdapter().getInstance();
      let response = await server.inject({
        method: "GET",
        url: "/api/anime/" + slug + "/playback",
      });
      assert.equal(response.json().state, "disabled");
      assert.equal(calls, 0);
      await app.close();
      app = await createApplication(
        readConfig({
          NODE_ENV: "test",
          DATABASE_URL: connectionString,
          ALLOW_YUMMY: "true",
          YUMMY_TOKEN: "SERVER_KEY_SENTINEL",
        }),
        upstream,
      );
      server = app.getHttpAdapter().getInstance();
      response = await server.inject({ method: "GET", url: "/api/anime/" + slug + "/playback" });
      assert.equal(response.json().state, "ready");
      assert.equal(response.json().sources[0].translation, "Dub");
      assert.equal(response.body.includes("SERVER_KEY_SENTINEL"), false);
      assert.equal(calls, 1);
      await server.inject({ method: "GET", url: "/api/anime/" + slug + "/playback" });
      assert.equal(calls, 1, "second playback request uses the bounded cache");
      await database.providerSetting.update({ where: { key: "yummy" }, data: { enabled: false } });
      response = await server.inject({ method: "GET", url: "/api/anime/" + slug + "/playback" });
      assert.equal(response.json().state, "disabled");
      assert.deepEqual(response.json().sources, []);
      assert.equal(calls, 1, "disabled provider does not use cached sources or make requests");
      await database.providerSetting.update({ where: { key: "yummy" }, data: { enabled: true } });
      await server.inject({ method: "GET", url: "/api/anime/" + slug + "/playback" });
      assert.equal(calls, 2, "reenabling starts with an empty cache");
      await app.close();
      app = await createApplication(
        readConfig({ NODE_ENV: "test", DATABASE_URL: connectionString, ALLOW_YUMMY: "true" }),
        upstream,
      );
      response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: "GET", url: "/api/anime/" + slug + "/playback" });
      assert.equal(response.json().state, "disabled");
      assert.deepEqual(response.json().sources, []);
      assert.equal("providers" in response.json(), false);
      assert.equal(calls, 2);
    } finally {
      await app?.close();
      await database.episode.deleteMany({ where: { animeId } });
      await database.anime.deleteMany({ where: { id: animeId } });
      await database.providerSetting.deleteMany({ where: { key: "yummy" } });
      await database.$disconnect();
    }
  },
);

test(
  "reimport preserves assigned UUIDs and URLs and reports mapping conflicts",
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString);
    assert.match(url.pathname, /_test$/);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    const database = createDatabase(connectionString);
    const id = randomUUID();
    const otherId = randomUUID();
    const slug = "preserved-" + id;
    const fields = {
      title: "Original",
      originalTitle: "Test",
      aliases: [],
      description: "Test",
      year: 2026,
      genres: [],
      status: "released",
      published: true,
    };
    try {
      await database.anime.create({
        data: {
          ...fields,
          id,
          slug,
          providers: { create: { provider: "yummy", externalId: "987654321" } },
        },
      });
      await database.anime.create({
        data: {
          ...fields,
          id: otherId,
          slug: "other-" + otherId,
          providers: { create: { provider: "shikimori", externalId: "987654322" } },
        },
      });
      const row = {
        anime_id: 987654321,
        title: "Updated",
        anime_url: "provider-changed-url",
        year: 2025,
        remote_ids: { shikimori_id: 987654322 },
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await saveImportedAnime(database, row);
        assert.equal(result.id, id);
        assert.equal(result.conflicts, 1);
      }
      const saved = await database.anime.findUnique({ where: { id } });
      assert.equal(saved.slug, slug);
      assert.equal(saved.title, "Updated");
      assert.equal(
        (
          await database.animeProvider.findUnique({
            where: { provider_externalId: { provider: "shikimori", externalId: "987654322" } },
          })
        ).animeId,
        otherId,
      );
      assert.equal(await database.anime.count({ where: { id: { in: [id, otherId] } } }), 2);
    } finally {
      await database.anime.deleteMany({ where: { id: { in: [id, otherId] } } });
      await database.$disconnect();
    }
  },
);
