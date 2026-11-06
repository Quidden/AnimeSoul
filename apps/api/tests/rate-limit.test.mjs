import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../dist/app.js";
import { readConfig } from "../dist/config.js";

function assertLimited(response, max) {
  assert.equal(response.statusCode, 429);
  const retryAfter = Number(response.headers["retry-after"]);
  assert.ok(retryAfter > 0 && retryAfter <= 60);
  assert.equal(Number(response.headers["x-ratelimit-limit"]), max);
  assert.equal(Number(response.headers["x-ratelimit-remaining"]), 0);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), {
    statusCode: 429,
    code: "RATE_LIMITED",
    message: "Слишком много запросов. Подождите и повторите.",
    retryAfter,
  });
}

test("read limits do not disable writes, background traffic, availability or staff recovery", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test" }));
  const server = app.getHttpAdapter().getInstance();
  const request = (url, options = {}) =>
    server.inject({ url, remoteAddress: "127.0.0.92", ...options });
  try {
    // Web proxies share one internal IP. A busy page must not look like a server outage.
    for (let index = 0; index < 600; index++) {
      assert.equal((await request("/api/auth/options?prefetch=" + index)).statusCode, 200);
    }
    assertLimited(await request("/api/auth/options"), 600);
    assertLimited(await request("/api/catalog"), 600);
    assert.equal((await request("/api/auth/options", { method: "HEAD" })).statusCode, 429);
    assert.equal(
      (await request("/api/auth/register", { method: "POST", payload: {} })).statusCode,
      400,
    );
    assert.equal((await request("/api/experience/inbox")).statusCode, 401);
    assert.equal(
      (await request("/api/experience/event", { method: "POST", payload: {} })).statusCode,
      400,
    );
    assert.equal((await request("/api/availability")).statusCode, 200);
    assert.equal((await request("/api/health")).statusCode, 200);
    // Real readiness still fails when PostgreSQL is absent.
    assert.equal((await request("/api/ready")).statusCode, 503);
    assert.equal((await request("/api/auth/me")).statusCode, 401);
    for (let index = 0; index < 120; index++) {
      assert.equal((await request("/api/subscription")).statusCode, 200);
    }
    assert.equal((await request("/api/subscription")).statusCode, 429);
    // The developer endpoint still validates authentication, using its own bounded budget.
    assert.equal((await request("/api/auth/developer-access")).statusCode, 401);
    assert.equal(
      (
        await request("/api/auth/developer-access", {
          method: "POST",
          payload: { mode: "actual" },
          headers: { origin: "http://localhost:8021", "x-animesoul-request": "1" },
        })
      ).statusCode,
      401,
    );
    for (let index = 1; index < 60; index++) {
      assert.equal((await request("/api/auth/developer-access")).statusCode, 401);
    }
    assert.equal((await request("/api/auth/developer-access")).statusCode, 429);
    assert.equal((await request("/api/availability")).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("write limits are shared across mutations but leave catalog and background budgets available", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  const server = app.getHttpAdapter().getInstance();
  const request = (url, options = {}) =>
    server.inject({ url, remoteAddress: "127.0.0.93", ...options });
  try {
    // Invalid writes still consume the budget; changing endpoint/query cannot bypass it.
    for (let index = 0; index < 120; index++) {
      const url = index % 2 ? "/api/auth/login" : "/api/auth/register";
      assert.equal(
        (await request(url + "?attempt=" + index, { method: "POST", payload: {} })).statusCode,
        400,
      );
    }
    assertLimited(await request("/api/auth/login", { method: "POST", payload: {} }), 120);
    assertLimited(
      await request("/api/auth/register", {
        method: "POST",
        payload: {},
        remoteAddress: "::ffff:127.0.0.93",
        headers: { "x-forwarded-for": "203.0.113.1" },
      }),
      120,
    );
    assertLimited(
      await request("/api/experience/inbox/00000000-0000-4000-8000-000000000001", {
        method: "POST",
        payload: { dismiss: true },
      }),
      120,
    );
    assert.equal((await request("/api/catalog")).statusCode, 200);
    assert.equal((await request("/api/auth/options")).statusCode, 200);
    assert.equal((await request("/api/experience/inbox")).statusCode, 401);
    assert.equal(
      (await request("/api/experience/event", { method: "POST", payload: {} })).statusCode,
      400,
    );
    assert.equal(
      (
        await request("/api/auth/login", {
          method: "POST",
          payload: {},
          remoteAddress: "127.0.0.94",
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});

test("experience reads and telemetry have independent bounded budgets and cannot block user actions", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  const server = app.getHttpAdapter().getInstance();
  const request = (url, options = {}) =>
    server.inject({ url, remoteAddress: "127.0.0.95", ...options });
  try {
    for (let index = 0; index < 120; index++) {
      const inbox = index % 2 === 0;
      const response = await request(
        inbox ? "/api/experience/inbox" : "/api/experience?animeId=invalid-" + index,
      );
      assert.equal(response.statusCode, inbox ? 401 : 400);
    }
    assertLimited(await request("/api/experience"), 120);
    assertLimited(await request("/api/experience/inbox?page=2"), 120);
    for (let index = 0; index < 120; index++) {
      assert.equal(
        (
          await request("/api/experience/event?event=" + index, {
            method: "POST",
            payload: {},
          })
        ).statusCode,
        400,
      );
    }
    assertLimited(await request("/api/experience/event", { method: "POST", payload: {} }), 120);
    assert.equal((await request("/api/catalog")).statusCode, 200);
    assert.equal((await request("/api/auth/options")).statusCode, 200);
    assert.equal(
      (await request("/api/auth/register", { method: "POST", payload: {} })).statusCode,
      400,
    );
    assert.equal(
      (
        await request("/api/experience/inbox/00000000-0000-4000-8000-000000000001", {
          method: "POST",
          payload: { dismiss: true },
          headers: { origin: "http://localhost:8021", "x-animesoul-request": "1" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
