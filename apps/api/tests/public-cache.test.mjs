import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../dist/app.js";
import { readConfig } from "../dist/config.js";
import { PublicResponseCache } from "../dist/catalog/public-response-cache.js";
import { createDatabase } from "../../../packages/database/dist/src/index.js";

test("public cache coalesces loads, expires, evicts and never retains failures or old revisions", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 100000 });
  const cache = new PublicResponseCache(100, 50);
  let calls = 0;
  const load = async () => {
    calls++;
    return { title: "saved" };
  };
  const values = await Promise.all([cache.read("v1", "a", load), cache.read("v1", "a", load)]);
  assert.equal(calls, 1);
  assert.equal(values[0].etag, values[1].etag);
  await cache.read("v1", "a", load);
  assert.equal(calls, 1);
  context.mock.timers.tick(101);
  await cache.read("v1", "a", load);
  assert.equal(calls, 2);
  await cache.read("v2", "a", load);
  assert.equal(calls, 3);
  for (const key of ["b", "c", "a"]) await cache.read("v2", key, load);
  assert.equal(calls, 6);
  await assert.rejects(
    cache.read("v2", "failed", async () => {
      throw new Error("fixture");
    }),
  );
  assert.ok(await cache.read("v2", "failed", load));
  assert.equal(await cache.read("v2", "missing", async () => null), null);
  assert.ok(await cache.read("v2", "missing", load));
  let release;
  const old = cache.read(
    "v2",
    "pending",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const fresh = await cache.read("v3", "pending", async () => ({ title: "fresh" }));
  release({ title: "old" });
  await old;
  assert.equal((await cache.read("v3", "pending", load)).etag, fresh.etag);
});

test("only public anime and franchise GET/HEAD responses support ETag revalidation", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  const server = app.getHttpAdapter().getInstance();
  try {
    for (const path of ["/api/anime/frieren", "/api/anime/frieren/franchise"]) {
      const first = await server.inject({ url: path });
      assert.equal(first.statusCode, 200, first.body);
      assert.ok(first.json());
      assert.equal(first.headers["cache-control"], "public, max-age=0, must-revalidate");
      const etag = first.headers.etag;
      assert.match(etag, /^"[A-Za-z0-9_-]{43}"$/);
      for (const value of [etag, "W/" + etag, '"different", ' + etag, "*"]) {
        const response = await server.inject({ url: path, headers: { "if-none-match": value } });
        assert.equal(response.statusCode, 304);
        assert.equal(response.body, "");
        assert.equal(response.headers.etag, etag);
      }
      const head = await server.inject({ method: "HEAD", url: path });
      assert.equal(head.statusCode, 200);
      assert.equal(head.body, "");
      assert.equal(head.headers.etag, etag);
    }
    for (const path of ["/api/anime/missing", "/api/auth/me", "/api/catalog?personalized=1"]) {
      const response = await server.inject({ url: path });
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers.etag, undefined);
    }
  } finally {
    await app.close();
  }
});

test(
  "PostgreSQL snapshots invalidate cached public responses immediately after committed edits and withdrawal",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /_test$/);
    const db = createDatabase(url.href);
    const id = randomUUID(),
      slug = "cache-" + id;
    let app;
    try {
      await db.anime.create({
        data: {
          id,
          slug,
          title: "Before",
          originalTitle: "Cache fixture",
          aliases: [],
          description: "Fixture",
          year: 2026,
          genres: [],
          status: "released",
          published: true,
        },
      });
      app = await createApplication(readConfig({ NODE_ENV: "test", DATABASE_URL: url.href }));
      const server = app.getHttpAdapter().getInstance();
      const first = await server.inject({ url: "/api/anime/" + slug });
      const etag = first.headers.etag;
      assert.equal(first.json().title, "Before");
      await db.anime.update({ where: { id }, data: { title: "After" } });
      const updated = await server.inject({
        url: "/api/anime/" + slug,
        headers: { "if-none-match": etag },
      });
      assert.equal(updated.statusCode, 200);
      assert.equal(updated.json().title, "After");
      assert.notEqual(updated.headers.etag, etag);
      let changed, commit;
      const written = new Promise((resolve) => {
        changed = resolve;
      });
      const release = new Promise((resolve) => {
        commit = resolve;
      });
      const transaction = db.$transaction(async (tx) => {
        await tx.anime.update({ where: { id }, data: { title: "Committed later" } });
        changed();
        await release;
      });
      await written;
      const during = await server.inject({ url: "/api/anime/" + slug });
      assert.equal(during.json().title, "After");
      commit();
      await transaction;
      const committed = await server.inject({
        url: "/api/anime/" + slug,
        headers: { "if-none-match": during.headers.etag },
      });
      assert.equal(committed.statusCode, 200);
      assert.equal(committed.json().title, "Committed later");
      const franchise = await server.inject({ url: "/api/anime/" + slug + "/franchise" });
      assert.equal(franchise.statusCode, 200);
      await db.anime.update({ where: { id }, data: { published: false } });
      const hidden = await server.inject({
        url: "/api/anime/" + slug,
        headers: { "if-none-match": updated.headers.etag },
      });
      assert.equal(hidden.statusCode, 404);
      assert.equal(hidden.headers["cache-control"], "no-store");
      assert.equal(hidden.headers.etag, undefined);
      assert.equal(
        (
          await server.inject({
            url: "/api/anime/" + slug + "/franchise",
            headers: { "if-none-match": franchise.headers.etag },
          })
        ).statusCode,
        404,
      );
    } finally {
      await app?.close();
      await db.anime.deleteMany({ where: { id } });
      await db.$disconnect();
    }
  },
);
