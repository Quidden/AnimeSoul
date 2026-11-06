import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  frameSearchLimitResponseSchema,
  rateLimitErrorSchema,
  frameSearchBudgets,
} from "../../../packages/contracts/dist/index.js";
import { FrameSearchBudgetService } from "../dist/catalog/frame-search-budget.service.js";
import { AuthService } from "../dist/auth/auth.service.js";
import { createApplication } from "../dist/app.js";
import { readConfig } from "../dist/config.js";
import { createDatabase } from "../../../packages/database/dist/src/index.js";

const request = (ip = "127.0.0.1", headers = {}) => ({ ip, headers });
const auth = () => ({
  config: readConfig({ NODE_ENV: "test" }),
  requireSession: async (req) => ({
    userId: req.headers.cookie.includes("a".repeat(43)) ? "alice" : "bob",
  }),
});

test("daily frame quotas isolate normalized IPs and verified users, not forwarded headers or cookie strings", async () => {
  const budgets = new FrameSearchBudgetService(auth());
  const guest = await budgets.subject(request());
  assert.equal(
    (
      await budgets.subject(
        request("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.4", cookie: "arbitrary=x" }),
      )
    ).key,
    guest.key,
  );
  const alice = await budgets.subject(
    request("127.0.0.1", { cookie: "animesoul_web_session=" + "a".repeat(43) }),
  );
  assert.equal(alice.scope, "user");
  assert.equal(
    (
      await budgets.subject(
        request("127.0.0.2", { cookie: "animesoul_web_session=" + "a".repeat(43) }),
      )
    ).key,
    alice.key,
  );
  const bob = await budgets.subject(
    request("127.0.0.1", { cookie: "animesoul_web_session=" + "b".repeat(43) }),
  );
  assert.notEqual(alice.key, bob.key);
  const now = 100000;
  for (let i = 0; i < 10; i++) await budgets.consume(alice, now);
  await assert.rejects(
    budgets.consume(alice, now),
    (error) => error.getResponse().limitScope === "personal",
  );
  assert.equal((await budgets.quota(alice, undefined, now)).personal.remaining, 0);
  assert.equal((await budgets.quota(bob, undefined, now)).personal.remaining, 10);
  assert.equal((await budgets.quota(bob, undefined, now)).global.remaining, 90);
  await budgets.consume(bob, now);
  assert.equal((await budgets.quota(bob, undefined, now)).personal.remaining, 9);
  const legacy = await budgets.quota(bob, { total: 500, used: 23, remaining: 477 }, now);
  assert.equal(legacy.total, 500);
  assert.equal(legacy.used, 23);
  assert.equal(legacy.global.total, 100);
  assert.equal(legacy.global.remaining, 89);
  const reset = await budgets.quota(
    alice,
    undefined,
    now + frameSearchBudgets.windowSeconds * 1000,
  );
  assert.equal(reset.personal.remaining, 10);
  assert.equal(reset.global.remaining, 100);
});

test("the shared daily ceiling is atomic and quota reads/rejected attempts never spend another visitor's budget", async () => {
  const budgets = new FrameSearchBudgetService(auth());
  const now = 100000;
  for (let visitor = 0; visitor < 10; visitor++) {
    const subject = await budgets.subject(request("127.0.0." + (visitor + 1)));
    await Promise.all(Array.from({ length: 10 }, () => budgets.consume(subject, now)));
  }
  const next = await budgets.subject(request("127.0.0.20"));
  await assert.rejects(
    budgets.consume(next, now),
    (error) => error.getResponse().limitScope === "global",
  );
  for (let i = 0; i < 3; i++) {
    const quota = await budgets.quota(next, undefined, now);
    assert.equal(quota.personal.remaining, 10);
    assert.equal(quota.global.remaining, 0);
  }
});

