import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import path from "node:path";

test("web proxy bounds media uploads, forwards session/CSRF and returns original GIF bytes", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const media = `/api/profile-media/${userId}/banner/22222222-2222-4222-8222-222222222222.gif`;
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const cookie = "animesoul_web_session=" + "a".repeat(43);
  const uploads = [];
  const api = createServer(async (request, response) => {
    if (request.url === "/api/availability") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ active: false }));
      return;
    }

    if (request.url === media) {
      assert.equal(request.headers.cookie, cookie);
      response.writeHead(200, { "Content-Type": "image/gif" });
      response.end(gif);
      return;
    }
    if (request.url === "/api/account/profile/media/banner") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      uploads.push({ bytes: Buffer.concat(chunks), headers: request.headers });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ avatar: null, banner: media }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => api.listen(18080, "127.0.0.1", resolve));
  const web = spawn(
    process.execPath,
    [
      path.resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18081",
    ],
    {
      cwd: path.resolve("apps/web"),
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        API_URL: "http://127.0.0.1:18080",
        SITE_URL: "http://localhost:18081",
        PUBLIC_INDEXING: "false",
        DEMO_CATALOG: "false",
        GIPHY_API_KEY: "giphy-web-test-key",
      },
    },
  );
  web.stdout.resume();
  web.stderr.resume();
  const base = "http://127.0.0.1:18081";
  const headers = {
    Origin: "http://localhost:18081",
    "X-AnimeSoul-Request": "1",
    "X-CSRF-Token": "qa-csrf",
    Cookie: cookie,
    "Content-Type": "application/octet-stream",
  };
  const upload = (body, extra = {}) =>
    fetch(base + "/api/account/profile/media/banner", {
      method: "POST",
      headers: { ...headers, ...extra },
      body,
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
    assert.ok(ready, "Web must start.");
    const giphyConfig = await fetch(base + "/api/profile-giphy/config");
    assert.equal(giphyConfig.status, 200);
    assert.equal(giphyConfig.headers.get("cache-control"), "no-store");
    assert.deepEqual(await giphyConfig.json(), { apiKey: "giphy-web-test-key" });
    assert.equal((await upload(gif, { Origin: "https://attacker.invalid" })).status, 403);
    assert.equal((await upload(gif, { Cookie: "" })).status, 401);
    assert.equal((await upload(gif, { "Content-Type": "image/svg+xml" })).status, 415);
    assert.equal((await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
    assert.equal(uploads.length, 0);
    const uploaded = await upload(gif);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    assert.equal((await uploaded.json()).banner, media);
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0].bytes, gif);
    assert.equal(uploads[0].headers["x-csrf-token"], "qa-csrf");
    assert.equal(uploads[0].headers.cookie, cookie);
    assert.equal(uploads[0].headers.origin, "http://localhost:18081");
    const rendered = await fetch(base + media, { headers: { Cookie: cookie } });
    assert.equal(rendered.status, 200);
    assert.equal(rendered.headers.get("content-type"), "image/gif");
    assert.equal(rendered.headers.get("cache-control"), "no-store");
    assert.ok(
      rendered.headers
        .get("vary")
        .split(",")
        .some((value) => value.trim().toLowerCase() === "cookie"),
    );
    assert.equal(rendered.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await rendered.arrayBuffer()), gif);
    const ordinary = await fetch(base + "/api/account/profile", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ about: "x".repeat(65536) }),
    });
    assert.equal(ordinary.status, 413);
  } finally {
    web.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
    await new Promise((resolve) => api.close(resolve));
  }
});
