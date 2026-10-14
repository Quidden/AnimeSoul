import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readdir, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import { readDiagnostics } from "../packages/diagnostics/index.mjs";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";

test("home survives API failure and diagnostics verify identity, redact secrets and protect admin access", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "animesoul-diagnostics-http-"));
  const previous = process.env.DIAGNOSTICS_DIR;
  process.env.DIAGNOSTICS_DIR = directory;
  const userId = "b3a3f06d-30c2-4fc6-98c1-532f1c8bc644";
  let available = false;
  const api = createServer((request, response) => {
    if (request.url === "/api/availability") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ active: false }));
      return;
    }

    const route = new URL(request.url, "http://fixture.invalid").pathname;
    let status = 404;
    let value = {};
    if (route === "/api/catalog") {
      status = available ? 200 : 503;
      value = available
        ? {
            items: developmentAnime,
            source: "development",
            page: 1,
            pages: 1,
            pageSize: 18,
            total: developmentAnime.length,
            genres: [],
          }
        : { message: "Unavailable" };
    } else if (route === "/api/auth/me") {
      status = request.headers.cookie === "animesoul_web_session=fixture" ? 200 : 401;
      value = { id: userId };
    } else if (route === "/api/admin") {
      status = request.headers.cookie?.includes("animesoul_admin_session=") ? 200 : 401;
      value = {
        authenticated: true,
        mfaVerified: true,
        roles: request.headers.cookie?.endsWith("owner") ? ["owner"] : ["providers"],
      };
    }
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  });
  const errors = [];
  const children = ["web", "admin"].map((name, index) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve(`apps/${name}/node_modules/next/dist/bin/next`),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(18063 + index),
      ],
      {
        cwd: path.resolve(`apps/${name}`),
        windowsHide: true,
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          API_URL: "http://127.0.0.1:18065",
          SITE_URL: "http://localhost:18063",
          PUBLIC_INDEXING: "false",
          DEMO_CATALOG: "false",
        },
      },
    );
    child.stdout.resume();
    child.stderr.on("data", (value) => errors.push(String(value)));
    return child;
  });
  const web = "http://127.0.0.1:18063";
  const admin = "http://127.0.0.1:18064";
  const headers = {
    Origin: "http://localhost:18063",
    "X-AnimeSoul-Request": "1",
    "Content-Type": "application/json",
  };
  const body = JSON.stringify({
    message: "Fixture error https://user:private@example.invalid/a?token=secret",
    source: "api",
    userId,
    path: "/?token=private",
    digest: "fixture-digest",
  });
  try {
    for (const base of [web, admin]) {
      for (let attempt = 0; ; attempt++) {
        try {
          if (
            (await fetch(base + (base === web ? "/profile-presets/avatar-cat.svg" : "/robots.txt")))
              .ok
          )
            break;
        } catch {
          /* Server startup. */
        }
        if (attempt > 100) throw new Error("Next startup failed");
        await setTimeout(100);
      }
    }
    const down = await fetch(web);
    assert.equal(down.status, 503);
    assert.equal(down.headers.get("retry-after"), "60");
    assert.match(await down.text(), /AnimeSoul временно недоступен/);
    let journal = await readDiagnostics();
    assert.ok(
      journal.items.some(
        (item) => item.source === "web" && item.path === "/" && item.code === "ECONNREFUSED",
      ),
    );
    await new Promise((resolve) => api.listen(18065, "127.0.0.1", resolve));
    assert.equal((await fetch(web + "/api/diagnostics", { method: "POST", body })).status, 403);
    assert.equal(
      (await fetch(web + "/api/diagnostics", { method: "POST", headers, body: "x".repeat(17000) }))
        .status,
      413,
    );
    assert.equal(
      (await fetch(web + "/api/diagnostics", { method: "POST", headers, body: "invalid" })).status,
      400,
    );
    assert.equal(
      (await fetch(web + "/api/diagnostics", { method: "POST", headers, body })).status,
      204,
    );
    journal = await readDiagnostics({ query: "fixture-digest" });
    assert.equal(journal.items[0].source, "browser");
    assert.equal(journal.items[0].userId, null);
    assert.equal(journal.items[0].path, "/");
    assert.equal(JSON.stringify(journal).includes("private"), false);
    assert.equal(JSON.stringify(journal).includes("secret"), false);
    assert.equal(
      (
        await fetch(web + "/api/diagnostics", {
          method: "POST",
          headers: { ...headers, Cookie: "animesoul_web_session=fixture" },
          body,
        })
      ).status,
      204,
    );
    assert.equal((await readDiagnostics({ userId })).items.length, 1);
    assert.equal((await fetch(admin + "/api/diagnostics")).status, 401);
    assert.equal(
      (
        await fetch(admin + "/api/diagnostics", {
          headers: { Cookie: "animesoul_admin_session=delegate" },
        })
      ).status,
      403,
    );
    const allowed = await fetch(admin + "/api/diagnostics?q=fixture-digest", {
      headers: { Cookie: "animesoul_admin_session=owner" },
    });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).items.length, 2);
    assert.equal(allowed.headers.get("cache-control"), "no-store");
    available = true;
    const recovered = await fetch(web);
    const html = await recovered.text();
    assert.equal(recovered.status, 200);
    assert.doesNotMatch(html, /Подборка временно недоступна/);
    assert.match(html, /home-rail-track/);
  } catch (error) {
    throw new Error(String(error) + "\n" + errors.join("\n"), { cause: error });
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", resolve)),
      ),
    );
    if (api.listening) await new Promise((resolve) => api.close(resolve));
    if (previous === undefined) delete process.env.DIAGNOSTICS_DIR;
    else process.env.DIAGNOSTICS_DIR = previous;
    for (const name of await readdir(directory)) await unlink(path.join(directory, name));
    await rmdir(directory);
  }
});
