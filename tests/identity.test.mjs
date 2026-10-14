import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, URLSearchParams } from "node:url";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { digest, randomToken } from "../apps/api/dist/auth/security.js";
const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { generateKeyPair, exportJWK, SignJWT } = await import(
  pathToFileURL(requireApi.resolve("jose"))
);
const option = { skip: !process.env.TEST_DATABASE_URL };
const password = "Identity тестовый пароль 2026";
async function fixture(google = false) {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const db = createDatabase(url.href),
    tag = randomUUID().slice(0, 18),
    mail = [],
    ids = [],
    emails = [],
    tokens = [],
    states = [];
  const ip = "127.0.0." + (10 + Math.floor(Math.random() * 200));
  const config = readConfig({
    NODE_ENV: "test",
    DATABASE_URL: url.href,
    MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    MAIL_MODE: "smtp",
    SMTP_HOST: "example.invalid",
    SMTP_FROM: "noreply@example.invalid",
    ...(google
      ? { GOOGLE_CLIENT_ID: "TEST_CLIENT_ID", GOOGLE_CLIENT_SECRET: "PRIVATE_CLIENT_SENTINEL" }
      : {}),
  });
  let claims = {},
    exchangeCalls = 0,
    lastVerifier = "";
  const key = google ? await generateKeyPair("RS256", { extractable: true }) : null;
  const jwk = key
    ? { ...(await exportJWK(key.publicKey)), kid: "test-key", alg: "RS256", use: "sig" }
    : null;
  const app = await createApplication(config, fetch, {
    mail: async (value) => {
      mail.push(value);
      const match = value.text.match(/http:\/\/[^\s]+/);
      const token = new URL(match[0]).hash;
      tokens.push(new URLSearchParams(token.slice(1)).get("token"));
    },
    fetch: async (input, init) => {
      const target = new URL(String(input));
      if (target.pathname.endsWith("/certs")) return Response.json({ keys: [jwk] });
      assert.equal(target.href, "https://oauth2.googleapis.com/token");
      exchangeCalls++;
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("client_secret"), config.GOOGLE_CLIENT_SECRET);
      assert.equal(body.get("redirect_uri"), "http://localhost:8021/api/auth/google/callback");
      lastVerifier = body.get("code_verifier");
      const token = await new SignJWT({
        sub: "google-" + tag,
        email: "google-" + tag + "@example.invalid",
        email_verified: true,
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(claims.iss ?? "https://accounts.google.com")
        .setAudience(claims.aud ?? config.GOOGLE_CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? "5m")
        .sign(key.privateKey);
      return Response.json({ id_token: token, access_token: "UNUSED_PRIVATE_ACCESS_TOKEN" });
    },
  });
  const server = app.getHttpAdapter().getInstance();
  const get = (path, cookie = "") =>
    server.inject({ url: path, remoteAddress: ip, headers: { cookie } });
  const post = (path, body, account = {}, headers = {}) =>
    server.inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      headers: {
        cookie: account.cookie ?? "",
        origin: "http://localhost:8021",
        "x-animesoul-request": "1",
        "x-csrf-token": account.csrf ?? "",
        ...headers,
      },
      payload: body,
    });
  async function session(response) {
    const values = response.headers["set-cookie"],
      list = Array.isArray(values) ? values : [values];
    const cookie = list.find((value) => value?.startsWith("animesoul_web_session="))?.split(";")[0];
    const me = (await get("/api/auth/me", cookie)).json();
    if (!ids.includes(me.id)) ids.push(me.id);
    return { id: me.id, email: me.email, cookie, csrf: me.csrfToken, me };
  }
  async function register(label = "local") {
    const email = label + "-" + tag + "@example.invalid";
    emails.push(email);
    const result = await post("/api/auth/register", {
      username: label + "-" + tag,
      email,
      password,
    });
    assert.equal(result.statusCode, 201, result.body);
    return session(result);
  }
  async function start(account, intent = "login") {
    const result = await post(
      "/api/auth/google/start",
      { intent, ...(intent === "link" ? { password } : {}) },
      account,
    );
    assert.equal(result.statusCode, 201, result.body);
    const url = new URL(result.json().url);
    assert.equal(url.origin, "https://accounts.google.com");
    const browser = result.headers["set-cookie"].split(";")[0];
    claims = { nonce: url.searchParams.get("nonce") };
    const state = url.searchParams.get("state");
    states.push(digest(state));
    const attempt = await db.oAuthAttempt.findUniqueOrThrow({
      where: { stateHash: digest(state) },
    });
    assert.notEqual(attempt.browserHash, browser.split("=")[1]);
    const callback = (
      cookie = browser + (account?.cookie ? "; " + account.cookie : ""),
      customState = state,
    ) =>
      get(
        "/api/auth/google/callback?" +
          new URLSearchParams({ state: customState, code: "AUTHORIZATION_CODE" }),
        cookie,
      );
    return { state, browser, url, attempt, callback };
  }
  async function close() {
    await app.close();
    await db.oAuthAttempt.deleteMany({ where: { stateHash: { in: states } } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const allEmails = [...emails, ...mail.map((m) => m.to), "google-" + tag + "@example.invalid"];
    await db.authThrottle.deleteMany({
      where: {
        key: {
          in: [
            digest("ip:" + ip),
            ...["login", "link"].map((intent) => digest("identity:google:" + intent + ":" + ip)),
            ...allEmails.flatMap((email) =>
              ["registration:", "login:", "reset:"].map((prefix) =>
                digest("identity:" + prefix + email),
              ),
            ),
            ...ids.flatMap((id) =>
              ["email:", "password:"].map((prefix) => digest("identity:" + prefix + id)),
            ),
            ...tokens.map((token) => digest("identity:email-token:" + digest(token))),
            digest("identity:email-token:" + digest("z".repeat(43))),
          ],
        },
      },
    });
    await db.$disconnect();
  }
  return {
    db,
    app,
    mail,
    tokens,
    ids,
    emails,
    get,
    post,
    session,
    register,
    start,
    close,
    config,
    setClaims: (value) => {
      claims = { ...claims, ...value };
    },
    calls: () => exchangeCalls,
    verifier: () => lastVerifier,
  };
}

test(
  "Email identity verifies ownership, consumes reset once and confirms address changes before revoking both audiences",
  option,
  async () => {
    const f = await fixture();
    try {
      const a = await f.register(),
        other = await f.register("other");
      assert.equal(a.me.emailVerified, false);
      const profile = {
        username: a.me.username,
        about: "",
        presence: "invisible",
        isPublic: true,
        indexable: false,
        visibility: {
          about: false,
          favorites: false,
          folders: false,
          ratings: false,
          statistics: false,
        },
        avatar: "/profile-presets/avatar-cat.svg",
        banner: "/profile-presets/banner-stars.svg",
      };
      assert.equal(
        (
          await f.post(
            "/api/account/profile",
            { ...profile, avatar: "https://attacker.invalid/track" },
            a,
          )
        ).statusCode,
        400,
      );
      assert.equal((await f.post("/api/account/profile", profile, a)).statusCode, 201);
      assert.equal((await f.get("/api/auth/me", a.cookie)).json().avatar, profile.avatar);
      assert.equal((await f.get("/api/profiles/" + a.me.username)).json().presence, "offline");
      assert.equal(
        (await f.post("/api/auth/email/verify", {}, a, { origin: "https://attacker.invalid" }))
          .statusCode,
        403,
      );
      assert.equal(
        (await f.post("/api/auth/email/verify", {}, a, { "x-csrf-token": "wrong" })).statusCode,
        403,
      );
      assert.equal(f.mail.length, 0);
      assert.equal((await f.post("/api/auth/email/verify", {}, a)).statusCode, 201);
      const verify = f.tokens.at(-1),
        stored = await f.db.accountToken.findFirst({ where: { userId: a.id } });
      assert.equal(stored.tokenHash, digest(verify));
      assert.equal(JSON.stringify(stored).includes(verify), false);
      assert.equal((await f.post("/api/auth/email/confirm", { token: verify })).statusCode, 201);
      assert.equal((await f.post("/api/auth/email/confirm", { token: verify })).statusCode, 400);
      assert.equal((await f.get("/api/auth/me", a.cookie)).json().emailVerified, true);
      f.emails.push("absent-" + a.email);
      const absent = await f.post("/api/auth/password/request-reset", {
        email: "absent-" + a.email,
      });
      const exists = await f.post("/api/auth/password/request-reset", { email: a.email });
      assert.equal(absent.statusCode, exists.statusCode);
      assert.deepEqual(absent.json(), exists.json());
      const reset = f.tokens.at(-1),
        adminToken = randomToken();
      const admin = await f.db.session.create({
        data: {
          userId: a.id,
          tokenHash: digest(adminToken),
          audience: "admin",
          mfaVerifiedAt: new Date(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      assert.equal((await f.post("/api/auth/email/confirm", { token: reset })).statusCode, 400);
      const next = "Новый проверенный пароль 2026";
      const resets = await Promise.all([
        f.post("/api/auth/password/reset", { token: reset, password: next }),
        f.post("/api/auth/password/reset", { token: reset, password: next }),
      ]);
      assert.deepEqual(resets.map((r) => r.statusCode).sort(), [201, 400]);
      assert.ok((await f.db.session.findUnique({ where: { id: admin.id } })).revokedAt);
      assert.equal((await f.get("/api/auth/me", a.cookie)).statusCode, 401);
      assert.equal((await f.get("/api/auth/me", other.cookie)).statusCode, 200);
      assert.equal((await f.post("/api/auth/login", { email: a.email, password })).statusCode, 401);
      const signedIn = await f.session(
        await f.post("/api/auth/login", { email: a.email, password: next }),
      );
      const changedEmail = "changed-" + a.email;
      f.emails.push(changedEmail);
      assert.equal(
        (await f.post("/api/auth/email/change", { email: changedEmail, password }, signedIn))
          .statusCode,
        401,
      );
      assert.equal(
        (await f.post("/api/auth/email/change", { email: changedEmail, password: next }, signedIn))
          .statusCode,
        201,
      );
      const stale = f.tokens.at(-1);
      assert.equal((await f.db.user.findUnique({ where: { id: a.id } })).email, a.email);
      assert.equal(
        (await f.post("/api/auth/password", { current: next, next: password }, signedIn))
          .statusCode,
        201,
      );
      assert.equal((await f.post("/api/auth/email/confirm", { token: stale })).statusCode, 400);
      const current = await f.session(
        await f.post("/api/auth/login", { email: a.email, password }),
      );
      assert.equal(
        (await f.post("/api/auth/email/change", { email: changedEmail, password }, current))
          .statusCode,
        201,
      );
      const changed = await f.post("/api/auth/email/confirm", { token: f.tokens.at(-1) });
      assert.equal(changed.statusCode, 201);
      assert.equal(changed.json().signInRequired, true);
      assert.equal((await f.get("/api/auth/me", current.cookie)).statusCode, 401);
      const user = await f.db.user.findUnique({ where: { id: a.id } });
      assert.equal(user.email, changedEmail);
      assert.ok(user.emailVerifiedAt);
      assert.equal(
        (await f.post("/api/auth/login", { email: changedEmail, password })).statusCode,
        201,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Google code flow binds browser/state/PKCE/nonce, verifies signed claims and refuses replay and email auto-linking",
  option,
  async () => {
    const f = await fixture(true);
    try {
      assert.deepEqual((await f.get("/api/auth/options")).json(), {
        google: true,
        email: true,
        localMail: false,
      });
      const flow = await f.start();
      assert.equal((await flow.callback("animesoul_oauth=" + randomToken())).statusCode, 400);
      assert.equal((await flow.callback(flow.browser, randomToken())).statusCode, 400);
      assert.equal(f.calls(), 0);
      const success = await flow.callback();
      assert.equal(success.statusCode, 200, success.body);
      assert.equal(
        createHash("sha256").update(f.verifier()).digest("base64url"),
        flow.url.searchParams.get("code_challenge"),
      );
      assert.equal(flow.attempt.verifierEncrypted.includes(f.verifier()), false);
      const a = await f.session(success);
      assert.equal(a.me.hasPassword, false);
      assert.equal(a.me.googleLinked, true);
      assert.equal(a.me.emailVerified, true);
      assert.deepEqual(a.me.roles, []);
      assert.equal((await f.get("/api/admin", a.cookie)).statusCode, 401);
      assert.equal((await f.get("/api/profiles/" + a.me.username)).statusCode, 404);
      assert.equal((await flow.callback()).statusCode, 400);
      for (const invalid of [
        { nonce: "wrong" },
        { aud: "another-client" },
        { iss: "https://attacker.invalid" },
        { email_verified: false },
        { exp: Math.floor(Date.now() / 1000) - 60 },
      ]) {
        const rejected = await f.start();
        f.setClaims(invalid);
        assert.equal((await rejected.callback()).statusCode, 401, JSON.stringify(invalid));
      }
      const expired = await f.start();
      await f.db.oAuthAttempt.update({
        where: { stateHash: digest(expired.state) },
        data: { expiresAt: new Date(0) },
      });
      assert.equal((await expired.callback()).statusCode, 400);
      const local = await f.register();
      const conflict = await f.start();
      f.setClaims({ sub: "link-" + local.id, email: local.email });
      assert.equal((await conflict.callback()).statusCode, 409);
      assert.equal((await f.db.user.findUnique({ where: { id: local.id } })).googleSubject, null);
      assert.equal(
        (
          await f.post(
            "/api/auth/google/start",
            { intent: "link", password: "wrong password 2026" },
            local,
          )
        ).statusCode,
        401,
      );
      const linked = await f.start(local, "link");
      f.setClaims({ sub: "link-" + local.id, email: local.email });
      assert.equal((await linked.callback(linked.browser)).statusCode, 401);
      const explicit = await f.start(local, "link");
      f.setClaims({ sub: "link-" + local.id, email: local.email });
      assert.equal((await explicit.callback()).statusCode, 200);
      assert.equal((await f.get("/api/auth/me", local.cookie)).json().googleLinked, true);
      const again = await f.start();
      f.setClaims({ sub: "link-" + local.id, email: "different-provider-email@example.invalid" });
      const same = await f.session(await again.callback());
      assert.equal(same.id, local.id);
      assert.equal(same.me.email, local.email);
    } finally {
      await f.close();
    }
  },
);

test("Production refuses local mail and incomplete Google or SMTP configuration", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test:unused@127.0.0.1/test",
    SITE_URL: "https://anime.example",
    ADMIN_URL: "https://admin.anime.example",
    MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  };
  assert.throws(() => readConfig({ ...production, MAIL_MODE: "file" }), /forbidden/);
  assert.throws(() => readConfig({ GOOGLE_CLIENT_ID: "client" }), /both/);
  assert.throws(() => readConfig({ MAIL_MODE: "smtp" }), /host and sender/);
});
