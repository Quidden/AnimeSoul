import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("Preview service exited.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* Wait for startup. */
    }
    await setTimeout(200);
  }
  throw new Error("Preview service did not become ready.");
}
test("compiled HTML contains SEO content and excludes hidden profile data", async () => {
  const root = process.cwd();
  const env = {
    ...process.env,
    API_PORT: "18020",
    API_HOST: "127.0.0.1",
    API_URL: "http://127.0.0.1:18020",
    SITE_URL: "http://localhost:18021",
    PUBLIC_INDEXING: "false",
    DEMO_CATALOG: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete env.DATABASE_URL;
  const api = spawn(process.execPath, ["apps/api/dist/main.js"], {
    env: { ...env, NODE_ENV: "test" },
    stdio: "pipe",
  });
  const children = [api];
  const errors = [];
  api.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  api.stdout.resume();
  try {
    await waitFor("http://127.0.0.1:18020/api/health", api);
    for (const [name, port] of [
      ["web", "18021"],
      ["admin", "18022"],
    ]) {
      const child = spawn(
        process.execPath,
        [
          path.resolve(root, "apps/" + name + "/node_modules/next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          port,
        ],
        {
          cwd: path.join(root, "apps", name),
          env: { ...env, NODE_ENV: "production" },
          stdio: "pipe",
        },
      );
      children.push(child);
      child.stdout.resume();
      child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
      await waitFor("http://127.0.0.1:" + port, child);
    }
    const response = await fetch("http://127.0.0.1:18021/anime/attack-on-titan");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<h1[^>]*>Атака титанов<\/h1>/);
    assert.match(html, /Shingeki no Kyojin/);
    assert.match(html, /rel="canonical"[^>]*attack-on-titan/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /noindex/);
    const profile = await (await fetch("http://127.0.0.1:18021/users/soul")).text();
    assert.match(profile, /Любимое аниме/);
    assert.match(profile, /Не в сети/);
    assert.equal(profile.includes("На тихий вечер"), false);
    assert.equal(profile.includes("Личные оценки"), false);
    const robots = await (await fetch("http://127.0.0.1:18021/robots.txt")).text();
    assert.match(robots, /Disallow: \//);
    const sitemap = await (await fetch("http://127.0.0.1:18021/sitemap.xml")).text();
    assert.equal(sitemap.includes("<url>"), false);
    assert.equal((await fetch("http://127.0.0.1:18021/anime/does-not-exist")).status, 404);
    const admin = await fetch("http://127.0.0.1:18022");
    assert.equal(admin.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(await admin.text(), /Административный доступ закрыт/);
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
  }
});