test("HTTP frame quota exposes both budgets; invalid frames do not count and daily errors include Retry-After", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 100000 });
  const requireApi = createRequire(new URL("../package.json", import.meta.url));
  const { default: sharp } = await import(pathToFileURL(requireApi.resolve("sharp")));
  const payload = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#000000" },
  })
    .png()
    .toBuffer();
  let external = 0;
  const app = await createApplication(readConfig({ NODE_ENV: "test" }), fetch, {
    frameFetch: async (url) => {
      if (url.endsWith("/me")) return Response.json({ quota: 100, quotaUsed: 0 });
      external++;
      return Response.json({ result: [] });
    },
  });
  const server = app.getHttpAdapter().getInstance();
  const headers = {
    origin: "http://localhost:8021",
    "x-animesoul-request": "1",
    "content-type": "application/octet-stream",
  };
  const send = (value) =>
    server.inject({ method: "POST", url: "/api/search/frame", headers, payload: value });
  try {
    assert.equal((await send("invalid")).statusCode, 400);
    const initial = frameSearchLimitResponseSchema.parse(
      (await server.inject({ url: "/api/search/frame/limit" })).json(),
    );
    assert.equal(initial.personal.remaining, 10);
    for (let i = 0; i < 10; i++) {
      context.mock.timers.tick(61000);
      const response = await send(payload);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().quota.personal.remaining, 9 - i);
    }
    context.mock.timers.tick(61000);
    const limited = await send(payload);
    assert.equal(limited.statusCode, 429);
    const body = rateLimitErrorSchema.parse(limited.json());
    assert.equal(body.limitScope, "personal");
    assert.equal(Number(limited.headers["retry-after"]), body.retryAfter);
    assert.equal(external, 10);
    const other = frameSearchLimitResponseSchema.parse(
      (await server.inject({ url: "/api/search/frame/quota", remoteAddress: "127.0.0.2" })).json(),
    );
    assert.equal(other.personal.remaining, 10);
    assert.equal(other.global.remaining, 90);
  } finally {
    await app.close();
  }
});

test("the minute frame gate follows verified users even when they share one IP", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test" }), fetch, {
    frameFetch: async (url) =>
      Response.json(url.endsWith("/me") ? { quota: 100, quotaUsed: 0 } : { result: [] }),
  });
  app.get(AuthService).requireSession = auth().requireSession;
  const requireApi = createRequire(new URL("../package.json", import.meta.url));
  const { default: sharp } = await import(pathToFileURL(requireApi.resolve("sharp")));
  const payload = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#000000" },
  })
    .png()
    .toBuffer();
  const send = (user) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: "/api/search/frame",
        payload,
        headers: {
          origin: "http://localhost:8021",
          "x-animesoul-request": "1",
          "content-type": "application/octet-stream",
          cookie: "animesoul_web_session=" + user.repeat(43),
        },
      });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await send("a")).statusCode, 200);
    assert.equal((await send("a")).statusCode, 429);
    assert.equal((await send("b")).statusCode, 200);
  } finally {
    await app.close();
  }
});

test(
  "daily counters persist across API instances and simultaneous PostgreSQL reservations cannot overdraw",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /_test$/);
    const config = readConfig({
      NODE_ENV: "test",
      DATABASE_URL: url.href,
      TRACE_MOE_API_KEY: randomUUID(),
    });
    const firstAuth = new AuthService(config),
      secondAuth = new AuthService(config);
    const first = new FrameSearchBudgetService(firstAuth),
      second = new FrameSearchBudgetService(secondAuth);
    const subject = await first.subject(request("127.0.0.1"));
    const others = await Promise.all(
      ["127.0.0.2", "127.0.0.3"].map((ip) => first.subject(request(ip))),
    );
    const db = createDatabase(url.href);
    try {
      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).consume(subject)),
      );
      assert.equal(attempts.filter((row) => row.status === "fulfilled").length, 10);
      assert.equal((await second.quota(subject)).personal.remaining, 0);
      assert.equal((await second.quota(subject)).global.remaining, 90);
      await db.authThrottle.update({ where: { key: first.globalKey }, data: { attempts: 99 } });
      const last = await Promise.allSettled([first.consume(others[0]), second.consume(others[1])]);
      assert.equal(last.filter((row) => row.status === "fulfilled").length, 1);
      assert.equal(
        last.find((row) => row.status === "rejected").reason.getResponse().limitScope,
        "global",
      );
      assert.equal((await second.quota(subject)).global.remaining, 0);
    } finally {
      await db.authThrottle.deleteMany({
        where: { key: { in: [subject.key, ...others.map((row) => row.key), first.globalKey] } },
      });
      await firstAuth.onModuleDestroy();
      await secondAuth.onModuleDestroy();
      await db.$disconnect();
    }
  },
);
