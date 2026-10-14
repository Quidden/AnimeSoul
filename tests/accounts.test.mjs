import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { digest, randomToken, totp, decryptSecret } from "../apps/api/dist/auth/security.js";
import { importProfiles, migrationId } from "../apps/api/dist/migration/import-profiles.js";

const connectionString = process.env.TEST_DATABASE_URL;
const password = "Testing private пароль 2026";
async function fixture() {
  const url = new URL(connectionString);
  assert.match(url.pathname, /_test$/);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const database = createDatabase(connectionString);
  const ip = "127.0.0." + (10 + Math.floor(Math.random() * 200));
  const config = readConfig({
    NODE_ENV: "test",
    DATABASE_URL: connectionString,
    MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  });
  const app = await createApplication(config);
  const server = app.getHttpAdapter().getInstance();
  const users = [],
    animeIds = [],
    emails = [];
  async function post(path, body, cookie = "", csrf = "", origin = "http://localhost:8021") {
    return server.inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      headers: { origin, "x-animesoul-request": "1", "x-csrf-token": csrf, cookie },
      payload: body,
    });
  }
  async function get(path, cookie = "") {
    return server.inject({ method: "GET", url: path, remoteAddress: ip, headers: { cookie } });
  }
  async function register() {
    const name = "test-" + randomUUID().slice(0, 32);
    const email = name + "@example.invalid";
    emails.push(email);
    const response = await post("/api/auth/register", { email, password, username: name });
    assert.equal(response.statusCode, 201, response.body);
    const cookie = response.headers["set-cookie"].split(";")[0];
    const me = (await get("/api/auth/me", cookie)).json();
    users.push(me.id);
    return { cookie, csrf: me.csrfToken, email, id: me.id, username: name };
  }
  async function anime() {
    const id = randomUUID();
    animeIds.push(id);
    await database.anime.create({
      data: {
        id,
        slug: "test-" + id,
        title: "Account test",
        originalTitle: "Test",
        aliases: [],
        description: "",
        year: 2026,
        genres: [],
        status: "released",
        published: true,
      },
    });
    return id;
  }
  async function close() {
    await app.close();
    await database.user.deleteMany({ where: { id: { in: users } } });
    await database.anime.deleteMany({ where: { id: { in: animeIds } } });
    await database.authThrottle.deleteMany({
      where: {
        key: {
          in: [
            digest("ip:" + ip),
            ...emails.flatMap((email) => [
              digest("identity:registration:" + email),
              digest("identity:login:" + email),
              digest("identity:claim:" + email),
            ]),
            ...users.flatMap((id) => [
              digest("identity:mfa:" + id),
              digest("identity:password:" + id),
            ]),
          ],
        },
      },
    });
    await database.auditEvent.deleteMany({
      where: { OR: [{ actorId: { in: users } }, { objectId: { in: users } }] },
    });
    await database.$disconnect();
  }
  return {
    database,
    app,
    server,
    config,
    post,
    get,
    register,
    anime,
    close,
    users,
    animeIds,
    emails,
    ip,
  };
}
test(
  "accounts enforce owner isolation, origin/CSRF, private output and revoked/expired sessions",
  { skip: !connectionString },
  async () => {
    const f = await fixture();
    try {
      const a = await f.register(),
        b = await f.register(),
        animeId = await f.anime();
      const saved = await f.database.session.findFirst({ where: { userId: a.id } });
      assert.equal(saved.tokenHash, digest(a.cookie.split("=")[1]));
      assert.notEqual(saved.tokenHash, a.cookie.split("=")[1]);
      assert.equal((await f.get("/api/profiles/" + a.username)).statusCode, 404);
      assert.equal(
        (await f.post("/api/account/library", { animeId, favorite: true }, a.cookie, "wrong"))
          .statusCode,
        403,
      );
      assert.equal(
        (
          await f.post(
            "/api/auth/login",
            { email: a.email, password },
            "",
            "",
            "https://attacker.invalid",
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await f.post(
            "/api/account/library",
            { animeId, favorite: true, score: 9, userId: b.id },
            a.cookie,
            a.csrf,
          )
        ).statusCode,
        201,
      );
      assert.equal((await f.get("/api/account/library", b.cookie)).json().items.length, 0);
      const folder = (
        await f.post("/api/account/folders", { name: "PRIVATE_FOLDER_MARKER" }, a.cookie, a.csrf)
      ).json();
      assert.equal(
        (
          await f.post(
            "/api/account/folders/entry",
            { folderId: folder.id, animeId },
            b.cookie,
            b.csrf,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (await f.post("/api/account/folders/delete", { id: folder.id }, b.cookie, b.csrf))
          .statusCode,
        404,
      );
      const visibility = {
        about: false,
        favorites: true,
        folders: false,
        ratings: false,
        statistics: false,
      };
      assert.equal(
        (
          await f.post(
            "/api/account/profile",
            {
              username: a.username,
              about: "PRIVATE_ABOUT_MARKER",
              presence: "invisible",
              isPublic: true,
              indexable: true,
              visibility,
              userId: b.id,
              roles: ["owner"],
            },
            a.cookie,
            a.csrf,
          )
        ).statusCode,
        201,
      );
      assert.equal(await f.database.userRole.count({ where: { userId: a.id } }), 0);
      const publicProfile = await f.get("/api/profiles/" + a.username);
      assert.deepEqual(publicProfile.json().favoriteIds, [animeId]);
      assert.equal(publicProfile.json().presence, "offline");
      for (const marker of [
        "PRIVATE_ABOUT_MARKER",
        "PRIVATE_FOLDER_MARKER",
        a.email,
        "csrfToken",
        "preferences",
        "passwordHash",
      ])
        assert.equal(publicProfile.body.includes(marker), false, marker);
      assert.equal(
        (
          await f.post(
            "/api/account/progress",
            { animeId, episodeKey: "1", position: 200, duration: 100, completed: false },
            a.cookie,
            a.csrf,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await f.post(
            "/api/account/progress",
            { animeId, episodeKey: "1", position: 40, duration: 100, completed: false },
            a.cookie,
            a.csrf,
          )
        ).statusCode,
        201,
      );
      assert.equal(
        (
          await f.post(
            "/api/account/ratings",
            { animeId, scope: "episode", key: "1", score: 8 },
            a.cookie,
            a.csrf,
          )
        ).statusCode,
        201,
      );
      assert.equal((await f.get("/api/account/library", a.cookie)).json().progress[0].position, 40);
      // Zero is a real rating, distinct from clearing it; fractional scores
      // are rejected because every rating slider uses whole-number steps.
      assert.equal(
        (await f.post("/api/account/library", { animeId, score: 0 }, a.cookie, a.csrf)).statusCode,
        201,
      );
      for (const scope of ["season", "episode"]) {
        assert.equal(
          (
            await f.post(
              "/api/account/ratings",
              { animeId, scope, key: "1", score: 0 },
              a.cookie,
              a.csrf,
            )
          ).statusCode,
          201,
        );
        assert.equal(
          (
            await f.post(
              "/api/account/ratings",
              { animeId, scope, key: "1", score: 8.7 },
              a.cookie,
              a.csrf,
            )
          ).statusCode,
          400,
        );
      }
      const zeros = (await f.get("/api/account/library", a.cookie))
        .json()
        .items.find((item) => item.animeId === animeId);
      assert.equal(zeros.score, 0);
      assert.deepEqual(
        zeros.ratings.map((rating) => rating.score),
        [0, 0],
      );
      assert.equal(
        (
          await f.post(
            "/api/account/ratings",
            { animeId, scope: "episode", key: "1", score: null },
            a.cookie,
            a.csrf,
          )
        ).statusCode,
        201,
      );
      assert.equal(
        (await f.get("/api/account/library", a.cookie))
          .json()
          .items.find((item) => item.animeId === animeId).ratings.length,
        1,
      );
      assert.equal((await f.get("/api/account/library", b.cookie)).json().progress.length, 0);
      const login = await f.post("/api/auth/login", { email: a.email, password });
      const second = login.headers["set-cookie"].split(";")[0];
      assert.equal((await f.post("/api/auth/logout-all", {}, a.cookie, a.csrf)).statusCode, 201);
      assert.equal((await f.get("/api/auth/me", a.cookie)).statusCode, 401);
      assert.equal((await f.get("/api/auth/me", second)).statusCode, 401);
      const session = await f.database.session.findFirst({ where: { userId: b.id } });
      await f.database.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(0) },
      });
      assert.equal((await f.get("/api/account/library", b.cookie)).statusCode, 401);
    } finally {
      await f.close();
    }
  },
);
test(
  "admin sessions require explicit role and MFA, reject TOTP replay and consume recovery codes once",
  { skip: !connectionString },
  async () => {
    const f = await fixture();
    try {
      const a = await f.register();
      assert.equal((await f.get("/api/admin", a.cookie)).statusCode, 401);
      assert.equal(
        (
          await f.post(
            "/api/admin/auth/login",
            { email: a.email, password, code: "000000" },
            "",
            "",
            "http://localhost:8022",
          )
        ).statusCode,
        401,
      );
      await f.database.userRole.create({ data: { userId: a.id, role: "owner" } });
      assert.equal(
        (
          await f.post(
            "/api/admin/auth/login",
            { email: a.email, password, code: "000000" },
            "",
            "",
            "http://localhost:8022",
          )
        ).statusCode,
        401,
      );
      const setup = await f.post("/api/auth/mfa/begin", { password }, a.cookie, a.csrf);
      assert.equal(setup.statusCode, 201, setup.body);
      const secret = setup.json().secret;
      let counter = Math.floor(Date.now() / 30000);
      const enabled = await f.post(
        "/api/auth/mfa/confirm",
        { code: totp(secret, counter) },
        a.cookie,
        a.csrf,
      );
      assert.equal(enabled.statusCode, 201, enabled.body);
      const stored = await f.database.mfaCredential.findUnique({ where: { userId: a.id } });
      assert.equal(stored.secretEncrypted.includes(secret), false);
      assert.equal(
        decryptSecret(stored.secretEncrypted, f.config.MFA_ENCRYPTION_KEY, a.id),
        secret,
      );
      assert.equal(
        (
          await f.post(
            "/api/admin/auth/login",
            { email: a.email, password, code: totp(secret, counter) },
            "",
            "",
            "http://localhost:8022",
          )
        ).statusCode,
        401,
        "confirmation code cannot be reused",
      );
      counter = Math.max(counter + 1, Math.floor(Date.now() / 30000));
      const login = await f.post(
        "/api/admin/auth/login",
        { email: a.email, password, code: totp(secret, counter) },
        "",
        "",
        "http://localhost:8022",
      );
      assert.equal(login.statusCode, 201, login.body);
      assert.match(
        login.headers["set-cookie"],
        /animesoul_admin_session=.*HttpOnly; SameSite=Strict/,
      );
      assert.match(login.headers["set-cookie"], /Max-Age=3600(?:;|$)/);
      const adminCookie = login.headers["set-cookie"].split(";")[0];
      assert.equal((await f.get("/api/admin", adminCookie)).statusCode, 200);
      assert.equal((await f.get("/api/auth/me", adminCookie)).statusCode, 401);
      const renamed = a.cookie.replace("animesoul_web_session", "animesoul_admin_session");
      assert.equal((await f.get("/api/admin", renamed)).statusCode, 401);
      assert.equal(
        (
          await f.post(
            "/api/admin/auth/login",
            { email: a.email, password, code: totp(secret, counter) },
            "",
            "",
            "http://localhost:8022",
          )
        ).statusCode,
        401,
      );
      const recovery = enabled.json().recoveryCodes[0];
      assert.equal(stored.recoveryHashes.includes(recovery), false);
      assert.equal(
        (
          await f.post(
            "/api/admin/auth/login",
            { email: a.email, password, code: recovery },
            "",
            "",
            "http://localhost:8022",
          )
        ).statusCode,
        201,
      );
      assert.equal(
        (
          await f.post(
            "/api/admin/auth/login",
            { email: a.email, password, code: recovery },
            "",
            "",
            "http://localhost:8022",
          )
        ).statusCode,
        401,
      );
      await f.database.userRole.deleteMany({ where: { userId: a.id } });
      assert.equal((await f.get("/api/admin", adminCookie)).statusCode, 403);
    } finally {
      await f.close();
    }
  },
);
test(
  "remembered admin login lasts exactly 30 days and preserves MFA, expiry and revocation",
  { skip: !connectionString },
  async () => {
    const f = await fixture();
    try {
      const a = await f.register();
      await f.database.userRole.create({ data: { userId: a.id, role: "owner" } });
      const adminLogin = (code, options = {}) =>
        f.post(
          "/api/admin/auth/login",
          { email: a.email, password, code, ...options },
          "",
          "",
          "http://localhost:8022",
        );
      assert.equal((await adminLogin("000000", { remember: true })).statusCode, 401);
      const setup = await f.post("/api/auth/mfa/begin", { password }, a.cookie, a.csrf);
      assert.equal(setup.statusCode, 201, setup.body);
      const enabled = await f.post(
        "/api/auth/mfa/confirm",
        { code: totp(setup.json().secret, Math.floor(Date.now() / 30000)) },
        a.cookie,
        a.csrf,
      );
      assert.equal(enabled.statusCode, 201, enabled.body);
      const codes = enabled.json().recoveryCodes;
      assert.equal((await adminLogin(codes[0], { remember: "true" })).statusCode, 400);
      assert.equal(
        (await adminLogin(codes[0], { remember: true, expiresIn: 99999999 })).statusCode,
        400,
      );
      async function checkedLogin(code, options, seconds) {
        const before = Date.now();
        const response = await adminLogin(code, options);
        assert.equal(response.statusCode, 201, response.body);
        const after = Date.now();
        assert.match(response.headers["set-cookie"], new RegExp(`Max-Age=${seconds}(?:;|$)`));
        assert.match(response.headers["set-cookie"], /HttpOnly; SameSite=Strict/);
        const cookie = response.headers["set-cookie"].split(";")[0];
        const session = await f.database.session.findUnique({
          where: { tokenHash: digest(cookie.split("=")[1]) },
        });
        assert.equal(session.audience, "admin");
        assert.ok(session.mfaVerifiedAt);
        assert.ok(session.expiresAt.getTime() >= before + seconds * 1000);
        assert.ok(session.expiresAt.getTime() <= after + seconds * 1000);
        assert.equal((await f.get("/api/admin/auth/me", cookie)).statusCode, 200);
        assert.equal((await f.get("/api/auth/me", cookie)).statusCode, 401);
        return { cookie, session, csrf: response.json().csrfToken };
      }
      await checkedLogin(codes[0], {}, 3600);
      await checkedLogin(codes[1], { remember: false }, 3600);
      const remembered = await checkedLogin(codes[2], { remember: true }, 30 * 86400);
      const logout = await f.post(
        "/api/admin/auth/logout",
        {},
        remembered.cookie,
        remembered.csrf,
        "http://localhost:8022",
      );
      assert.equal(logout.statusCode, 201, logout.body);
      assert.match(logout.headers["set-cookie"], /Max-Age=0(?:;|$)/);
      assert.equal((await f.get("/api/admin/auth/me", remembered.cookie)).statusCode, 401);
      const expired = await checkedLogin(codes[3], { remember: true }, 30 * 86400);
      await f.database.session.update({
        where: { id: expired.session.id },
        data: { expiresAt: new Date(0) },
      });
      assert.equal((await f.get("/api/admin/auth/me", expired.cookie)).statusCode, 401);
      const active = await checkedLogin(codes[4], { remember: true }, 30 * 86400);
      await f.database.user.update({ where: { id: a.id }, data: { disabledAt: new Date() } });
      assert.equal((await f.get("/api/admin/auth/me", active.cookie)).statusCode, 401);
      await f.database.user.update({ where: { id: a.id }, data: { disabledAt: null } });
      await f.database.userRole.deleteMany({ where: { userId: a.id } });
      assert.equal((await f.get("/api/admin/auth/me", active.cookie)).statusCode, 403);
      await f.database.userRole.create({ data: { userId: a.id, role: "owner" } });
      const web = await f.post("/api/auth/login", { email: a.email, password, remember: true });
      assert.equal(web.statusCode, 201, web.body);
      assert.match(web.headers["set-cookie"], /Max-Age=604800(?:;|$)/);
      const changed = await f.post(
        "/api/auth/password",
        { current: password, next: password + " changed" },
        a.cookie,
        a.csrf,
      );
      assert.equal(changed.statusCode, 201, changed.body);
      assert.equal((await f.get("/api/admin/auth/me", active.cookie)).statusCode, 401);
      assert.ok(
        (await f.database.session.findUnique({ where: { id: active.session.id } })).revokedAt,
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "profile migration preserves IDs, rating trees and positions, is repeatable and supports one-time claims",
  { skip: !connectionString },
  async () => {
    const f = await fixture();
    try {
      const id = randomUUID(),
        legacyId = "legacy-" + randomUUID(),
        externalId = 990000000 + Math.floor(Math.random() * 9000000);
      const snapshot = {
        favorites: [externalId],
        folders: [
          {
            id: "watching",
            name: "PRIVATE_NOTE_FOLDER",
            animeIds: [externalId],
            notes: { [externalId]: "Private note" },
          },
        ],
        progress: {
          [externalId]: {
            episode: "1",
            dub: "Dub",
            episodes: {
              1: {
                position: 42,
                duration: 120,
                completed: false,
                updatedAt: 1234000000000,
                iframe_url: "https://kodik.info/secret-video",
              },
            },
          },
        },
        ratings: { [externalId]: { anime: 8, seasons: { 1: 9 }, episodes: { 1: 7 } } },
        tracked: [],
        playerPrefs: {
          autoNext: true,
          videoUrl: "https://kodik.info/temp",
          token: "PRIVATE_PROVIDER_TOKEN",
        },
      };
      const document = {
        profiles: [
          { id, name: "Local profile", snapshot },
          {
            id: legacyId,
            name: "Second local",
            snapshot: { ...snapshot, favorites: [], folders: [], progress: {}, ratings: {} },
          },
        ],
      };
      const imported = await importProfiles(f.database, document);
      f.users.push(...imported.map((p) => p.userId));
      f.animeIds.push(
        (
          await f.database.animeProvider.findUnique({
            where: { provider_externalId: { provider: "yummy", externalId: String(externalId) } },
          })
        ).animeId,
      );
      assert.equal(imported[0].userId, id);
      assert.equal(imported[1].userId, migrationId(legacyId));
      assert.equal((await f.database.user.findUnique({ where: { id } })).email, null);
      const profile = await f.database.userProfile.findUnique({ where: { userId: id } });
      assert.equal(profile.isPublic, false);
      assert.equal(JSON.stringify(profile.preferences).includes("kodik.info"), false);
      assert.equal(JSON.stringify(profile.preferences).includes("PRIVATE_PROVIDER_TOKEN"), false);
      assert.equal(await f.database.libraryRating.count({ where: { userId: id } }), 2);
      assert.equal(
        (await f.database.episodeProgress.findFirst({ where: { userId: id } })).position,
        42,
      );
      assert.equal(
        JSON.stringify(
          await f.database.episodeProgress.findMany({ where: { userId: id } }),
        ).includes("kodik.info"),
        false,
      );
      await f.database.libraryItem.updateMany({ where: { userId: id }, data: { favorite: false } });
      assert.ok((await importProfiles(f.database, document)).every((p) => p.skipped));
      assert.equal(
        await f.database.libraryItem.count({ where: { userId: id, favorite: true } }),
        0,
        "repeat import cannot overwrite newer edits",
      );
      await assert.rejects(
        importProfiles(f.database, { profiles: [{ ...document.profiles[0], name: "Changed" }] }),
        /changed after import/,
      );
      const code = randomToken();
      await f.database.legacyProfile.update({
        where: { userId: id },
        data: { claimHash: digest(code), claimExpiresAt: new Date(Date.now() + 60000) },
      });
      const email = "claim-" + randomUUID() + "@example.invalid";
      f.emails.push(email);
      const claim = await f.post("/api/auth/claim", { email, password, code });
      assert.equal(claim.statusCode, 201, claim.body);
      const cookie = claim.headers["set-cookie"].split(";")[0];
      assert.equal((await f.get("/api/auth/me", cookie)).json().id, id);
      assert.equal((await f.post("/api/auth/claim", { email, password, code })).statusCode, 400);
      assert.equal(await f.database.userRole.count({ where: { userId: id } }), 0);
      const expired = randomToken();
      await f.database.legacyProfile.update({
        where: { userId: imported[1].userId },
        data: { claimHash: digest(expired), claimExpiresAt: new Date(0) },
      });
      assert.equal(
        (await f.post("/api/auth/claim", { email, password, code: expired })).statusCode,
        400,
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "password changes revoke every audience and account throttling survives application restart",
  { skip: !connectionString },
  async () => {
    const f = await fixture();
    let other;
    try {
      const a = await f.register();
      const next = "New testing пароль 2026";
      assert.equal(
        (await f.post("/api/auth/password", { current: password, next }, a.cookie, a.csrf))
          .statusCode,
        201,
      );
      assert.equal((await f.get("/api/auth/me", a.cookie)).statusCode, 401);
      assert.equal((await f.post("/api/auth/login", { email: a.email, password })).statusCode, 401);
      assert.equal(
        (await f.post("/api/auth/login", { email: a.email, password: next })).statusCode,
        201,
      );
      await f.database.authThrottle.upsert({
        where: { key: digest("identity:login:" + a.email) },
        create: { key: digest("identity:login:" + a.email), attempts: 10 },
        update: { attempts: 10, windowStartedAt: new Date() },
      });
      other = await createApplication(f.config);
      const server = other.getHttpAdapter().getInstance();
      const response = await server.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://localhost:8021", "x-animesoul-request": "1" },
        payload: { email: a.email, password: next },
      });
      assert.equal(response.statusCode, 429);
    } finally {
      await other?.close();
      await f.close();
    }
  },
);
