import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import path from "node:path";

test("frame page and same-origin web proxy work for guests, bound uploads and keep the provider key private", async () => {
  const secret = "s".repeat(40);
  const uploads = [];
  const quotas = [];
  let status = 200;
  let maintenance = false;
  const api = createServer(async (request, response) => {
    if (request.url === "/api/availability") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          maintenance
            ? { active: true, title: "Обновление <script>", body: "Настраиваем сайт", endsAt: null }
            : { active: false },
        ),
      );
      return;
    }

    if (["/api/sitemap/catalog", "/api/sitemap/profiles"].includes(request.url)) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("[]");
      return;
    }
    if (request.url === "/api/search/frame/quota") {
      quotas.push(request.headers);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ total: 100, used: 12, remaining: 88 }));
      return;
    }
    if (request.url === "/api/search/frame") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      uploads.push({ bytes: Buffer.concat(chunks), headers: request.headers });
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          status === 200 ? { provider: "trace.moe", matches: [] } : { message: "Сервис занят." },
        ),
      );
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => api.listen(18180, "127.0.0.1", resolve));
  const web = spawn(
    process.execPath,
    [
      path.resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18181",
    ],
    {
      cwd: path.resolve("apps/web"),
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        API_URL: "http://127.0.0.1:18180",
        SITE_URL: "https://animesoul.test",
        PUBLIC_INDEXING: "true",
        DEMO_CATALOG: "false",
        TRACE_MOE_API_KEY: "private-web-key",
        INTERNAL_PROXY_SECRET: secret,
      },
    },
  );
  web.stdout.resume();
  web.stderr.resume();
  const base = "http://127.0.0.1:18181";
  const headers = {
    Origin: "https://animesoul.test",
    "X-AnimeSoul-Request": "1",
    "Content-Type": "application/octet-stream",
    Cookie: "animesoul_web_session=" + "a".repeat(43),
  };
  const upload = (body, extra = {}) =>
    fetch(base + "/api/search/frame", {
      method: "POST",
      headers: { ...headers, ...extra },
      body,
    }).catch((cause) => {
      throw new Error(
        "Upload failed: " +
          (typeof body === "string" ? body.length : body.length) +
          "/" +
          Object.keys(extra).join(","),
        { cause },
      );
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
    const page = await fetch(base + "/search/frame");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Из какого аниме этот кадр/);
    assert.match(html, /name="robots" content="index, follow"/);
    assert.match(html, /rel="canonical" href="https:\/\/animesoul.test\/search\/frame"/);
    assert.match(html, /property="og:title"/);
    assert.match(html, /name="twitter:card"/);
    assert.match(html, /FAQPage/);
    assert.match(html, /WebApplication/);
    assert.doesNotMatch(html, /Кадр будет отправлен|Копию на AnimeSoul/);
    assert.match(html, /Поиск по кадру/);
    assert.match(html, /Аниме \/ Персонажи \/ Люди \/ Настройки \/ Кадр аниме/);
    assert.match(html, /Перетащите фото или GIF сюда или вставьте из буфера/);
    assert.match(html, /aria-label="Разделы сайта"[\s\S]*?href="\/search\/frame"/);
    assert.match(html, /aria-label="Карта сайта"[\s\S]*?href="\/search\/frame"/);
    assert.doesNotMatch(html, /На отдельной странице/);
    assert.doesNotMatch(html, /private-web-key/);
    const quota = await fetch(base + "/api/search/frame/quota", {
      headers: { Cookie: headers.Cookie },
    });
    assert.equal(quota.headers.get("cache-control"), "no-store");
    assert.deepEqual(await quota.json(), { total: 100, used: 12, remaining: 88 });
    // The session cookie reaches the API. Without an ingress Next fills X-Forwarded-For with the socket address.
    assert.equal(quotas[0].cookie, headers.Cookie);
    assert.equal(quotas[0]["x-animesoul-client-ip"], "127.0.0.1");
    // The address is the last X-Forwarded-For entry (written by the ingress); a browser-sent claim is dropped.
    await fetch(base + "/api/search/frame/quota", {
      headers: {
        "X-Forwarded-For": "198.51.100.7, 203.0.113.9",
        "X-AnimeSoul-Client-IP": "192.0.2.1",
        "X-AnimeSoul-Proxy-Secret": "browser-supplied",
      },
    });
    assert.equal(quotas[1]["x-animesoul-client-ip"], "203.0.113.9");
    assert.equal(quotas[1]["x-animesoul-proxy-secret"], secret);
    await fetch(base + "/api/search/frame/quota", {
      headers: { "X-Forwarded-For": "not-an-ip", "X-AnimeSoul-Client-IP": "192.0.2.1" },
    });
    assert.equal(quotas[2]["x-animesoul-client-ip"], undefined);
    assert.equal(quotas[2]["x-animesoul-proxy-secret"], undefined);
    assert.match(await (await fetch(base + "/robots.txt")).text(), /Allow: \/search\/frame/);
    assert.match(
      await (await fetch(base + "/sitemap.xml")).text(),
      /<loc>https:\/\/animesoul.test\/search\/frame<\/loc>/,
    );
    assert.equal((await upload("frame", { Origin: "https://attacker.invalid" })).status, 403);
    assert.equal((await upload("frame", { "X-AnimeSoul-Request": "" })).status, 403);
    assert.equal((await upload("frame", { "Content-Type": "image/svg+xml" })).status, 415);
    const large = await upload(Buffer.alloc(5 * 1024 * 1024 + 1), { Connection: "close" }).catch(
      (cause) => {
        throw new Error("Content-Length upload failed", { cause });
      },
    );
    assert.equal(large.status, 413);
    assert.equal((await upload("")).status, 400);
    // A stream without Content-Length must have the same limit.
    const chunked = await fetch(base + "/api/search/frame", {
      method: "POST",
      headers: { ...headers, Connection: "close" },
      body: (async function* () {
        yield Buffer.alloc(3 * 1024 * 1024);
        yield Buffer.alloc(3 * 1024 * 1024);
      })(),
      duplex: "half",
    }).catch((cause) => {
      throw new Error("Chunked upload failed", { cause });
    });
    assert.equal(chunked.status, 413);
    assert.equal(uploads.length, 0);
    const bytes = Buffer.from("test frame bytes");
    const found = await upload(bytes, { Cookie: "" });
    assert.equal(found.status, 200);
    assert.equal(found.headers.get("cache-control"), "no-store");
    assert.equal(found.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.deepEqual(await found.json(), { provider: "trace.moe", matches: [] });
    assert.deepEqual(uploads[0].bytes, bytes);
    assert.equal(uploads[0].headers.origin, "https://animesoul.test");
    assert.equal(uploads[0].headers["x-animesoul-request"], "1");
    await upload(bytes);
    assert.equal(uploads[1].headers.cookie, headers.Cookie);
    assert.equal(uploads[1].headers["x-animesoul-client-ip"], "127.0.0.1");
    await upload(bytes, { "X-Forwarded-For": "203.0.113.9", "X-AnimeSoul-Client-IP": "192.0.2.1" });
    assert.equal(uploads[2].headers["x-animesoul-client-ip"], "203.0.113.9");
    assert.equal(uploads[2].headers["x-animesoul-proxy-secret"], secret);
    uploads.pop();
    assert.equal(uploads[1].headers["x-trace-key"], undefined);
    status = 429;
    const limited = await upload(bytes);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { message: "Сервис занят." });
    maintenance = true;
    for (const path of ["/search/frame", "/maintenance", "/users/soul", "/catalog"]) {
      const page = await fetch(base + path);
      assert.equal(page.status, 503);
      assert.equal(page.headers.get("retry-after"), "60");
      assert.equal(page.headers.get("cache-control"), "no-store");
      const html = await page.text();
      assert.match(html, /Обновление &lt;script&gt;/);
      assert.doesNotMatch(html, /<script>|site-header/);
    }
    const uploadsBefore = uploads.length;
    assert.equal((await upload(bytes)).status, 503);
    assert.equal(uploads.length, uploadsBefore);
    maintenance = false;
    assert.equal((await fetch(base + "/search/frame")).status, 200);
  } finally {
    web.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
    await new Promise((resolve) => api.close(resolve));
  }
});
