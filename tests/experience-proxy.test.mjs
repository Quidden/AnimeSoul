import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../apps/web/app/api/experience/[[...path]]/route.ts";

test("experience proxy preserves rate-limit status, reason and retry duration for reads and events", async () => {
  const previous = globalThis.fetch;
  const body = {
    statusCode: 429,
    code: "RATE_LIMITED",
    message: "Слишком много запросов. Подождите и повторите.",
    retryAfter: 17,
  };
  globalThis.fetch = async () =>
    Response.json(body, { status: 429, headers: { "Retry-After": "17" } });
  try {
    const origin = new URL(process.env.SITE_URL ?? "http://localhost:8021").origin;
    for (const method of ["GET", "POST"]) {
      const request = new globalThis.Request(
        origin + "/api/experience" + (method === "POST" ? "/event" : ""),
        {
          method,
          headers: {
            Origin: origin,
            "X-AnimeSoul-Request": "1",
            "Content-Type": "application/json",
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        },
      );
      const response = await (method === "GET" ? GET : POST)(request);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "17");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await response.json(), body);
    }
  } finally {
    globalThis.fetch = previous;
  }
});
