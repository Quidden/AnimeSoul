import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../dist/app.js";
import { readConfig } from "../dist/config.js";
test("production refuses development catalog", () => {
  assert.throws(() => readConfig({ NODE_ENV: "production", DEMO_CATALOG: "true" }), /forbidden/);
});
test("HTTP boundaries protect admin, profiles and catalog search", async () => {
  const app = await createApplication(readConfig({ NODE_ENV: "test", DEMO_CATALOG: "true" }));
  const server = app.getHttpAdapter().getInstance();
  try {
    const health = await server.inject({ method: "GET", url: "/api/health" });
    assert.equal(health.statusCode, 200);
    assert.equal((await server.inject({ method: "GET", url: "/api/ready" })).statusCode, 503);
    for (const url of ["/api/admin", "/api/admin/statistics", "/api/admin/providers/yummy"]) {
      const response = await server.inject({
        method: "GET",
        url,
        headers: { "x-role": "admin", authorization: "Bearer fabricated" },
      });
      assert.equal(response.statusCode, 401, url);
      assert.equal(response.headers["cache-control"], "no-store");
    }
    const profile = await server.inject({ method: "GET", url: "/api/profiles/soul" });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().presence, "offline");
    for (const key of ["folders", "ratings", "visibility"])
      assert.equal(key in profile.json(), false);
    const sql = await server.inject({
      method: "GET",
      url: "/api/catalog?q=" + encodeURIComponent("' OR 1=1; DROP TABLE users; --"),
    });
    assert.deepEqual(sql.json().items, []);
    assert.equal(
      (await server.inject({ method: "GET", url: "/api/catalog?q=" + "x".repeat(101) })).statusCode,
      400,
    );
    assert.equal(
      (await server.inject({ method: "GET", url: "/api/anime/missing" })).statusCode,
      404,
    );
    const found = await server.inject({
      method: "GET",
      url: "/api/catalog?q=" + encodeURIComponent("Атака"),
    });
    assert.equal(found.json().items[0].slug, "attack-on-titan");
    assert.equal(health.headers["x-content-type-options"], "nosniff");
    assert.equal(health.headers["x-frame-options"], "SAMEORIGIN");
  } finally {
    await app.close();
  }
});
