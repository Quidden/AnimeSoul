import { URLSearchParams } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../apps/api/dist/app.js";
import { readConfig } from "../apps/api/dist/config.js";
import { AuthService } from "../apps/api/dist/auth/auth.service.js";
import { AnalyticsService } from "../apps/api/dist/admin/analytics.service.js";
import { createDatabase } from "../packages/database/dist/src/index.js";
import { randomToken, digest, csrfToken } from "../apps/api/dist/auth/security.js";
import { analyticsRange } from "../apps/api/dist/admin/analytics.service.js";
import { csv } from "../apps/api/dist/admin/operations.js";
import {
  analyticsQuerySchema,
  announcementEditSchema,
  adminUsersQuerySchema,
  privateVisibility,
} from "../packages/contracts/dist/index.js";
test("admin date ranges and CSV reject unsafe input and spreadsheet formulas", () => {
  const q = analyticsQuerySchema.parse({
    period: "custom",
    from: "2026-10-01",
    to: "2026-10-10",
    timezone: "UTC",
  });
  assert.deepEqual(analyticsRange(q), {
    from: "2026-10-01",
    to: "2026-10-10",
    previousFrom: "2026-09-21",
    previousTo: "2026-09-30",
  });
  assert.throws(() => analyticsRange({ ...q, from: "2020-01-01" }));
  assert.equal(adminUsersQuerySchema.safeParse({ sort: 'id;DROP TABLE "User"' }).success, false);
  assert.equal(analyticsQuerySchema.safeParse({ from: "2026-02-30" }).success, false);
  assert.match(csv([["=1+1", "-2", "ordinary"]]), /"'=1\+1","'-2","ordinary"/);
});
test(
  "admin platform enforces roles/MFA/CSRF, collects idempotent playback, edits safely and publishes scoped content",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.equal(url.port, "54329");
    assert.ok(url.pathname.endsWith("_test"));
    const db = createDatabase(url.href),
      ids = [],
      animeIds = [],
      messages = [],
      campaigns = [],
      events = [],
      operations = [],
      planId = "admin-test-" + randomUUID().slice(0, 8);
    const app = await createApplication(
      readConfig({ NODE_ENV: "test", DATABASE_URL: url.href }),
      undefined,
      {
        frameFetch: async () =>
          new globalThis.Response(
            JSON.stringify({ quota: 500, quotaUsed: 23, ip: "PRIVATE_QUOTA_IDENTIFIER" }),
            { headers: { "Content-Type": "application/json" } },
          ),
      },
    );
    const server = app.getHttpAdapter().getInstance();
    const prefix = "admin-test-" + randomUUID().slice(0, 8);
    async function user(role) {
      const id = randomUUID();
      ids.push(id);
      await db.user.create({
        data: {
          id,
          email: prefix + ids.length + "@example.invalid",
          passwordHash: "TEST_ONLY_INVALID_PASSWORD_HASH",
          profile: {
            create: {
              username: prefix + ids.length,
              usernameKey: prefix + ids.length,
              visibility: privateVisibility,
              content: {},
            },
          },
          ...(role ? { roles: { create: { role } } } : {}),
        },
      });
      return id;
    }
    async function session(id, audience = "admin", mfa = true) {
      const token = randomToken();
      await db.session.create({
        data: {
          userId: id,
          tokenHash: digest(token),
          audience,
          expiresAt: new Date(Date.now() + 3600000),
          mfaVerifiedAt: mfa ? new Date() : null,
        },
      });
      return {
        cookie: `animesoul_${audience}_session=${token}`,
        origin: audience === "admin" ? "http://localhost:8022" : "http://localhost:8021",
        "x-animesoul-request": "1",
        "x-csrf-token": csrfToken(token),
      };
    }
    const write = (version = 0) => {
      const operationId = randomUUID();
      operations.push(operationId);
      return { operationId, reason: "Integration verification", version };
    };
    try {
      const owner = await user("owner"),
        admin = await user("admin"),
        target = await user(),
        delegate = await user();
      await db.userPermission.create({
        data: { userId: delegate, permission: "providers.yummy.manage", grantedBy: owner },
      });
      const ownerHeaders = await session(owner),
        adminHeaders = await session(admin),
        userHeaders = await session(target, "web"),
        delegateHeaders = await session(delegate),
        noMfa = await session(owner, "admin", false);
      for (const headers of [{}, delegateHeaders, noMfa, userHeaders]) {
        const r = await server.inject({ url: "/api/admin/platform/users", headers });
        assert.ok([401, 403].includes(r.statusCode), r.body);
      }
      const denied = await server.inject({
        method: "POST",
        url: `/api/admin/platform/users/${target}`,
        headers: { ...ownerHeaders, "x-csrf-token": "wrong" },
        payload: { ...write(), disabled: true },
      });
      assert.equal(denied.statusCode, 403);
      const a = randomUUID(),
        b = randomUUID(),
        c = randomUUID();
      animeIds.push(a, b, c);
      for (const [id, related] of [
        [a, [b]],
        [b, [a]],
        [c, []],
      ])
        await db.anime.create({
          data: {
            id,
            slug: prefix + "-" + id,
            title: "Same title",
            originalTitle: "Same title",
            description: "Fixture",
            year: 2026,
            genres: [],
            aliases: [],
            status: "released",
            published: true,
            details: { relatedAnimeIds: related },
          },
        });
      const event = {
        id: randomUUID(),
        visitorId: randomUUID(),
        visitId: randomUUID(),
        kind: "player_start",
        animeId: a,
        season: "1",
        episode: "2",
        player: "kodik",
      };
      events.push(event.id);
      for (let i = 0; i < 2; i++) {
        const r = await server.inject({
          method: "POST",
          url: "/api/experience/event",
          headers: userHeaders,
          payload: event,
        });
        assert.equal(r.statusCode, 201, r.body);
      }
      assert.equal(await db.analyticsEvent.count({ where: { id: event.id } }), 1);
      assert.equal(
        (await db.analyticsEvent.findUniqueOrThrow({ where: { id: event.id } })).episode,
        "2",
      );
      const page = { ...event, id: randomUUID(), kind: "page_view", path: "/anime" };
      delete page.player;
      events.push(page.id);
      assert.equal(
        (
          await server.inject({
            method: "POST",
            url: "/api/experience/event",
            headers: userHeaders,
            payload: page,
          })
        ).statusCode,
        201,
      );
      const bad = { ...event, id: randomUUID(), player: "native" };
      assert.equal(
        (
          await server.inject({
            method: "POST",
            url: "/api/experience/event",
            headers: userHeaders,
            payload: bad,
          })
        ).statusCode,
        400,
      );
      const list = await server.inject({
        url:
          "/api/admin/platform/users?" +
          new URLSearchParams({ q: prefix, sort: "launches", minLaunches: "1" }),
        headers: ownerHeaders,
      });
      assert.equal(list.statusCode, 200, list.body);
      assert.equal(list.json().total, 1);
      assert.equal(list.json().items[0].id, target);
      assert.equal(list.json().items[0].launches, 1);
      assert.ok(!list.body.includes("passwordHash"));
      const detail = await server.inject({
        url: `/api/admin/platform/users/${target}`,
        headers: ownerHeaders,
      });
      assert.equal(detail.statusCode, 200, detail.body);
      assert.ok(!detail.body.includes("tokenHash"));
      const self = await server.inject({
        method: "POST",
        url: `/api/admin/platform/users/${owner}`,
        headers: ownerHeaders,
        payload: { ...write(), roles: ["owner", "admin"] },
      });
      assert.equal(self.statusCode, 403);
      const privilege = await server.inject({
        method: "POST",
        url: `/api/admin/platform/users/${target}`,
        headers: adminHeaders,
        payload: { ...write(), roles: ["admin"] },
      });
      assert.equal(privilege.statusCode, 403);
      const mutation = { ...write(), about: "Public biography" };
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await server.inject({
              method: "POST",
              url: `/api/admin/platform/users/${target}`,
              headers: ownerHeaders,
              payload: mutation,
            })
          ).statusCode,
          201,
        );
      assert.equal(await db.auditEvent.count({ where: { operationId: mutation.operationId } }), 1);
      const stale = await server.inject({
        method: "POST",
        url: `/api/admin/platform/users/${target}`,
        headers: ownerHeaders,
        payload: { ...write(), disabled: true },
      });
      assert.equal(stale.statusCode, 409);
      const plan = {
        id: planId,
        name: "Test plan",
        months: 1,
        amountMinor: 10000,
        currency: "UAH",
        enabled: true,
        create: true,
        ...write(),
      };
      assert.equal(
        (
          await server.inject({
            method: "POST",
            url: "/api/admin/subscriptions/plan",
            headers: ownerHeaders,
            payload: plan,
          })
        ).statusCode,
        201,
      );
      const grant = {
        ...write(1),
        enabled: true,
        planId,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      const issued = await server.inject({
        method: "POST",
        url: `/api/admin/platform/users/${target}/access`,
        headers: ownerHeaders,
        payload: grant,
      });
      assert.equal(issued.statusCode, 201, issued.body);
      assert.equal(issued.json().user.subscription.planId, planId);
      assert.equal(issued.json().accessHistory[0].amountMinor, 10000);
      const quota = await server.inject({ url: "/api/search/frame/quota" });
      assert.equal(quota.statusCode, 200, quota.body);
      assert.ok(!quota.body.includes("PRIVATE_QUOTA_IDENTIFIER"));
      const quotaId = await app.get(AnalyticsService).quota(quota.json());
      events.push(quotaId);
      const report = await server.inject({
        url: "/api/admin/platform/analytics?period=7&userId=" + target,
        headers: ownerHeaders,
      });
      assert.equal(report.statusCode, 200, report.body);
      assert.equal(report.json().current.launches, 1);
      assert.equal(report.json().current.pageViews, 1);
      assert.ok(report.json().buckets.length > 0);
      assert.ok(report.json().quotaHistory.some((v) => v.used === 23 && v.total === 500));
      for (const scope of ["franchise", "season"]) {
        const payload = {
          ...write(),
          title: prefix + scope,
          body: "Visible scoped notice",
          kind: "info",
          audience: "all",
          role: null,
          planId: null,
          userId: null,
          link: null,
          enabled: true,
          startsAt: new Date(Date.now() - 1000).toISOString(),
          endsAt: null,
          scope,
          animeId: a,
          dismissible: true,
          priority: 1,
        };
        assert.equal(announcementEditSchema.safeParse(payload).success, true);
        const r = await server.inject({
          method: "POST",
          url: "/api/admin/platform/announcements",
          headers: ownerHeaders,
          payload,
        });
        assert.equal(r.statusCode, 201, r.body);
        const row = await db.announcement.findFirstOrThrow({ where: { title: payload.title } });
        messages.push(row.id);
      }
      const first = await server.inject({ url: "/api/experience?animeId=" + a });
      const related = await server.inject({ url: "/api/experience?animeId=" + b });
      const unrelated = await server.inject({ url: "/api/experience?animeId=" + c });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().announcements.filter((m) => messages.includes(m.id)).length, 2);
      assert.equal(related.json().announcements.filter((m) => messages.includes(m.id)).length, 1);
      assert.equal(unrelated.json().announcements.filter((m) => messages.includes(m.id)).length, 0);
      const notification = {
        ...write(),
        title: prefix + "Inbox",
        body: "Private notification",
        kind: "important",
        audience: "user",
        userId: target,
        role: null,
        planId: null,
        link: "/subscription",
        enabled: true,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: null,
      };
      const saved = await server.inject({
        method: "POST",
        url: "/api/admin/platform/notifications",
        headers: ownerHeaders,
        payload: notification,
      });
      assert.equal(saved.statusCode, 201, saved.body);
      const campaign = await db.notificationCampaign.findFirstOrThrow({
        where: { title: notification.title },
      });
      campaigns.push(campaign.id);
      const inbox = await server.inject({ url: "/api/experience/inbox", headers: userHeaders });
      assert.equal(
        inbox.json().items.some((m) => m.id === campaign.id),
        true,
      );
      const foreign = await server.inject({
        method: "POST",
        url: "/api/experience/inbox/" + campaign.id,
        headers: await session(delegate, "web"),
        payload: { dismiss: true },
      });
      assert.equal(foreign.statusCode, 404);
      const read = await server.inject({
        method: "POST",
        url: "/api/experience/inbox/" + campaign.id,
        headers: userHeaders,
        payload: { dismiss: false },
      });
      assert.equal(read.statusCode, 201, read.body);
      assert.equal(read.json().items.find((m) => m.id === campaign.id).read, true);
      const blocked = await server.inject({
        method: "POST",
        url: `/api/admin/platform/users/${target}`,
        headers: ownerHeaders,
        payload: { ...write(2), disabled: true },
      });
      assert.equal(blocked.statusCode, 201, blocked.body);
      assert.deepEqual(blocked.json().effectiveRights, []);
      assert.equal(
        (await server.inject({ url: "/api/experience/inbox", headers: userHeaders })).statusCode,
        401,
      );
      const journal = await server.inject({
        url: "/api/admin/platform/journal?userId=" + target + "&category=all",
        headers: ownerHeaders,
      });
      assert.equal(journal.statusCode, 200, journal.body);
      assert.ok(journal.json().items.some((item) => item.action === "analytics.player_start"));
      assert.ok(journal.json().items.some((item) => item.action === "admin.user.updated"));
      assert.ok(journal.json().items.every((item) => !("visitorId" in (item.details ?? {}))));
      const exported = await server.inject({
        url: "/api/admin/platform/users.csv?q=" + prefix,
        headers: ownerHeaders,
      });
      assert.equal(exported.statusCode, 200, exported.body);
      assert.match(exported.headers["content-type"], /text\/csv/);
      const firstOwner = await user("owner"),
        secondOwner = await user("owner"),
        firstHeaders = await session(firstOwner),
        secondHeaders = await session(secondOwner);
      const concurrent = await Promise.all([
        server.inject({
          method: "POST",
          url: `/api/admin/platform/users/${secondOwner}`,
          headers: firstHeaders,
          payload: { ...write(), disabled: true },
        }),
        server.inject({
          method: "POST",
          url: `/api/admin/platform/users/${firstOwner}`,
          headers: secondHeaders,
          payload: { ...write(), disabled: true },
        }),
      ]);
      assert.equal(concurrent.filter((r) => r.statusCode === 201).length, 1);
      assert.ok(concurrent.some((r) => [401, 403].includes(r.statusCode)));
      assert.equal(
        await db.user.count({ where: { id: { in: [firstOwner, secondOwner] }, disabledAt: null } }),
        1,
      );
    } finally {
      await db.notificationCampaign.deleteMany({ where: { id: { in: campaigns } } });
      await db.announcement.deleteMany({ where: { id: { in: messages } } });
      await db.analyticsEvent.deleteMany({ where: { id: { in: events } } });
      await db.auditEvent.deleteMany({
        where: { OR: [{ actorId: { in: ids } }, { operationId: { in: operations } }] },
      });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.subscriptionPlan.deleteMany({ where: { id: planId } });
      await db.anime.deleteMany({ where: { id: { in: animeIds } } });
      await app.close();
      await app
        .get(AuthService)
        .db.$disconnect()
        .catch(() => {});
      await db.$disconnect();
    }
  },
);
