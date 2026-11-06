import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { developmentAnime } from "../packages/database/dist/src/fixtures.js";

test(
  "anime HTML identifies each season, renders independent timers and explains undated plans",
  { timeout: 60000 },
  async () => {
    const original = { ...developmentAnime[0], format: "tv", status: "released", details: {} };
    const part = (number, status, details) => ({
      ...original,
      id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
      slug: `release-season-${number}`,
      title: `История: сезон ${number}`,
      status,
      details,
    });
    const upcoming = new Date(Date.now() + 3 * 86400000).toISOString();
    const premiere = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    const airing = part(2, "ongoing", { episodesAired: 7, nextEpisodeAt: upcoming });
    const sequel = part(3, "announced", { airedAt: premiere });
    const planned = part(4, "announced", {});
    const titles = [original, airing, sequel, planned];
    const api = createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const anime = titles.find((entry) => pathname === `/api/anime/${entry.slug}`);
      const graph = titles.find((entry) => pathname === `/api/anime/${entry.slug}/franchise`);
      const body =
        anime ??
        (graph
          ? {
              currentAnimeId: graph.id,
              items: titles.map((entry) => ({ anime: entry, episodes: [] })),
            }
          : pathname === "/api/availability"
            ? { active: false }
            : pathname.endsWith("/characters")
              ? { items: [] }
              : null);
      response.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body ?? {}));
    });
    await new Promise((resolve) => api.listen(18280, "127.0.0.1", resolve));
    const web = spawn(
      process.execPath,
      [
        path.resolve("apps/web/node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "18281",
      ],
      {
        cwd: path.resolve("apps/web"),
        env: {
          ...process.env,
          NODE_ENV: "production",
          API_URL: "http://127.0.0.1:18280",
          SITE_URL: "http://localhost:18281",
          PUBLIC_INDEXING: "false",
          DEMO_CATALOG: "false",
        },
        stdio: "pipe",
        windowsHide: true,
      },
    );
    web.stdout.resume();
    let errors = "";
    web.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-4000);
    });
    try {
      const base = "http://127.0.0.1:18281";
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (web.exitCode !== null) throw new Error(`Website exited: ${errors}`);
        try {
          if ((await fetch(`${base}/robots.txt`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* Wait for the server to bind. */
        }
        await setTimeout(200);
      }
      assert.equal(ready, true, errors);
      for (const current of [original, airing]) {
        const response = await fetch(`${base}/anime/${current.slug}`);
        assert.equal(response.status, 200);
        const html = await response.text();
        const schedule = html.match(
          /<section class="anime-release-schedule"[\s\S]*?<\/section>/,
        )?.[0];
        assert.ok(schedule);
        const text = schedule.replace(/<[^>]*>/g, "");
        assert.equal((schedule.match(/role="timer"/g) ?? []).length, 2);
        assert.equal((schedule.match(/<li /g) ?? []).length, 3);
        assert.match(schedule, /Следующая серия актуального сезона/);
        assert.match(text, /Серия 8/);
        assert.ok(schedule.includes(`href="/anime/${airing.slug}"`));
        assert.ok(schedule.includes(`href="/anime/${sequel.slug}"`));
        assert.ok(schedule.includes(`dateTime="${upcoming}"`));
        assert.ok(schedule.includes(`dateTime="${premiere}"`));
        assert.match(schedule, /Премьера нового сезона/);
        assert.match(schedule, /Время выхода не объявлено/);
        assert.match(text, /Новый сезон запланирован. Точная дата выхода пока не объявлена/);
        assert.match(schedule, /Запланировано/);
        assert.doesNotMatch(schedule, /Invalid Date|NaN|Следующая серия:/);
      }
    } finally {
      web.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => web.once("exit", resolve)), setTimeout(2000)]);
      await new Promise((resolve) => api.close(resolve));
    }
  },
);
