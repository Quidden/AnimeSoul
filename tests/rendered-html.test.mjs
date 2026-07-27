import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("рендерит главную страницу AnimeSoul", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>AnimeSoul — локальная аниме-библиотека<\/title>/i);
  assert.match(html, /AnimeSoul/);
  assert.match(html, /Каталог/);
  assert.match(html, /История просмотра/);
  assert.match(html, /Настройки продолжения/);
});

test("ключевые подсистемы находятся в отдельных модулях", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/lib/settings.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/useEpisodeTracking.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Player.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/player.css", import.meta.url), "utf8"),
  ]);
  assert.match(files[0], /DEFAULT_PLAYER_PREFS/);
  assert.match(files[1], /migrateSnapshot/);
  assert.match(files[2], /useEpisodeTracking/);
  assert.match(files[3], /export function Watch/);
  assert.match(files[3], /activateCarouselItem\(next, "next", true, false\)/);
  assert.match(files[3], /scrollToPlayer && autoScrollPlayer/);
  assert.match(files[3], /episodes\?\.aired.*\+ 1/);
  assert.match(files[3], /upcoming-layout/);
  assert.match(files[4], /episode-carousel/);
});
