import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { digest, randomToken, csrfToken } from "../apps/api/dist/auth/security.js";
import { SubscriptionsService } from "../apps/api/dist/subscriptions/subscriptions.service.js";
import { DirectStreamService } from "../apps/api/dist/playback/direct-stream.service.js";
import {
  subscriptionQuote,
  defaultSubscriptionPlans,
  subscriptionPromotionEditSchema,
  nativeAccessEditSchema,
} from "../packages/contracts/dist/subscriptions.js";
import { kodikResume } from "../apps/web/lib/kodik-resume.ts";

test("subscription quotes apply a first monthly discount once and the best active promotion without stacking", () => {
  const plan = { ...defaultSubscriptionPlans[0], amountMinor: 19999 },
    now = new Date("2026-10-09T12:00:00Z");
  const promo = {
    id: randomUUID(),
    name: "Осень",
    percent: 30,
    months: [],
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: "2026-11-01T00:00:00Z",
    enabled: true,
  };
  assert.equal(subscriptionQuote(plan, [promo], true, now).discountPercent, 50);
  assert.equal(subscriptionQuote(plan, [promo], true, now).finalAmountMinor, 10000);
  assert.equal(subscriptionQuote({ ...plan, months: 3 }, [promo], true, now).discountPercent, 30);
  assert.equal(subscriptionQuote(plan, [{ ...promo, percent: 70 }], true, now).discountPercent, 70);
  assert.equal(
    subscriptionQuote(plan, [{ ...promo, enabled: false }], false, now).discountPercent,
    0,
  );
  assert.equal(
    subscriptionQuote(plan, [{ ...promo, endsAt: now.toISOString() }], false, now).discountPercent,
    0,
  );
  assert.equal(
    subscriptionQuote({ ...plan, amountMinor: null }, [], true, now).finalAmountMinor,
    null,
  );
  assert.equal(
    subscriptionPromotionEditSchema.safeParse({
      ...promo,
      id: undefined,
      reason: "Тест",
      endsAt: promo.startsAt,
    }).success,
    false,
  );
  assert.equal(
    nativeAccessEditSchema.safeParse({
      username: "test",
      enabled: true,
      expiresAt: null,
      reason: "Тест",
    }).success,
    false,
  );
  assert.equal(
    nativeAccessEditSchema.safeParse({
      username: "test",
      enabled: false,
      expiresAt: null,
      reason: "Тест",
      userId: randomUUID(),
    }).success,
    false,
  );
});
test("Kodik resumes after lost readiness, clamps duration and bounds failed seek without counting the initial jump", () => {
  const resume = kodikResume(120);
  assert.equal(resume.seek(0), 120);
  assert.equal(resume.observe(0, 500), "waiting");
  assert.equal(resume.seek(1500), 120);
  assert.equal(resume.observe(121, 1600), "restored");
  assert.equal(resume.seek(3000), null);
  const shortened = kodikResume(999);
  shortened.duration(90);
  assert.equal(shortened.seek(0), 89);
  assert.equal(shortened.observe(88, 1), "restored");
  const missing = kodikResume(30);
  missing.seek(0);
  assert.equal(missing.observe(0, 20000), "waiting");
  assert.equal(missing.observe(0, 31999), "waiting");
  assert.equal(missing.observe(0, 32000), "failed");
  assert.equal(missing.observe(1, 33000), "restored");
});

test("direct streams bound concurrent authorization and recheck revoked access after fetching files", async () => {
  const config = readConfig({
    NODE_ENV: "test",
    ALLOW_KODIK_DIRECT: "true",
    KODIK_PRIVATE_KEY: "CONCURRENCY_PRIVATE_SENTINEL",
    KODIK_TOKEN: "CONCURRENCY_PUBLIC_SENTINEL",
  });
  const providers = { state: async () => "enabled", hidesCredential: () => false };
  const playback = {
    find: async () => ({
      sources: [{ id: "a".repeat(24), embedUrl: "https://kodik.info/seria/1/hash/720p" }],
    }),
  };
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let files = 0;
  const response = () =>
    Response.json({
      links: { 720: [{ Src: "https://media.example.com/video.m3u8", Type: "hls" }] },
    });
  const service = new DirectStreamService(
    config,
    async () => {
      files++;
      await pending;
      return response();
    },
    providers,
    playback,
    { access: async () => ({ nativeAccess: true }) },
  );
  const requests = Array.from({ length: 10 }, () =>
    service.resolve("anime", "a".repeat(24), "8.8.8.8", "viewer"),
  );
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(files, 4);
  } finally {
    release();
  }
  const results = await Promise.all(requests);
  assert.equal(results.filter((result) => result.mode === "direct").length, 4);
  let checks = 0;
  const revoked = new DirectStreamService(config, async () => response(), providers, playback, {
    access: async () => ({ nativeAccess: ++checks === 1 }),
  });
  assert.equal((await revoked.resolve("anime", "a".repeat(24), "8.8.8.8", "viewer")).mode, "embed");
  assert.equal(checks, 2);
});

