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
async function request(route, { body, cookie, csrf, admin = false, frontend = false } = {}) {
  const base = frontend ? `http://127.0.0.1:${admin ? 8022 : 8021}` : api;
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      Origin: admin ? adminOrigin : siteOrigin,
      "x-animesoul-request": "1",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
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
  const owner = users.find(({ id }) => id === state.account.id);
  assert(owner, "The bootstrap owner must survive upgrades and restarts");
  assert.equal(owner.email, "dev-owner@example.test");
  assert(owner.roles.some(({ role }) => role === "owner"));
  assert(owner.roles.some(({ role }) => role === "admin"));
  assert(owner.mfa.enabledAt);
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
  const memberEmail = "release-check@example.test";
  const existingMember = await db.user.findUnique({ where: { email: memberEmail } });
  const member = await request(existingMember ? "/api/auth/login" : "/api/auth/register", {
    frontend: true,
    body: {
      email: memberEmail,
      password: "AnotherTestPassword123!",
      ...(!existingMember ? { username: "ReleaseCheck" } : {}),
    },
  });
  assert.equal(member.response.status, 201, "Additional accounts must register and log in");
  const memberMe = await request("/api/auth/me", { cookie: member.cookie, frontend: true });
  assert.equal(memberMe.response.status, 200);
  assert.deepEqual(memberMe.value.roles, [], "New accounts must not inherit administrator rights");
  const memberOptions = { cookie: member.cookie, csrf: memberMe.value.csrfToken, frontend: true };
  const profile = await request("/api/account/profile", memberOptions);
  const edited = await request("/api/account/profile", {
    ...memberOptions,
    body: { ...profile.value, isPublic: true, profileAccess: "public", friendRequests: "everyone" },
  });
  assert.equal(edited.response.status, 201);
  const relation = await request("/api/account/social/" + state.account.id, memberOptions);
  if (relation.value.state !== "friends") {
    const invitation = await request("/api/account/social", {
      cookie: login.cookie,
      csrf: me.value.csrfToken,
      frontend: true,
      body: { targetId: memberMe.value.id, action: "request" },
    });
    assert.equal(invitation.response.status, 201);
    const accepted = await request("/api/account/social", {
      ...memberOptions,
      body: { targetId: state.account.id, action: "accept" },
    });
    assert.equal(accepted.response.status, 201);
  }
  assert.equal(
    (await request("/api/account/social/" + state.account.id, memberOptions)).value.state,
    "friends",
  );
  const post = await request("/api/account/content/posts", {
    ...memberOptions,
    body: {
      kind: "text",
      title: "Private image verification",
      body: "Additional members can publish and discuss anime.",
      audience: "public",
      tags: ["release_check"],
      labels: [],
    },
  });
  assert.equal(post.response.status, 201, "Registered members can publish community posts");
  const comment = await request("/api/account/content/comments", {
    cookie: login.cookie,
    csrf: me.value.csrfToken,
    frontend: true,
    body: { postId: post.value.id, body: "Other members can reply to this post.", labels: [] },
  });
  assert.equal(comment.response.status, 201, "Other members can discuss published posts");
  const options = await request("/api/auth/options", { frontend: true });
  assert.equal(options.value.google, Boolean(process.env.GOOGLE_CLIENT_ID));
  assert.equal(options.value.email, (process.env.MAIL_MODE || "disabled") !== "disabled");
  const giphy = await request("/api/profile-giphy/config", { frontend: true });
  assert.equal(giphy.value.apiKey, process.env.GIPHY_API_KEY || "");
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
        accounts: await db.user.count(),
        roles: ["owner", "admin"],
        webLogin: true,
        adminLoginWithMfa: true,
        nativeAccess: true,
        additionalAccounts: true,
        newAccountsUnprivileged: true,
        friendship: true,
        communityPublishing: true,
        communityComments: true,
        runtimeIntegrations: true,
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
