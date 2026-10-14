import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { createDatabase } from "@animesoul/database";
import { totp } from "../dist/auth/security.js";

const data = process.env.DEV_BOX_DATA ?? "/var/lib/postgresql/animesoul-dev";
const state = JSON.parse(await readFile(`${data}/private.json`, "utf8"));
const snapshot = JSON.parse(await readFile("/app/dev-snapshot/manifest.json", "utf8"));
const db = createDatabase(
  `postgresql://animesoul:${state.databasePassword}@127.0.0.1:5432/animesoul_dev`,
);
const api = "http://127.0.0.1:8020";
const siteOrigin = new URL(process.env.SITE_URL ?? "http://localhost:18021").origin;
const adminOrigin = new URL(process.env.ADMIN_URL ?? "http://localhost:18022").origin;
const credentials = { email: state.account.email, password: state.account.password };
async function request(route, { body, cookie, admin = false, frontend = false } = {}) {
  const base = frontend ? `http://127.0.0.1:${admin ? 8022 : 8021}` : api;
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      Origin: admin ? adminOrigin : siteOrigin,
      "x-animesoul-request": "1",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  return {
    response,
    value,
    cookie: response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; "),
  };
}
try {
  const users = await db.user.findMany({ include: { roles: true, mfa: true, profile: true } });
  assert.equal(users.length, 1, "Exactly one test account must exist");
  assert.equal(users[0].id, state.account.id);
  assert.equal(users[0].email, "dev-owner@example.test");
  assert(users[0].roles.some(({ role }) => role === "owner"));
  assert(users[0].roles.some(({ role }) => role === "admin"));
  assert(users[0].mfa.enabledAt);
  for (const table of snapshot.tables) {
    const [row] = await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public."${table}"`);
    assert.equal(row.count, snapshot.counts[table], `${table}: full snapshot restored`);
  }
  for (const model of ["legacyProfile", "order", "payment", "entitlement", "webhookEvent"])
    assert.equal(await db[model].count(), 0, `${model}: original private data must not exist`);
  for (const file of ["/app/.env", "/app/api/.env", "/app/web/.env", "/app/admin/.env"])
    await assert.rejects(access(file), { code: "ENOENT" });
  await import("./healthcheck.mjs");
  const login = await request("/api/auth/login", { body: credentials, frontend: true });
  assert.equal(login.response.status, 201);
  assert(login.cookie.includes("animesoul_web_session="));
  const me = await request("/api/auth/me", { cookie: login.cookie });
  assert.equal(me.response.status, 200);
  assert(me.value.roles.includes("owner"));
  assert.equal(me.value.mfaEnabled, true);
  assert.equal(me.value.emailVerified, true);
  assert.equal(
    (await request("/api/auth/me", { cookie: login.cookie, frontend: true })).value.id,
    state.account.id,
  );
  const subscription = await request("/api/subscription", { cookie: login.cookie });
  assert.equal(subscription.value.nativeAccess, true);
  assert.equal(subscription.value.source, "staff");
  const register = await request("/api/auth/register", {
    body: {
      email: "second-user@example.test",
      password: "AnotherTestPassword123!",
      username: "AnotherUser",
    },
  });
  assert.equal(register.response.status, 409, "A second account must not be created");
  assert.equal(await db.user.count(), 1);
  const counter = Math.floor(Date.now() / 30000);
  const lastCounter = (await db.mfaCredential.findUnique({ where: { userId: state.account.id } }))
    .lastCounter;
  // Admin MFA codes are single-use. On a repeated check, wait for a fresh time step.
  if (lastCounter >= counter) {
    const wait = (lastCounter + 1) * 30000 - Date.now() + 100;
    console.info(`Waiting ${Math.ceil(wait / 1000)} seconds for a fresh MFA code.`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const admin = await request("/api/admin/auth/login", {
    admin: true,
    frontend: true,
    body: {
      ...credentials,
      code: totp(state.account.totpSecret, Math.floor(Date.now() / 30000)),
    },
  });
  assert.equal(admin.response.status, 201);
  assert(admin.cookie.includes("animesoul_admin_session="));
  for (const route of ["/api/admin", "/api/admin/platform/users", "/api/admin/subscriptions"])
    assert.equal(
      (await request(route, { admin: true, cookie: admin.cookie })).response.status,
      200,
      route,
    );
  assert.equal(
    (
      await request("/api/admin/platform/users", {
        admin: true,
        cookie: admin.cookie,
        frontend: true,
      })
    ).response.status,
    200,
  );
  // Exercise the frontend proxies, not only the backend endpoints.
  for (const url of ["http://127.0.0.1:8021/catalog", "http://127.0.0.1:8022/"])
    assert.equal((await fetch(url, { signal: AbortSignal.timeout(30000) })).status, 200, url);
  console.info(
    JSON.stringify(
      {
        verified: true,
        anime: snapshot.counts.Anime,
        characters: snapshot.counts.Character,
        characterLinks: snapshot.counts.AnimeCharacter,
        accounts: 1,
        roles: ["owner", "admin"],
        webLogin: true,
        adminLoginWithMfa: true,
        nativeAccess: true,
        secondAccountBlocked: true,
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
