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

test("desktop shortcut asks where to launch and can edit startup settings", async () => {
  const [main, launcher, preload] = await Promise.all([
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/launcher.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/launcher-preload.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /chooseLaunchMode/);
  assert.match(main, /openLaunchTarget\(launchMode\)/);
  assert.doesNotMatch(main, /if \(launchConfig\.launchMode === "browser"\)/);
  assert.match(main, /animesoul:update-launch-config/);
  assert.match(launcher, /data-mode="desktop"/);
  assert.match(launcher, /data-mode="browser"/);
  assert.match(launcher, /id="site-port"/);
  assert.match(launcher, /id="api-token"/);
  assert.match(preload, /getSettings/);
  assert.match(preload, /saveSettings/);
});

test("collapsible home sections restore their device state after hydration", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /\[libraryExpanded, setLibraryExpanded\] = useState\(false\)/);
  assert.match(page, /setLibraryExpanded\(read\(K\.libraryExpanded, true\)\)/);
  assert.match(page, /setWatchingExpanded\(read\(K\.watchingExpanded, true\)\)/);
  assert.match(page, /setHistoryExpanded\(read\(K\.historyExpanded, true\)\)/);
  assert.match(page, /write\(K\.libraryExpanded, next\)/);
  assert.match(page, /write\(K\.historyExpanded, next\)/);
});

test("home mini library can delete items and restore the last deleted folder", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/styles/base.css", import.meta.url), "utf8");

  assert.match(page, /lastDeletedFolder/);
  assert.match(page, /restoreLastFolder/);
  assert.match(page, /Удалить из избранного/);
  assert.match(page, /Удалить папку/);
  assert.match(page, /animesoul:last-deleted-folder/);
  assert.match(styles, /\.hero-mini-delete/);
});

test("statistics includes completion history and GitHub-style activity views", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/library.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /completionHistory/);
  assert.match(page, /activity-grid/);
  assert.match(page, /activity-year-switcher/);
  assert.match(page, /activity-months/);
  assert.match(page, /Последние 12 месяцев/);
  assert.match(page, /По дням недели/);
  assert.match(styles, /\.activity-cell/);
  assert.match(styles, /\.month-chart/);
});
