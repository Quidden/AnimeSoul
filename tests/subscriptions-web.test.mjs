import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import {
  defaultSubscriptionPlans,
  subscriptionQuote,
} from "../packages/contracts/dist/subscriptions.js";

test("subscription and stream proxies forward viewer sessions and never cache access or file URLs", async () => {
  const cookie = "animesoul_web_session=" + "s".repeat(43);
  let entitled = true;
  let availabilityLimited = false,
    developerLimited = false;
  let developerMode = "actual",
    developerWrite;
  const api = createServer((request, response) => {
    if (request.url === "/api/availability") {
      if (availabilityLimited) {
        response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "19" });
        response.end(JSON.stringify({ message: "Too many requests" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ active: false }));
      return;
    }

    const authenticated = request.headers.cookie?.split("; ").includes(cookie) ?? false;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/auth/developer-access") {
      if (developerLimited) {
        response.writeHead(429, { "Retry-After": "7" });
        response.end(JSON.stringify({ message: "Too many requests" }));
      } else if (!authenticated) {
        response.statusCode = 403;
        response.end("{}");
      } else if (request.method === "POST") {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          developerWrite = { headers: request.headers, body: JSON.parse(body) };
          developerMode = developerWrite.body.mode;
          response.statusCode = 201;
          response.end(
            JSON.stringify({ mode: developerMode, role: "owner", csrfToken: "developer-csrf" }),
          );
        });
      } else {
        response.end(
          JSON.stringify({ mode: developerMode, role: "owner", csrfToken: "developer-csrf" }),
        );
      }
    } else if (request.url === "/api/subscription") {
      response.end(
        JSON.stringify({
          authenticated,
          nativeAccess: authenticated && entitled,
          source: authenticated && entitled ? "trial" : "none",
          expiresAt:
            authenticated && entitled ? new Date(Date.now() + 86400000).toISOString() : null,
          trialEndsAt: null,
          firstMonthDiscount: false,
          directEnabled: true,
          billingAvailable: false,
          plans: defaultSubscriptionPlans.map((p) => subscriptionQuote(p, [], false)),
        }),
      );
    } else if (request.url === "/api/anime/demo-title/stream?source=" + "a".repeat(24)) {
      response.end(
        JSON.stringify(
          authenticated && entitled
            ? {
                mode: "direct",
                expiresAt: new Date(Date.now() + 600000).toISOString(),
                sources: [
                  { quality: 720, src: "https://media.example.com/fixture.webm", type: "video" },
                ],
              }
            : { mode: "embed" },
        ),
      );
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  await new Promise((resolve) => api.listen(18840, "127.0.0.1", resolve));
  const web = spawn(
    process.execPath,
    [
      path.resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18841",
    ],
    {
      cwd: path.resolve("apps/web"),
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        API_URL: "http://127.0.0.1:18840",
        SITE_URL: "https://animesoul.test",
        PUBLIC_INDEXING: "false",
      },
    },
  );
  web.stdout.resume();
  web.stderr.resume();
  const base = "http://127.0.0.1:18841";
  const get = (route, authenticated = false) =>
    fetch(base + route, {
      headers: authenticated ? { Cookie: cookie + "; unrelated_session=do-not-forward" } : {},
    });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (web.exitCode !== null) throw new Error("Web process exited.");
      try {
        ready = (await fetch(base + "/robots.txt")).ok;
      } catch {
        /* Starting. */
      }
      if (ready) break;
      await setTimeout(250);
    }
    assert.ok(ready);
    const developer = await get("/api/auth/developer-access", true);
    assert.equal(developer.status, 200);
    assert.match(developer.headers.get("cache-control"), /no-store/);
    assert.equal((await developer.json()).role, "owner");
    assert.equal((await get("/api/auth/developer-access")).status, 403);
    const change = (mode, origin = "https://animesoul.test") =>
      fetch(base + "/api/auth/developer-access", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
          "X-AnimeSoul-Request": "1",
          "X-CSRF-Token": "developer-csrf",
        },
        body: JSON.stringify({ mode }),
      });
    assert.equal((await change("guest", "https://forged.invalid")).status, 403);
    assert.equal(developerWrite, undefined);
    developerLimited = true;
    const rateLimited = await change("guest");
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.headers.get("retry-after"), "7");
    developerLimited = false;
    availabilityLimited = true;
    const gateLimited = await change("guest");
    assert.equal(gateLimited.status, 429);
    assert.equal(gateLimited.headers.get("retry-after"), "19");
    assert.equal(developerWrite, undefined);
    const busyPage = await get("/catalog");
    assert.equal(busyPage.status, 429);
    assert.match(await busyPage.text(), /Слишком много запросов/);
    availabilityLimited = false;
    const changed = await change("guest");
    assert.equal(changed.status, 201);
    assert.match(changed.headers.get("cache-control"), /no-store/);
    assert.equal((await changed.json()).mode, "guest");
    assert.equal(developerWrite.headers.cookie, cookie);
    assert.equal(developerWrite.headers.origin, "https://animesoul.test");
    assert.equal(developerWrite.headers["x-csrf-token"], "developer-csrf");
    assert.deepEqual(developerWrite.body, { mode: "guest" });
    assert.equal(
      (await get("/api/auth/developer-access", true).then((r) => r.json())).mode,
      "guest",
    );
    assert.equal((await change("actual").then((r) => r.json())).mode, "actual");
    const subscription = await get("/api/subscription", true);
    assert.equal(subscription.status, 200);
    assert.match(subscription.headers.get("cache-control"), /no-store/);
    assert.equal((await subscription.json()).nativeAccess, true);
    assert.equal((await get("/api/subscription").then((r) => r.json())).nativeAccess, false);
    const streamRoute = "/api/anime/demo-title/stream?source=" + "a".repeat(24);
    const direct = await get(streamRoute, true);
    assert.match(direct.headers.get("cache-control"), /no-store/);
    assert.equal((await direct.json()).mode, "direct");
    assert.equal((await get(streamRoute + "&userId=forged").then((r) => r.json())).mode, "embed");
    entitled = false;
    assert.equal((await get(streamRoute, true).then((r) => r.json())).mode, "embed");
    assert.equal((await get("/api/subscription", true).then((r) => r.json())).nativeAccess, false);
    const invalid = await get("/api/anime/demo-title/stream?source=invalid", true);
    assert.equal(invalid.status, 400);
    const preview = await get("/subscription");
    assert.equal(preview.status, 200);
    const html = await preview.text();
    assert.match(html, /Запустить демоплеер/);
    assert.doesNotMatch(html, /<video\b/);
    for (const shot of ["navigation", "quality", "speed", "image", "resume", "fullscreen"]) {
      const asset = `/images/player-preview/${shot}-full.jpg`;
      assert.ok(html.includes(asset));
      const image = await get(asset);
      assert.equal(image.status, 200);
      assert.match(image.headers.get("content-type"), /image\/jpeg/);
      assert.ok((await image.arrayBuffer()).byteLength > 10000);
    }
    for (const quality of [720, 360]) {
      const video = await fetch(base + `/media/player-demo/city-road-${quality}.webm`, {
        headers: { Range: "bytes=0-31" },
      });
      assert.equal(video.status, 206);
      assert.match(video.headers.get("content-type"), /video\/webm/);
      assert.match(video.headers.get("content-range"), /^bytes 0-31\//);
      const bytes = Buffer.from(await video.arrayBuffer());
      assert.equal(bytes.length, 32);
      assert.equal(bytes.subarray(0, 4).toString("hex"), "1a45dfa3");
    }
    assert.equal((await get(streamRoute).then((r) => r.json())).mode, "embed");
  } finally {
    web.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
    await new Promise((resolve) => api.close(resolve));
  }
});