test(
  "trial, stream authorization, expiry, manual rights and admin promotions use server state",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.match(url.pathname, /_test$/);
    const db = createDatabase(url.href),
      ids = [],
      offers = [];
    const config = readConfig({
      NODE_ENV: "test",
      DATABASE_URL: url.href,
      ALLOW_KODIK_DIRECT: "true",
      KODIK_PRIVATE_KEY: "PRIVATE_SUBSCRIPTION_SENTINEL",
      KODIK_TOKEN: "PUBLIC_SUBSCRIPTION_SENTINEL",
    });
    let upstreamCalls = 0;
    const app = await createApplication(config, async () => {
      upstreamCalls++;
      return Response.json({});
    });
    const server = app.getHttpAdapter().getInstance();
    const ip = "127.0.0." + (10 + Math.floor(Math.random() * 200));
    const get = (path, cookie = "") =>
      server.inject({ url: path, remoteAddress: ip, headers: { cookie } });
    const post = (path, payload, account = {}, extra = {}) =>
      server.inject({
        method: "POST",
        url: path,
        remoteAddress: ip,
        payload,
        headers: {
          cookie: account.cookie ?? "",
          origin: path.startsWith("/api/admin/")
            ? "http://localhost:8022"
            : "http://localhost:8021",
          "x-animesoul-request": "1",
          "x-csrf-token": account.csrf ?? "",
          ...extra,
        },
      });
    async function register() {
      const username = "subscription-" + randomUUID().slice(0, 18);
      const response = await post("/api/auth/register", {
        username,
        email: username + "@example.invalid",
        password: "Subscription testing пароль 2026",
      });
      assert.equal(response.statusCode, 201, response.body);
      const cookie = response.headers["set-cookie"].split(";")[0];
      const me = (await get("/api/auth/me", cookie)).json();
      ids.push(me.id);
      return { id: me.id, username, cookie, csrf: me.csrfToken };
    }
    const planBefore = await db.subscriptionPlan.findUnique({ where: { id: "monthly" } });
    try {
      const guest = await get("/api/subscription");
      assert.equal(guest.statusCode, 200);
      assert.match(guest.headers["cache-control"], /no-store/);
      assert.equal(guest.json().nativeAccess, false);
      assert.equal((await get("/api/admin/subscriptions")).statusCode, 401);
      const user = await register(),
        administrator = await register();
      const trial = await db.subscriptionTrial.findUniqueOrThrow({ where: { userId: user.id } });
      assert.equal(trial.expiresAt - trial.startedAt, 7 * 86400000);
      const active = (await get("/api/subscription", user.cookie)).json();
      assert.equal(active.nativeAccess, true);
      assert.equal(active.source, "trial");
      assert.equal(active.firstMonthDiscount, false);
      assert.equal(active.billingAvailable, false);
      assert.equal((await get("/api/admin/subscriptions", user.cookie)).statusCode, 401);
      assert.equal(
        (
          await post(
            "/api/admin/subscriptions/access",
            {
              username: user.username,
              enabled: true,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
              reason: "Без прав",
            },
            user,
          )
        ).statusCode,
        401,
      );
      const old = await db.user.create({ data: { googleSubject: "old-" + randomUUID() } });
      ids.push(old.id);
      const policy = app.get(SubscriptionsService);
      assert.equal((await policy.access(old.id)).nativeAccess, false);
      let files = 0;
      const direct = new DirectStreamService(
        config,
        async () => {
          files++;
          return Response.json({
            links: { 720: [{ Src: "https://media.example.com/video.m3u8", Type: "hls" }] },
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
      assert.equal((await direct.resolve("anime", "a".repeat(24), "8.8.8.8")).mode, "embed");
      assert.equal(files, 0);
      assert.equal(
        (await direct.resolve("anime", "a".repeat(24), "8.8.8.8", old.id)).mode,
        "embed",
      );
      assert.equal(files, 0);
      assert.equal(
        (await get("/api/anime/anime/stream?source=" + "a".repeat(24))).json().mode,
        "embed",
      );
      assert.equal(upstreamCalls, 0);
      assert.match(
        (await get("/api/anime/anime/stream?source=" + "a".repeat(24))).headers["cache-control"],
        /no-store/,
      );
      assert.equal(
        (await direct.resolve("anime", "a".repeat(24), "8.8.8.8", user.id)).mode,
        "direct",
      );
      assert.equal(files, 1);
      await db.subscriptionTrial.update({
        where: { userId: user.id },
        data: {
          startedAt: new Date(Date.now() - 8 * 86400000),
          expiresAt: new Date(Date.now() - 86400000),
        },
      });
      const expired = (await get("/api/subscription", user.cookie)).json();
      assert.equal(expired.nativeAccess, false);
      assert.equal(expired.firstMonthDiscount, true);
      assert.equal(expired.plans.find((p) => p.months === 1).discountPercent, 50);
      assert.equal(
        (await direct.resolve("anime", "a".repeat(24), "8.8.8.8", user.id)).mode,
        "embed",
      );
      assert.equal(files, 1);
      await db.subscriptionTrial.update({
        where: { userId: user.id },
        data: { discountRedeemedAt: new Date() },
      });
      assert.equal((await policy.access(user.id)).firstMonthDiscount, false);
      const token = randomToken();
      await db.userRole.create({ data: { userId: administrator.id, role: "admin" } });
      await db.session.create({
        data: {
          userId: administrator.id,
          tokenHash: digest(token),
          audience: "admin",
          expiresAt: new Date(Date.now() + 3600000),
          mfaVerifiedAt: new Date(),
        },
      });
      const admin = { cookie: "animesoul_admin_session=" + token, csrf: csrfToken(token) };
      assert.equal((await get("/api/admin/subscriptions", admin.cookie)).statusCode, 200);
      const grant = {
        username: user.username,
        enabled: true,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        reason: "Проверка доступа",
      };
      assert.equal(
        (await post("/api/admin/subscriptions/access", grant, admin, { "x-csrf-token": "bad" }))
          .statusCode,
        403,
      );
      assert.equal(
        (
          await post(
            "/api/admin/subscriptions/access",
            { ...grant, expiresAt: new Date(Date.now() - 1).toISOString() },
            admin,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (await post("/api/admin/subscriptions/access", grant, admin)).json().nativeAccess,
        true,
      );
      assert.equal((await policy.access(user.id)).source, "permission");
      await Promise.all([
        post("/api/admin/subscriptions/access", grant, admin),
        post("/api/admin/subscriptions/access", grant, admin),
      ]);
      assert.equal(
        await db.entitlement.count({
          where: { userId: user.id, revokedAt: null, source: "admin" },
        }),
        1,
      );
      assert.equal(
        (
          await post(
            "/api/admin/subscriptions/plan",
            {
              id: "monthly",
              version: planBefore.version,
              name: "На месяц",
              months: 1,
              amountMinor: 20000,
              currency: "UAH",
              enabled: true,
              reason: "Тест цены",
            },
            admin,
          )
        ).statusCode,
        201,
      );
      const offer = {
        name: "Общая акция",
        percent: 70,
        months: [1, 3],
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        enabled: true,
        reason: "Тест акции",
      };
      const result = await post("/api/admin/subscriptions/promotion", offer, admin);
      assert.equal(result.statusCode, 201, result.body);
      const savedOffer = result.json().promotions.find((p) => p.name === offer.name);
      offers.push(savedOffer.id);
      const quote = (await get("/api/subscription")).json().plans.find((p) => p.id === "monthly");
      assert.equal(quote.discountPercent, 70);
      assert.equal(quote.finalAmountMinor, 6000);
      const archive = Array.from({ length: 101 }, () => ({
        id: randomUUID(),
        name: "Будущая акция",
        percent: 10,
        months: [],
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 2 * 86400000),
        enabled: false,
      }));
      offers.push(...archive.map((item) => item.id));
      await db.subscriptionPromotion.createMany({ data: archive });
      const archivedQuote = (await get("/api/subscription"))
        .json()
        .plans.find((p) => p.id === "monthly");
      assert.equal(archivedQuote.discountPercent, 70);
      assert.equal(archivedQuote.finalAmountMinor, 6000);
      await db.userPermission.create({
        data: { userId: user.id, permission: "player.native", grantedBy: administrator.id },
      });
      assert.equal(
        (
          await post(
            "/api/admin/subscriptions/access",
            { ...grant, enabled: false, expiresAt: null },
            admin,
          )
        ).json().nativeAccess,
        false,
      );
      assert.equal(
        (await direct.resolve("anime", "a".repeat(24), "8.8.8.8", user.id)).mode,
        "embed",
      );
      assert.equal(
        await db.userPermission.count({ where: { userId: user.id, permission: "player.native" } }),
        0,
      );
      assert.ok(
        await db.auditEvent.count({
          where: { actorId: administrator.id, action: "subscription.access.revoked" },
        }),
      );
      await db.user.update({ where: { id: administrator.id }, data: { disabledAt: new Date() } });
      assert.equal(
        (await get("/api/subscription", administrator.cookie)).json().nativeAccess,
        false,
      );
      assert.equal((await get("/api/admin/subscriptions", admin.cookie)).statusCode, 401);
    } finally {
      await app.close();
      await db.subscriptionPlan.update({
        where: { id: "monthly" },
        data: {
          name: planBefore.name,
          months: planBefore.months,
          amountMinor: planBefore.amountMinor,
          currency: planBefore.currency,
          enabled: planBefore.enabled,
          version: planBefore.version,
          description: planBefore.description,
          sortOrder: planBefore.sortOrder,
          permissions: planBefore.permissions,
        },
      });
      await db.subscriptionPromotion.deleteMany({ where: { id: { in: offers } } });
      await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  },
);
