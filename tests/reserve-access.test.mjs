import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import {
  digest,
  randomToken,
  hashPassword,
  encryptSecret,
  totp,
} from "../apps/api/dist/auth/security.js";
import { catalogAdminSchema, playbackSchema } from "../packages/contracts/dist/index.js";
const option = { skip: !process.env.TEST_DATABASE_URL };

test(
  "Only owner-delegated accounts can change the site-wide reserve, including cached anonymous playback",
  option,
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /_test$/);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    const db = createDatabase(url.href),
      tag = randomUUID(),
      users = [],
      calls = [];
    const previous = await db.providerSetting.findMany({
      where: { key: { in: ["kodik", "yummy"] } },
    });
    const config = readConfig({
      NODE_ENV: "test",
      DATABASE_URL: url.href,
      ALLOW_KODIK: "true",
      ALLOW_YUMMY: "true",
      KODIK_TOKEN: "PRIMARY_PRIVATE_SENTINEL",
      YUMMY_TOKEN: "RESERVE_PRIVATE_SENTINEL",
      MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    });
    const password = "Reserve integration пароль 2026",
      secret = "JBSWY3DPEHPK3PXP",
      passwordHash = await hashPassword(password);
    const animeId = randomUUID(),
      slug = "reserve-" + tag,
      ip = "127.0.0.245";
    let app;
    try {
      for (const key of ["kodik", "yummy"])
        await db.providerSetting.upsert({
          where: { key },
          create: { key, enabled: true },
          update: { enabled: true },
        });
      async function account(label, role) {
        const username = label + "-" + tag.slice(0, 20);
        const user = await db.user.create({
          data: {
            email: username + "@example.invalid",
            passwordHash,
            profile: { create: { username, usernameKey: username, visibility: {}, content: {} } },
            ...(role ? { roles: { create: { role } } } : {}),
          },
        });
        users.push(user);
        return user;
      }
      const owner = await account("owner", "owner"),
        admin = await account("admin", "admin"),
        delegate = await account("delegate"),
        viewer = await account("viewer");
      async function session(user) {
        const token = randomToken();
        const row = await db.session.create({
          data: {
            userId: user.id,
            tokenHash: digest(token),
            audience: "admin",
            expiresAt: new Date(Date.now() + 60000),
            mfaVerifiedAt: new Date(),
          },
        });
        return {
          id: row.id,
          cookie: "animesoul_admin_session=" + token,
          csrf: digest("animesoul-csrf:" + token),
        };
      }
      const ownerSession = await session(owner),
        adminSession = await session(admin),
        oldDelegateSession = await session(delegate),
        viewerSession = await session(viewer);
      await db.anime.create({
        data: {
          id: animeId,
          slug,
          title: tag,
          originalTitle: tag,
          description: "",
          year: 2026,
          genres: [],
          aliases: [],
          searchText: tag,
          metadataProvider: "kodik",
          status: "released",
          published: true,
          providers: {
            create: [
              { provider: "yummy", externalId: tag },
              { provider: "kodik-material", externalId: "shikimori:91827364" },
            ],
          },
        },
      });
      app = await createApplication(config, async (input) => {
        const target = new URL(String(input));
        calls.push(target.hostname + target.pathname);
        return Response.json(
          target.hostname === "kodik-api.com"
            ? { results: [] }
            : {
                response: [
                  {
                    video_id: 1,
                    number: 1,
                    iframe_url: "//aniqit.com/seria/1/hash",
                    data: { player: "Internal reserve", dubbing: "Studio" },
                  },
                ],
              },
        );
      });
      const server = app.getHttpAdapter().getInstance();
      const get = (path, s = {}) =>
        server.inject({ url: path, remoteAddress: ip, headers: { cookie: s.cookie ?? "" } });
      const post = (path, body, s = {}, headers = {}) =>
        server.inject({
          method: "POST",
          url: path,
          remoteAddress: ip,
          headers: {
            cookie: s.cookie ?? "",
            origin: "http://localhost:8022",
            "x-animesoul-request": "1",
            "x-csrf-token": s.csrf ?? "",
            ...headers,
          },
          payload: body,
        });
      const switchBody = { provider: "yummy", enabled: false, reason: tag },
        grant = { username: delegate.email.split("@")[0], enabled: true, reason: tag };
      assert.equal(
        await db.userPermission.count({ where: { userId: { in: users.map((u) => u.id) } } }),
        0,
      );
      assert.equal(
        (await post("/api/admin/providers/switch", switchBody, adminSession)).statusCode,
        403,
      );
      assert.equal(
        (await post("/api/admin/providers/switch", switchBody, viewerSession)).statusCode,
        403,
      );
      assert.equal((await get("/api/admin/catalog", oldDelegateSession)).statusCode, 403);
      assert.equal(
        (await post("/api/admin/providers/access", grant, adminSession)).statusCode,
        403,
      );
      assert.equal(
        (
          await post("/api/admin/providers/access", grant, ownerSession, {
            origin: "https://attacker.invalid",
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await post("/api/admin/providers/access", grant, ownerSession, { "x-csrf-token": "bad" }))
          .statusCode,
        403,
      );
      assert.equal(
        (await post("/api/admin/providers/access", { ...grant, reason: "" }, ownerSession))
          .statusCode,
        400,
      );
      assert.equal(
        (await post("/api/admin/providers/access", grant, ownerSession)).statusCode,
        201,
      );
      assert.ok((await db.session.findUnique({ where: { id: oldDelegateSession.id } })).revokedAt);
      assert.equal((await get("/api/admin/catalog", oldDelegateSession)).statusCode, 401);

      await db.mfaCredential.create({
        data: {
          userId: delegate.id,
          enabledAt: new Date(),
          secretEncrypted: encryptSecret(secret, config.MFA_ENCRYPTION_KEY, delegate.id),
          recoveryHashes: [],
        },
      });
      const loginBody = {
        email: delegate.email,
        password,
        code: totp(secret, Math.floor(Date.now() / 30000)),
      };
      assert.equal(
        (await post("/api/admin/auth/login", { ...loginBody, code: "not-a-code" })).statusCode,
        401,
      );
      const login = await post("/api/admin/auth/login", loginBody);
      assert.equal(login.statusCode, 201, login.body);
      const cookie = login.headers["set-cookie"].split(";")[0];
      const me = (await get("/api/admin/auth/me", { cookie })).json();
      assert.deepEqual(me.roles, []);
      assert.deepEqual(me.permissions, ["providers.yummy.manage"]);
      const delegated = { cookie, csrf: me.csrfToken };
      const dashboard = catalogAdminSchema.parse(
        (await get("/api/admin/catalog", delegated)).json(),
      );
      assert.deepEqual(dashboard.access, {
        canSwitchKodik: false,
        canSwitchReserve: true,
        canManageCatalog: false,
        canDelegateReserve: false,
      });
      assert.deepEqual(dashboard.jobs, []);
      assert.deepEqual(dashboard.conflicts, []);
      assert.deepEqual(dashboard.reserveManagers, []);
      const ownerDashboard = (await get("/api/admin/catalog", ownerSession)).json();
      assert.deepEqual(ownerDashboard.reserveManagers, [{ username: grant.username }]);
      for (const [path, body] of [
        ["/api/admin", undefined],
        ["/api/admin/catalog/import", { reason: tag }],
        ["/api/admin/catalog/job", { id: randomUUID(), action: "cancel", reason: tag }],
        [
          "/api/admin/catalog/resolve",
          { id: randomUUID(), version: 1, decision: "keep-existing", reason: tag },
        ],
        [
          "/api/admin/providers/access",
          { username: viewer.email.split("@")[0], enabled: true, reason: tag },
        ],
        ["/api/admin/providers/switch", { provider: "kodik", enabled: false, reason: tag }],
      ])
        assert.equal(
          (body ? await post(path, body, delegated) : await get(path, delegated)).statusCode,
          403,
          path,
        );

      const endpoint = "/api/anime/" + slug + "/playback";
      const first = playbackSchema.parse((await get(endpoint)).json());
      assert.equal(first.state, "ready");
      assert.equal(first.sources[0].translation, "Studio");
      assert.equal("provider" in first.sources[0], false);
      assert.equal("player" in first.sources[0], false);
      assert.equal("providers" in first, false);
      assert.equal((await get(endpoint + "?provider=yummy")).statusCode, 400);
      assert.equal((await get(endpoint)).json().sources[0].id, first.sources[0].id);
      assert.equal(
        calls.filter((c) => c.startsWith("api.yani.tv")).length,
        1,
        "anonymous visitors share only a bounded server cache",
      );
      const revision = (await get("/api/playback/revision")).json();
      assert.deepEqual(Object.keys(revision), ["revision"]);
      assert.equal(revision.revision, first.revision);
      assert.equal(
        (await post("/api/admin/providers/switch", switchBody, delegated)).statusCode,
        201,
      );
      const changed = (await get("/api/playback/revision")).json().revision;
      assert.notEqual(changed, revision.revision);
      const before = calls.length;
      for (const visitor of ["127.0.0.11", "127.0.0.12"]) {
        const result = (await server.inject({ url: endpoint, remoteAddress: visitor })).json();
        assert.equal(result.state, "empty");
        assert.deepEqual(result.sources, []);
        assert.equal(result.revision, changed);
      }
      assert.equal(
        calls.length,
        before,
        "global disable refuses already cached reserve videos for every visitor",
      );
      assert.equal(
        (await get("/api/catalog?q=" + tag)).json().total,
        1,
        "reserve disable leaves the Kodik catalog available",
      );
      assert.equal(
        (await db.providerSetting.findUnique({ where: { key: "kodik" } })).enabled,
        true,
      );
      assert.equal(
        (await post("/api/admin/providers/switch", { ...switchBody, enabled: true }, ownerSession))
          .statusCode,
        201,
      );
      assert.equal((await get(endpoint)).json().state, "ready");
      assert.equal(
        calls.filter((c) => c.startsWith("api.yani.tv")).length,
        2,
        "reenabling clears the previous cache",
      );

      assert.equal(
        (await post("/api/admin/providers/access", { ...grant, enabled: false }, ownerSession))
          .statusCode,
        201,
      );
      assert.equal((await get("/api/admin/catalog", delegated)).statusCode, 401);
      assert.equal(
        (await post("/api/admin/providers/switch", switchBody, delegated)).statusCode,
        401,
      );
      assert.equal((await post("/api/admin/auth/login", loginBody)).statusCode, 401);
      assert.equal(await db.userPermission.count({ where: { userId: delegate.id } }), 0);
      const events = await db.auditEvent.findMany({
        where: { actorId: owner.id, objectId: delegate.id },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        events.map((e) => e.action),
        ["provider.reserve-access.grant", "provider.reserve-access.revoke"],
      );
      assert.ok(events.every((e) => e.reason === tag));
      const delegatedEvent = await db.auditEvent.findFirst({
        where: { actorId: delegate.id, objectId: "yummy", action: "provider.disable" },
      });
      assert.ok(delegatedEvent);
    } finally {
      await app?.close();
      const ids = users.map((u) => u.id);
      await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
      await db.authThrottle.deleteMany({
        where: {
          key: {
            in: [digest("ip:" + ip), ...users.map((u) => digest("identity:login:" + u.email))],
          },
        },
      });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.episode.deleteMany({ where: { animeId } });
      await db.anime.deleteMany({ where: { id: animeId } });
      for (const key of ["kodik", "yummy"]) {
        const old = previous.find((s) => s.key === key);
        if (old)
          await db.providerSetting.update({ where: { key }, data: { enabled: old.enabled } });
        else await db.providerSetting.deleteMany({ where: { key } });
      }
      await db.$disconnect();
    }
  },
);
