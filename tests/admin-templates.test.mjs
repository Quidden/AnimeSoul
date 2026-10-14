import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { AuthService } from "../apps/api/dist/auth/auth.service.js";
import { AvailabilityService } from "../apps/api/dist/admin/availability.service.js";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { digest, csrfToken, randomToken } from "../apps/api/dist/auth/security.js";
import {
  privateVisibility,
  maintenanceSettingsSchema,
  adminTemplateEditSchema,
  validateTemplatePayload,
} from "../packages/contracts/dist/index.js";
import { maintenanceHtml } from "../apps/web/lib/maintenance.ts";

test("maintenance page escapes administrator text and template contracts reject invalid configuration", () => {
  const html = maintenanceHtml(
    {
      title: '<script>alert("x")</script>',
      body: '<img src=x onerror="alert(1)">\nОбновление',
      endsAt: null,
    },
    '/catalog?x="',
  );
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /x=&quot;/);
  assert.equal(
    adminTemplateEditSchema.safeParse({
      name: "Unsafe",
      kind: "winter",
      pinned: false,
      payload: { mode: "on", password: "SECRET" },
      reason: "Test",
      operationId: randomUUID(),
      version: 0,
    }).success,
    false,
  );
  assert.throws(() =>
    validateTemplatePayload("notification", {
      title: "Test",
      body: "Test",
      kind: "info",
      audience: "all",
      role: null,
      planId: null,
      userId: null,
      link: null,
      startsAt: new Date().toISOString(),
      endsAt: null,
    }),
  );
});
test(
  "templates copy, pin and publish through real writers; maintenance blocks public operations while administration stays available",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "54329");
    assert.equal(url.pathname, "/animesoul_test");
    const db = createDatabase(url.href),
      id = randomUUID(),
      token = randomToken(),
      ops = [],
      keys = [],
      campaigns = [],
      plans = [],
      promotions = [];
    const before = await db.siteSetting.findMany({
      where: { key: { in: ["availability.maintenance", "appearance.winter"] } },
    });
    const app = await createApplication(readConfig({ NODE_ENV: "test", DATABASE_URL: url.href }));
    const server = app.getHttpAdapter().getInstance(),
      prefix = "template-test-" + id.slice(0, 8),
      headers = {
        cookie: `animesoul_admin_session=${token}`,
        origin: "http://localhost:8022",
        "x-animesoul-request": "1",
        "x-csrf-token": csrfToken(token),
      };
    const write = (version = 0) => {
      const operationId = randomUUID();
      ops.push(operationId);
      return { operationId, version, reason: "Template integration verification" };
    };
    async function post(path, payload, h = headers) {
      return server.inject({
        method: "POST",
        url: "/api/admin/platform/" + path,
        headers: h,
        payload,
      });
    }
    async function get(path, h = headers) {
      return server.inject({ method: "GET", url: "/api/admin/platform/" + path, headers: h });
    }
    async function save(kind, payload, name = prefix) {
      const r = await post("templates", { ...write(), name, kind, payload, pinned: false });
      assert.equal(r.statusCode, 201, r.body);
      keys.push("template." + r.json().id);
      return r.json();
    }
    async function publish(t, extra = {}) {
      return post("templates/" + t.id + "/publish", {
        ...write(t.version),
        targetVersion: 0,
        ...extra,
      });
    }
    try {
      await db.user.create({
        data: {
          id,
          email: prefix + "@example.invalid",
          passwordHash: "TEST_ONLY",
          roles: { create: { role: "owner" } },
          profile: {
            create: {
              username: prefix,
              usernameKey: prefix,
              visibility: privateVisibility,
              content: {},
            },
          },
        },
      });
      await db.session.create({
        data: {
          userId: id,
          tokenHash: digest(token),
          audience: "admin",
          mfaVerifiedAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      assert.equal((await get("templates", {})).statusCode, 401);
      const payload = {
        title: "Integration notice",
        body: "Original reusable text",
        kind: "info",
        audience: "authenticated",
        role: null,
        planId: null,
        userId: null,
        link: "/subscription",
        startsAt: new Date().toISOString(),
        endsAt: null,
      };
      let t = await save("notification", payload);
      assert.equal(
        (
          await post(
            "templates",
            { ...write(), name: prefix, kind: "notification", payload, pinned: false },
            { ...headers, "x-csrf-token": "WRONG" },
          )
        ).statusCode,
        403,
      );
      const copyWrite = write(t.version),
        copy = await post("templates/" + t.id + "/copy", copyWrite);
      assert.equal(copy.statusCode, 201, copy.body);
      keys.push("template." + copy.json().id);
      assert.notEqual(copy.json().id, t.id);
      assert.equal(copy.json().pinned, false);
      assert.equal(
        (await post("templates/" + t.id + "/copy", copyWrite)).json().id,
        copy.json().id,
      );
      let c = copy.json();
      const changed = await post("templates", {
        ...write(c.version),
        id: c.id,
        name: prefix + " edited",
        kind: c.kind,
        pinned: true,
        payload: { ...c.payload, body: "Edited copy" },
      });
      assert.equal(changed.statusCode, 201, changed.body);
      c = changed.json();
      assert.equal((await get("templates?q=" + prefix)).json().items[0].id, c.id);
      assert.equal((await get("templates/" + t.id)).json().payload.body, payload.body);
      const publication = { ...write(c.version), targetVersion: 0, endsAt: null };
      const published = await post("templates/" + c.id + "/publish", publication);
      assert.equal(published.statusCode, 201, published.body);
      campaigns.push(published.json().targetId);
      assert.equal(
        (await post("templates/" + c.id + "/publish", publication)).json().targetId,
        published.json().targetId,
      );
      assert.equal(
        (await db.notificationCampaign.findUnique({ where: { id: published.json().targetId } }))
          .body,
        "Edited copy",
      );
      assert.equal(
        (
          await post("templates/" + c.id + "/publish", {
            ...write(c.version - 1),
            targetVersion: 0,
          })
        ).statusCode,
        409,
      );
      assert.equal((await get("templates/" + c.id)).json().payload.body, "Edited copy");
      const planId = prefix,
        plan = await save("plan", {
          id: planId,
          name: "Template plan",
          description: "",
          sortOrder: 0,
          months: 1,
          amountMinor: 10000,
          currency: "UAH",
          permissions: ["player.native"],
        });
      const planPublished = await publish(plan);
      assert.equal(planPublished.statusCode, 201, planPublished.body);
      plans.push(planId);
      assert.equal((await db.subscriptionPlan.findUnique({ where: { id: planId } })).enabled, true);
      assert.equal((await publish(plan)).statusCode, 409); // A newly created target cannot silently become an update.
      const preview = (await get("templates/" + plan.id + "/preview")).json();
      assert.equal(
        (await publish(plan, { targetVersion: preview.targetVersion, targetExists: true }))
          .statusCode,
        201,
      );
      const promotion = await save("promotion", {
        name: "Template offer",
        description: "",
        months: [1],
        planIds: [planId],
        percent: 15,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      });
      const offer = await publish(promotion);
      assert.equal(offer.statusCode, 201, offer.body);
      promotions.push(offer.json().targetId);
      assert.equal(
        (await db.subscriptionPromotion.findUnique({ where: { id: offer.json().targetId } }))
          .percent,
        15,
      );
      const global = await save("announcement", {
        ...payload,
        audience: "all",
        scope: "global",
        animeId: null,
        dismissible: true,
        priority: 0,
      });
      const globalPublished = await publish(global);
      assert.equal(globalPublished.statusCode, 201, globalPublished.body);
      const animeId = randomUUID();
      await db.anime.create({
        data: {
          id: animeId,
          slug: prefix,
          title: prefix,
          originalTitle: prefix,
          description: "Test only",
          year: 2026,
          genres: [],
          aliases: [],
          status: "released",
          published: true,
          details: {},
        },
      });
      try {
        const anime = await save("anime-notice", {
          ...payload,
          audience: "all",
          scope: "season",
          animeId,
          dismissible: true,
          priority: 0,
        });
        const animePublished = await publish(anime);
        assert.equal(animePublished.statusCode, 201, animePublished.body);
        const scoped = await server.inject({
          method: "GET",
          url: "/api/experience?animeId=" + animeId,
        });
        assert.ok(scoped.json().announcements.some((m) => m.id === animePublished.json().targetId));
        assert.ok(
          !(await server.inject({ method: "GET", url: "/api/experience" }))
            .json()
            .announcements.some((m) => m.id === animePublished.json().targetId),
        );
        await db.announcement.deleteMany({
          where: { id: { in: [globalPublished.json().targetId, animePublished.json().targetId] } },
        });
      } finally {
        await db.announcement.deleteMany({ where: { animeId } });
        await db.anime.delete({ where: { id: animeId } });
        await db.announcement.deleteMany({ where: { id: globalPublished.json().targetId } });
      }
      const winter = await save("winter", {
        mode: "on",
        startsAt: null,
        endsAt: null,
        snow: true,
        intensity: 10,
        speed: 1,
        garlands: false,
      });
      const winterPreview = (await get("templates/" + winter.id + "/preview")).json();
      assert.equal(
        (await publish(winter, { targetVersion: winterPreview.targetVersion })).statusCode,
        201,
      );
      assert.equal((await get("winter")).json().settings.intensity, 10);
      assert.equal(
        (await publish(winter, { targetVersion: winterPreview.targetVersion })).statusCode,
        409,
      );
      const availability = app.get(AvailabilityService);
      const config = (await get("maintenance")).json(),
        settings = maintenanceSettingsSchema.parse({
          enabled: true,
          title: "Обновляем AnimeSoul",
          body: "Обновление по расписанию",
          endsAt: new Date(Date.now() + 60000).toISOString(),
        });
      assert.equal(
        (await post("maintenance", { ...write(config.version), settings })).statusCode,
        201,
      );
      assert.equal(
        (await server.inject({ method: "GET", url: "/api/availability" })).json().active,
        true,
      );
      for (const path of [
        "/api/catalog",
        "/api/experience",
        "/api/auth/me",
        "/api/search?q=test",
      ]) {
        const r = await server.inject({ method: "GET", url: path });
        assert.equal(r.statusCode, 503, r.body);
        assert.equal(r.headers["retry-after"], "60");
      }
      assert.equal(
        (await server.inject({ method: "POST", url: "/api/experience/event", payload: {} }))
          .statusCode,
        503,
      );
      assert.equal((await get("templates")).statusCode, 200);
      assert.equal((await get("maintenance")).statusCode, 200);
      assert.notEqual((await server.inject({ method: "GET", url: "/api/health" })).statusCode, 503);
      assert.notEqual(
        (await server.inject({ method: "POST", url: "/api/admin/auth/login", payload: {} }))
          .statusCode,
        503,
      );
      assert.equal(
        (await post("maintenance", { ...write(config.version), settings })).statusCode,
        409,
      );
      const maintenanceTemplate = await save("maintenance", {
        ...settings,
        enabled: false,
        endsAt: null,
      });
      const current = (await get("templates/" + maintenanceTemplate.id + "/preview")).json();
      assert.equal(
        (
          await publish(maintenanceTemplate, {
            targetVersion: current.targetVersion,
            targetExists: true,
          })
        ).statusCode,
        201,
      );
      assert.equal(
        (await server.inject({ method: "GET", url: "/api/availability" })).json().active,
        false,
      );
      assert.equal(
        (await server.inject({ method: "GET", url: "/api/experience" })).statusCode,
        200,
      );
      const expired = (await get("maintenance")).json();
      assert.equal(
        (
          await post("maintenance", {
            ...write(expired.version),
            settings: { ...settings, endsAt: new Date(Date.now() - 1000).toISOString() },
          })
        ).statusCode,
        400,
      );
      await db.siteSetting.update({
        where: { key: "availability.maintenance" },
        data: { value: { ...settings, endsAt: new Date(Date.now() - 1000).toISOString() } },
      });
      availability.invalidate();
      assert.equal(
        (await server.inject({ method: "GET", url: "/api/availability" })).json().active,
        false,
      );
      const audit = await db.auditEvent.findMany({ where: { operationId: { in: ops } } });
      assert.ok(audit.some((e) => e.action === "admin.template.published"));
      assert.ok(audit.some((e) => e.action === "admin.maintenance.saved"));
    } finally {
      for (const key of ["availability.maintenance", "appearance.winter"]) {
        const saved = before.find((s) => s.key === key);
        if (saved)
          await db.siteSetting.upsert({
            where: { key },
            create: saved,
            update: { value: saved.value, version: saved.version },
          });
        else await db.siteSetting.deleteMany({ where: { key } });
      }
      await db.siteSetting.deleteMany({ where: { key: { in: keys } } });
      await db.notificationCampaign.deleteMany({ where: { id: { in: campaigns } } });
      await db.subscriptionPromotion.deleteMany({ where: { id: { in: promotions } } });
      await db.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
      await db.auditEvent.deleteMany({ where: { operationId: { in: ops } } });
      await db.user.deleteMany({ where: { id } });
      await app.close();
      await app.get(AuthService).db.$disconnect();
      await db.$disconnect();
    }
  },
);
