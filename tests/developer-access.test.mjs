import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { digest, randomToken, csrfToken } from "../apps/api/dist/auth/security.js";
import { SubscriptionsService } from "../apps/api/dist/subscriptions/subscriptions.service.js";
import { DirectStreamService } from "../apps/api/dist/playback/direct-stream.service.js";
import {
  developerAccessEditSchema,
  developerRole,
} from "../packages/contracts/dist/developer-access.js";

test("developer access accepts only known modes and identifies the real staff role", () => {
  assert.equal(developerRole(["admin", "owner"]), "owner");
  assert.equal(developerRole(["admin"]), "admin");
  assert.equal(developerRole(["moderator"]), null);
  assert.equal(developerAccessEditSchema.safeParse({ mode: "owner" }).success, false);
  assert.equal(
    developerAccessEditSchema.safeParse({ mode: "subscriber", userId: randomUUID() }).success,
    false,
  );
});

test(
  "staff can simulate and restore site access without changing roles, billing or other sessions",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.match(url.pathname, /_test$/);
    const db = createDatabase(url.href),
      ids = [];
    const config = readConfig({
      NODE_ENV: "test",
      DATABASE_URL: url.href,
      ALLOW_KODIK_DIRECT: "true",
      KODIK_PRIVATE_KEY: "DEVELOPER_PRIVATE_SENTINEL",
      KODIK_TOKEN: "DEVELOPER_PUBLIC_SENTINEL",
    });
    const app = await createApplication(config, async () => Response.json({}));
    const server = app.getHttpAdapter().getInstance();
    const get = (path, account) =>
      server.inject({ url: path, headers: { cookie: account?.cookie ?? "" } });
    const post = (path, payload, account, extra = {}) =>
      server.inject({
        method: "POST",
        url: path,
        payload,
        headers: {
          cookie: account?.cookie ?? "",
          origin: "http://localhost:8021",
          "x-animesoul-request": "1",
          "x-csrf-token": account?.csrf ?? "",
          ...extra,
        },
      });
    const endpoint = "/api/auth/developer-access";
    async function session(userId, audience = "web") {
      const token = randomToken();
      const value = await db.session.create({
        data: {
          userId,
          tokenHash: digest(token),
          audience,
          expiresAt: new Date(Date.now() + 3600000),
          ...(audience === "admin" ? { mfaVerifiedAt: new Date() } : {}),
        },
      });
      return {
        id: value.id,
        userId,
        cookie: `animesoul_${audience}_session=${token}`,
        csrf: csrfToken(token),
      };
    }
    async function user(role) {
      const value = await db.user.create({
        data: {
          googleSubject: "developer-test-" + randomUUID(),
          ...(role ? { roles: { create: { role } } } : {}),
        },
      });
      ids.push(value.id);
      return session(value.id);
    }
    async function switchMode(account, mode) {
      const response = await post(endpoint, { mode }, account);
      assert.equal(response.statusCode, 201, response.body);
      assert.match(response.headers["cache-control"], /no-store/);
      assert.equal(response.json().mode, mode);
      return response.json();
    }
    async function access(account, nativeAccess, source, authenticated = true) {
      const response = await get("/api/subscription", account);
      assert.equal(response.statusCode, 200, response.body);
      assert.match(response.headers["cache-control"], /no-store/);
      assert.equal(response.json().nativeAccess, nativeAccess);
      assert.equal(response.json().source, source);
      assert.equal(response.json().authenticated, authenticated);
      return response.json();
    }
    try {
      const owner = await user("owner"),
        admin = await user("admin"),
        regular = await user();
      const otherDevice = await session(owner.userId),
        adminPortal = await session(owner.userId, "admin");
      assert.equal((await get(endpoint)).statusCode, 401);
      assert.equal((await get(endpoint, regular)).statusCode, 403);
      assert.equal((await post(endpoint, { mode: "subscriber" }, regular)).statusCode, 403);
      assert.equal((await get(endpoint, adminPortal)).statusCode, 401);
      assert.equal((await get(endpoint, owner)).json().role, "owner");
      assert.equal((await get(endpoint, admin)).json().role, "admin");
      await access(owner, true, "staff");
      await access(admin, true, "staff");
      await access(regular, false, "none");
      for (const extra of [
        { "x-csrf-token": "invalid" },
        { origin: "https://forged.invalid" },
        { "x-animesoul-request": "" },
      ]) {
        assert.equal((await post(endpoint, { mode: "guest" }, owner, extra)).statusCode, 403);
      }
      assert.equal((await post(endpoint, { mode: "owner" }, owner)).statusCode, 400);
      assert.equal(
        (await post(endpoint, { mode: "subscriber", userId: regular.userId }, owner)).statusCode,
        400,
      );
      assert.equal((await get(endpoint, owner)).json().mode, "actual");

      // Even a real native permission must be hidden while simulating no subscription.
      await db.userPermission.create({
        data: { userId: owner.userId, permission: "player.native", grantedBy: owner.userId },
      });
      await switchMode(owner, "user");
      await access(owner, false, "none");
      assert.deepEqual((await get("/api/auth/me", owner)).json().roles, []);
      const trial = await switchMode(owner, "trial");
      assert.equal(trial.role, "owner");
      const trialAccess = await access(owner, true, "trial");
      assert.equal(trialAccess.trialEndsAt, trialAccess.expiresAt);
      await switchMode(owner, "subscriber");
      const subscriber = await access(owner, true, "subscription");
      assert.equal(subscriber.trialEndsAt, null);
      await switchMode(owner, "guest");
      await access(owner, false, "none", false);
      assert.equal((await get("/api/auth/me", owner)).statusCode, 401);
      assert.equal((await get("/api/account/library", owner)).statusCode, 401);
      assert.equal((await get(endpoint, owner)).json().csrfToken, owner.csrf);
      await access(otherDevice, true, "staff");
      assert.equal((await get("/api/admin/auth/me", adminPortal)).statusCode, 200);
      assert.deepEqual((await get("/api/admin/auth/me", adminPortal)).json().roles, ["owner"]);
      await switchMode(owner, "actual");
      await access(owner, true, "staff");
      assert.deepEqual((await get("/api/auth/me", owner)).json().roles, ["owner"]);
      assert.equal(await db.userRole.count({ where: { userId: owner.userId, role: "owner" } }), 1);
      assert.equal(await db.entitlement.count({ where: { userId: owner.userId } }), 0);
      assert.equal(await db.subscriptionTrial.count({ where: { userId: owner.userId } }), 0);
      assert.equal(await db.order.count({ where: { userId: owner.userId } }), 0);

      // Changing the mode while the upstream is loading must block its direct file URLs.
      const policy = app.get(SubscriptionsService);
      const viewer = await policy.viewer({ headers: { cookie: owner.cookie }, ip: "127.0.0.1" });
      let release, began;
      const waiting = new Promise((resolve) => {
        release = resolve;
      });
      const started = new Promise((resolve) => {
        began = resolve;
      });
      const direct = new DirectStreamService(
        config,
        async () => {
          began();
          await waiting;
          return Response.json({
            links: { 720: [{ Src: "https://media.example.com/developer.m3u8", Type: "hls" }] },
          });
        },
        { state: async () => "enabled", hidesCredential: () => false },
        {
          find: async () => ({
            sources: [{ id: "a".repeat(24), embedUrl: "https://kodik.info/seria/1/hash/720p" }],
          }),
        },
        policy,
      );
      const pending = direct.resolve("anime", "a".repeat(24), "8.8.8.8", viewer);
      await started;
      try {
        await switchMode(owner, "user");
      } finally {
        release();
      }
      assert.equal((await pending).mode, "embed");
      await switchMode(owner, "actual");

      // Demotion ignores an old simulated paid mode and removes the developer endpoint.
      await switchMode(admin, "subscriber");
      await db.userRole.deleteMany({ where: { userId: admin.userId } });
      await access(admin, false, "none");
      assert.equal((await get(endpoint, admin)).statusCode, 403);
      assert.equal((await post(endpoint, { mode: "actual" }, admin)).statusCode, 403);
      await db.user.update({ where: { id: owner.userId }, data: { disabledAt: new Date() } });
      await access(owner, false, "none", false);
      assert.equal((await get(endpoint, owner)).statusCode, 401);
      await db.user.update({ where: { id: owner.userId }, data: { disabledAt: null } });
      await switchMode(owner, "guest");
      assert.equal((await post("/api/auth/logout", {}, owner)).statusCode, 201);
      assert.equal((await get(endpoint, owner)).statusCode, 401);
      assert.equal((await post(endpoint, { mode: "actual" }, owner)).statusCode, 401);
      await access(otherDevice, true, "staff");
      const audit = await db.auditEvent.findMany({
        where: { actorId: owner.userId, action: "account.developer-access.changed" },
      });
      assert.ok(
        audit.some((event) => event.details.before === "guest" && event.details.after === "actual"),
      );
      let limited = false;
      for (let index = 0; index < 121; index++) {
        const response = await get("/api/auth/options");
        if (response.statusCode === 429) {
          limited = true;
          break;
        }
        assert.equal(response.statusCode, 200);
      }
      assert.equal(limited, true);
      assert.equal((await get("/api/availability")).statusCode, 200);
      assert.equal((await post(endpoint, { mode: "subscriber" }, regular)).statusCode, 403);
      await switchMode(otherDevice, "guest");
      assert.equal((await get(endpoint, otherDevice)).json().mode, "guest");
      assert.equal((await get("/api/auth/me", otherDevice)).statusCode, 401);
      await access(otherDevice, false, "none", false);
      await switchMode(otherDevice, "actual");
      assert.deepEqual((await get("/api/auth/me", otherDevice)).json().roles, ["owner"]);
      await access(otherDevice, true, "staff");
      const restoredViewer = await policy.viewer({
        headers: { cookie: otherDevice.cookie },
        ip: "127.0.0.1",
      });
      assert.equal((await policy.access(restoredViewer)).nativeAccess, true);
    } finally {
      await app.close();
      await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  },
);
