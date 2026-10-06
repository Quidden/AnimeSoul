import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
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
      await database.anime.deleteMany({ where: { id: animeId } });
      await database.user.deleteMany({ where: { id: userId } });
      await database.$disconnect();
    }
  },
);
