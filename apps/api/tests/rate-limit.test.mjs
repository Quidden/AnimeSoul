import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../dist/app.js";
import { readConfig } from "../dist/config.js";

test("public traffic limits do not disable availability or staff mode recovery", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test" }));
  const server = app.getHttpAdapter().getInstance();
  const request = (url, options = {}) =>
    server.inject({ url, remoteAddress: "127.0.0.92", ...options });
  try {
    // Web proxies share one internal IP. A busy page must not look like a server outage.
    for (let index = 0; index < 120; index++) {
      assert.equal((await request("/api/auth/options")).statusCode, 200);
    }
    const limited = await request("/api/auth/options");
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
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
