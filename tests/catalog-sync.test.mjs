import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import {
  enqueueCatalog,
  controlCatalog,
  runCatalogPage,
} from "../apps/api/dist/providers/catalog-jobs.js";
import { switchProvider, resolveMapping } from "../apps/api/dist/providers/provider-management.js";
import { saveImportedAnime } from "../apps/api/dist/providers/catalog-import.js";
import {
  normalizeKodikAnime,
  saveImportedKodikAnime,
} from "../apps/api/dist/providers/kodik-catalog.js";
import { normalizeYummyAnime } from "../apps/api/dist/providers/normalizers.js";
import { ProviderUnavailable } from "../apps/api/dist/providers/providers.service.js";
import { ProviderHttp } from "../apps/api/dist/providers/provider-http.js";
import { digest, randomToken } from "../apps/api/dist/auth/security.js";
import { catalogAdminSchema } from "../packages/contracts/dist/index.js";
const connectionString = process.env.TEST_DATABASE_URL;
const option = { skip: !connectionString };
async function fixture(allowKodik = true) {
  const url = new URL(connectionString);
  assert.match(url.pathname, /_test$/);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const db = createDatabase(connectionString),
    tag = randomUUID(),
    ids = [],
    jobs = [],
    users = [];
  const previousKodik = await db.providerSetting.findUnique({ where: { key: "kodik" } });
  await db.providerSetting.upsert({
    where: { key: "kodik" },
    create: { key: "kodik", enabled: true },
    update: { enabled: true },
  });
  const previous = await db.providerSetting.findUnique({ where: { key: "yummy" } });
  await db.providerSetting.upsert({
    where: { key: "yummy" },
    create: { key: "yummy", enabled: true },
    update: { enabled: true },
  });
  const config = readConfig({
    NODE_ENV: "test",
    DATABASE_URL: connectionString,
    ALLOW_YUMMY: "true",
    YUMMY_TOKEN: "PRIVATE_KEY_SENTINEL",
    ALLOW_KODIK: allowKodik ? "true" : "false",
    KODIK_TOKEN: "PRIVATE_KODIK_SENTINEL",
  });
  const row = (id) => {
    let r = {
      anime_id: id,
      title: tag + " " + id,
      year: 2026,
      other_titles: ["Alias fragment " + tag],
    };
    ids.push(normalizeYummyAnime(r).anime.id);
    return r;
  };

  function kodikRow(id) {
    const raw = {
      id: "serial-" + id,
      type: "anime-serial",
      shikimori_id: String(id),
      material_data: {
        anime_title: tag + " " + id,
        year: 2026,
        other_titles: ["Alias fragment " + tag],
      },
      translation: { title: "Dub" },
      seasons: { 1: { episodes: { 1: "//kodik.info/seria/" + id + "/hash" } } },
    };
    ids.push(normalizeKodikAnime(raw).anime.id);
    return raw;
  }
  async function job() {
    const j = await enqueueCatalog(db, null, tag);
    jobs.push(j.id);
    return j.id;
  }
  async function ready(id) {
    await db.catalogImportJob.update({ where: { id }, data: { nextRunAt: new Date(0) } });
  }
  const state = async (name = "kodik") =>
    (await db.providerSetting.findUnique({ where: { key: name } }))?.enabled
      ? "enabled"
      : "disabled";
  async function close() {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.episode.deleteMany({ where: { animeId: { in: ids } } });
    await db.anime.deleteMany({ where: { id: { in: ids } } });
    await db.catalogImportJob.deleteMany({ where: { id: { in: jobs } } });
    await db.auditEvent.deleteMany({
      where: {
        OR: [{ reason: { contains: tag } }, { objectId: { in: jobs } }, { actorId: { in: users } }],
      },
    });
    if (previous)
      await db.providerSetting.update({
        where: { key: "yummy" },
        data: { enabled: previous.enabled },
      });
    else await db.providerSetting.deleteMany({ where: { key: "yummy" } });
    if (previousKodik)
      await db.providerSetting.update({
        where: { key: "kodik" },
        data: { enabled: previousKodik.enabled },
      });
    else await db.providerSetting.deleteMany({ where: { key: "kodik" } });
    await db.$disconnect();
  }
  return { db, tag, ids, jobs, users, config, row, kodikRow, job, ready, state, close };
}
function deferred() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function page(results, next = null, total = 200) {
  return {
    results,
    total,
    next_page: next ? "https://kodik-api.com/list?token=PRIVATE_KODIK_SENTINEL&next=" + next : null,
  };
}
test(
  "Kodik queue leases one worker and resumes the exact cursor after restart",
  option,
  async () => {
    const f = await fixture();
    try {
      const id = await f.job();
      const duplicates = await Promise.all([
        enqueueCatalog(f.db, null, f.tag),
        enqueueCatalog(f.db, null, f.tag),
      ]);
      assert.ok(duplicates.every((j) => j.id === id && j.reused));
      const entered = deferred(),
        release = deferred();
      let calls = 0;
      const provider = {
        state: f.state,
        catalog: async (cursor) => {
          calls++;
          if (cursor === null) {
            entered.release();
            await release.promise;
            return page([f.kodikRow(900001)], "cursor-A", 2);
          }
          assert.equal(cursor, "cursor-A");
          return page([f.kodikRow(900002)], null, 2);
        },
      };
      const first = runCatalogPage(f.db, provider);
      await entered.promise;
      assert.equal(await runCatalogPage(f.db, provider), null);
      assert.equal(calls, 1);
      release.release();
      const checkpoint = await first;
      assert.equal(checkpoint.cursor, "cursor-A");
      assert.equal(checkpoint.offset, 1);
      assert.equal(JSON.stringify(checkpoint).includes("PRIVATE_KODIK_SENTINEL"), false);
      await f.db.catalogImportJob.update({
        where: { id },
        data: {
          status: "running",
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(0),
          nextRunAt: new Date(0),
        },
      });
      const last = await runCatalogPage(f.db, provider);
      assert.equal(last.status, "completed");
      assert.equal(last.imported, 2);
      assert.equal(last.pages, 2);
      assert.equal(last.cursor, null);
      assert.equal(await f.db.kodikRelease.count({ where: { animeId: { in: f.ids } } }), 2);
    } finally {
      await f.close();
    }
  },
);
test(
  "Yummy disable leaves Kodik imports running; Kodik disable discards in-flight pages",
  option,
  async () => {
    const f = await fixture();
    try {
      const id = await f.job();
      let calls = 0;
      const entered = deferred(),
        release = deferred(),
        raw = f.kodikRow(900010);
      const provider = {
        state: f.state,
        catalog: async () => {
          calls++;
          entered.release();
          await release.promise;
          return page([raw]);
        },
      };
      await switchProvider(f.db, f.config, "yummy", false, f.tag);
      assert.equal((await f.db.catalogImportJob.findUnique({ where: { id } })).status, "queued");
      const pending = runCatalogPage(f.db, provider);
      await entered.promise;
      await switchProvider(f.db, f.config, "kodik", false, f.tag);
      release.release();
      assert.equal((await pending).status, "paused");
      assert.equal(await f.db.anime.count({ where: { id: { in: f.ids } } }), 0);
      await controlCatalog(f.db, id, "resume", null, f.tag);
      assert.equal((await runCatalogPage(f.db, provider)).status, "paused");
      assert.equal(calls, 1);
      await switchProvider(f.db, f.config, "kodik", true, f.tag);
      await controlCatalog(f.db, id, "resume", null, f.tag);
      const retry = await runCatalogPage(f.db, {
        ...provider,
        catalog: async () => {
          throw new ProviderUnavailable("error", "rate-limited", 25000);
        },
      });
      assert.equal(retry.offset, 0);
      assert.equal(retry.cursor, null);
      assert.equal(retry.lastError, "rate-limited");
      assert.ok(retry.nextRunAt.getTime() >= Date.now() + 24000);
      await f.ready(id);
      const invalid = await runCatalogPage(f.db, {
        ...provider,
        catalog: async () => ({ error: "PRIVATE_KODIK_SENTINEL" }),
      });
      assert.equal(invalid.status, "failed");
      assert.equal(invalid.lastError, "invalid-page");
      assert.equal(invalid.imported, 0);
      const cancelled = await f.job();
      await assert.rejects(controlCatalog(f.db, id, "resume", null, f.tag));
      await controlCatalog(f.db, cancelled, "cancel", null, f.tag);
      assert.equal(await runCatalogPage(f.db, provider), null);
      await assert.rejects(controlCatalog(f.db, cancelled, "resume", null, f.tag));
      await controlCatalog(f.db, id, "resume", null, f.tag);
      const recovered = await runCatalogPage(f.db, provider);
      assert.equal(recovered.status, "completed");
    } finally {
      await f.close();
    }
  },
);
test("Kodik cursor cycles fail without overwriting the checkpoint", option, async () => {
  const f = await fixture();
  try {
    const id = await f.job();
    const provider = {
      state: f.state,
      catalog: async (cursor) =>
        cursor === null
          ? page([f.kodikRow(900030)], "A")
          : cursor === "A"
            ? page([f.kodikRow(900031)], "B")
            : page([f.kodikRow(900032)], "A"),
    };
    await runCatalogPage(f.db, provider);
    await f.ready(id);
    await runCatalogPage(f.db, provider);
    await f.ready(id);
    await runCatalogPage(f.db, provider);
    await f.ready(id);
    const failed = await runCatalogPage(f.db, provider);
    assert.equal(failed.status, "failed");
    assert.equal(failed.lastError, "repeated-page");
    assert.equal(failed.imported, 3);
    assert.equal(failed.cursor, "A");
  } finally {
    await f.close();
  }
});
test(
  "mapping review prevents stale decisions and reimports preserve UUIDs, slugs and library",
  option,
  async () => {
    const f = await fixture();
    try {
      const a = f.row(900501),
        b = f.row(900502),
        c = f.row(900503);
      a.remote_ids = { shikimori_id: 900504 };
      b.remote_ids = { shikimori_id: 900504 };
      c.remote_ids = { shikimori_id: 900504 };
      const ar = await saveImportedAnime(f.db, a),
        br = await saveImportedAnime(f.db, b),
        cr = await saveImportedAnime(f.db, c);
      assert.equal(br.conflicts, 1);
      assert.equal(cr.conflicts, 1);
      const user = await f.db.user.create({
        data: {
          library: {
            create: [
              { animeId: ar.id, favorite: true },
              { animeId: br.id, score: 8 },
            ],
          },
        },
      });
      f.users.push(user.id);
      let conflict = await f.db.providerMappingConflict.findFirst({
        where: { incomingAnimeId: br.id },
      });
      await resolveMapping(f.db, conflict.id, conflict.version, "keep-existing", f.tag, null);
      assert.equal((await saveImportedAnime(f.db, b)).conflicts, 0);
      await assert.rejects(
        resolveMapping(f.db, conflict.id, conflict.version, "use-incoming", f.tag, null),
      );
      conflict = await f.db.providerMappingConflict.findFirst({
        where: { incomingAnimeId: cr.id },
      });
      await resolveMapping(f.db, conflict.id, conflict.version, "use-incoming", f.tag, null);
      for (const r of [a, b, c]) assert.equal((await saveImportedAnime(f.db, r)).conflicts, 0);
      assert.equal(
        (
          await f.db.animeProvider.findUnique({
            where: { provider_externalId: { provider: "shikimori", externalId: "900504" } },
          })
        ).animeId,
        cr.id,
      );
      assert.equal(await f.db.libraryItem.count({ where: { userId: user.id } }), 2);
      assert.equal(
        (await f.db.anime.findUnique({ where: { id: ar.id } })).slug,
        normalizeYummyAnime(a).anime.slug,
      );
      b.remote_ids = { shikimori_id: 900505 };
      await saveImportedAnime(f.db, b);
      assert.equal(await f.db.anime.count({ where: { id: { in: f.ids } } }), 3);
      // An out-of-band mapping change makes an earlier review stale.
      c.remote_ids = { shikimori_id: 900505 };
      await saveImportedAnime(f.db, c);
      conflict = await f.db.providerMappingConflict.findFirst({
        where: { incomingAnimeId: cr.id, status: "open" },
      });
      await f.db.animeProvider.delete({
        where: { provider_externalId: { provider: "shikimori", externalId: "900505" } },
      });
      await assert.rejects(
        resolveMapping(f.db, conflict.id, conflict.version, "use-incoming", f.tag, null),
      );
      await saveImportedAnime(f.db, c);
      conflict = await f.db.providerMappingConflict.findFirst({
        where: { incomingAnimeId: cr.id, status: "open" },
      });
      await resolveMapping(f.db, conflict.id, conflict.version, "keep-existing", f.tag, null);
      // Ignoring one title's candidate must not block a valid mapping for another title.
      a.remote_ids = { shikimori_id: 900505 };
      assert.equal((await saveImportedAnime(f.db, a)).conflicts, 0);
      assert.equal(
        (
          await f.db.animeProvider.findUnique({
            where: { provider_externalId: { provider: "shikimori", externalId: "900505" } },
          })
        ).animeId,
        ar.id,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "database catalog searches alias fragments and filters before pagination with providers disabled",
  option,
  async () => {
    const f = await fixture();
    let app;
    try {
      const raw = Array.from({ length: 65 }, (_, i) => f.kodikRow(901000 + i));
      for (const r of raw) await saveImportedKodikAnime(f.db, r);
      await switchProvider(f.db, f.config, "yummy", false, f.tag);
      let calls = 0;
      app = await createApplication(f.config, async () => {
        calls++;
        throw new Error("Disabled provider must not be called");
      });
      const server = app.getHttpAdapter().getInstance();
      const query = encodeURIComponent("fragment " + f.tag);
      const first = (await server.inject({ url: "/api/catalog?q=" + query })).json();
      assert.equal(first.total, 65);
      assert.equal(
        (
          await server.inject({
            url: "/api/catalog?q=" + encodeURIComponent("fragment " + f.tag + "%_"),
          })
        ).json().total,
        0,
      );
      assert.equal(first.items.length, 60);
      assert.equal(first.pages, 2);
      const second = (await server.inject({ url: "/api/catalog?q=" + query + "&page=2" })).json();
      assert.equal(second.items.length, 5);
      assert.equal(new Set([...first.items, ...second.items].map((a) => a.id)).size, 65);
      assert.equal(
        (await server.inject({ url: "/api/catalog?q=" + query + "&from=2027" })).json().total,
        0,
      );
      assert.equal((await server.inject({ url: "/api/catalog?pageSize=10000" })).statusCode, 400);
      assert.equal(
        (await server.inject({ url: "/api/catalog?from=2027&to=2026" })).statusCode,
        400,
      );
      const id = second.items[0].id;
      assert.equal(
        (await server.inject({ url: "/api/catalog/by-ids?ids=" + id })).json().items[0].id,
        id,
      );
      await f.db.anime.update({ where: { id }, data: { published: false } });
      assert.equal(
        (await server.inject({ url: "/api/catalog/by-ids?ids=" + id })).json().items.length,
        0,
      );
      assert.equal(calls, 0);
    } finally {
      await app?.close();
      await f.close();
    }
  },
);

test(
  "catalog administration requires separate MFA session, role, Origin and CSRF without exposing secrets",
  option,
  async () => {
    const f = await fixture(false);
    let app;
    try {
      const user = await f.db.user.create({
        data: { passwordHash: "session-fixture", roles: { create: { role: "admin" } } },
      });
      f.users.push(user.id);
      const token = randomToken();
      const session = await f.db.session.create({
        data: {
          userId: user.id,
          tokenHash: digest(token),
          audience: "admin",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      app = await createApplication(f.config);
      const server = app.getHttpAdapter().getInstance();
      const cookie = "animesoul_admin_session=" + token;
      const csrf = digest("animesoul-csrf:" + token);
      const get = () => server.inject({ url: "/api/admin/catalog", headers: { cookie } });
      const post = (body, headers = {}) =>
        server.inject({
          method: "POST",
          url: "/api/admin/providers/switch",
          headers: {
            cookie,
            origin: "http://localhost:8022",
            "x-animesoul-request": "1",
            "x-csrf-token": csrf,
            ...headers,
          },
          payload: body,
        });
      assert.equal((await server.inject({ url: "/api/admin/catalog" })).statusCode, 401);
      assert.equal((await get()).statusCode, 403);
      await f.db.session.update({ where: { id: session.id }, data: { mfaVerifiedAt: new Date() } });
      const dashboard = await get();
      assert.equal(dashboard.statusCode, 200);
      catalogAdminSchema.parse(dashboard.json());
      for (const value of [token, "PRIVATE_KEY_SENTINEL", "leaseToken", "passwordHash"])
        assert.equal(dashboard.body.includes(value), false);
      const body = { provider: "yummy", enabled: false, reason: f.tag };
      assert.equal((await post(body, { origin: "https://attacker.invalid" })).statusCode, 403);
      assert.equal((await post(body, { "x-csrf-token": "wrong" })).statusCode, 403);
      assert.equal((await post({ ...body, reason: "" })).statusCode, 400);
      assert.equal((await post(body)).statusCode, 403, "admin role alone cannot switch reserve");
      await f.db.userRole.create({ data: { userId: user.id, role: "owner" } });
      assert.equal((await post(body)).statusCode, 201);
      assert.equal(
        (await post({ provider: "kodik", enabled: true, reason: f.tag })).statusCode,
        409,
      );
      await f.db.userRole.deleteMany({ where: { userId: user.id } });
      assert.equal((await get()).statusCode, 403);
      await f.db.userRole.create({ data: { userId: user.id, role: "admin" } });
      await f.db.session.update({ where: { id: session.id }, data: { audience: "web" } });
      assert.equal((await get()).statusCode, 401);
    } finally {
      await app?.close();
      await f.close();
    }
  },
);

test("provider rate limits respect bounded Retry-After and never retain upstream error text", async () => {
  const http = new ProviderHttp(
    async () =>
      new Response("PRIVATE_KEY_SENTINEL", {
        status: 429,
        headers: { "Retry-After": "999999999" },
      }),
  );
  await assert.rejects(
    http.get("yummy", "/anime", {}, "PRIVATE_KEY_SENTINEL"),
    (error) =>
      error.code === "rate-limited" &&
      error.retryMs === 600000 &&
      !error.message.includes("PRIVATE_KEY_SENTINEL"),
  );
});

test("Kodik page write failures roll back metadata and checkpoint together", option, async () => {
  const f = await fixture();
  const suffix = f.tag.replaceAll("-", ""),
    hook = "catalog_failure_" + suffix,
    trigger = "catalog_trigger_" + suffix;
  try {
    const id = await f.job(),
      rows = [f.kodikRow(900041), f.kodikRow(900042)];
    await f.db.$executeRawUnsafe(
      "CREATE FUNCTION " +
        hook +
        '() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."title" = \'' +
        f.tag +
        " 900042' THEN RAISE EXCEPTION 'simulated write failure'; END IF; RETURN NEW; END; $$",
    );
    await f.db.$executeRawUnsafe(
      "CREATE TRIGGER " +
        trigger +
        ' BEFORE INSERT ON "Anime" FOR EACH ROW EXECUTE FUNCTION ' +
        hook +
        "()",
    );
    const provider = { state: f.state, catalog: async () => page(rows) };
    const failed = await runCatalogPage(f.db, provider);
    assert.equal(failed.status, "queued");
    assert.equal(failed.offset, 0);
    assert.equal(failed.cursor, null);
    assert.equal(failed.imported, 0);
    assert.equal(await f.db.anime.count({ where: { id: { in: f.ids } } }), 0);
    assert.equal(await f.db.catalogImportPage.count({ where: { jobId: id } }), 0);
    await f.db.$executeRawUnsafe("DROP TRIGGER " + trigger + ' ON "Anime"');
    await f.db.$executeRawUnsafe("DROP FUNCTION " + hook + "()");
    await f.ready(id);
    const recovered = await runCatalogPage(f.db, provider);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.imported, 2);
  } finally {
    await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS " + trigger + ' ON "Anime"');
    await f.db.$executeRawUnsafe("DROP FUNCTION IF EXISTS " + hook + "()");
    await f.close();
  }
});
