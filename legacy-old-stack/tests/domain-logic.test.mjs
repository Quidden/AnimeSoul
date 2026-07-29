import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadLibModules() {
  const target = await mkdtemp(path.join(tmpdir(), "animesoul-domain-"));
  for (const name of ["types", "settings", "storage", "anime", "tracking", "watchPartyLogic"]) {
    const source = await readFile(path.join("app", "lib", `${name}.ts`), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText.replace(/from "(\.\/[^"]+)"/g, 'from "$1.mjs"');
    await writeFile(path.join(target, `${name}.mjs`), output);
  }
  return {
    anime: await import(pathToFileURL(path.join(target, "anime.mjs"))),
    storage: await import(pathToFileURL(path.join(target, "storage.mjs"))),
    tracking: await import(pathToFileURL(path.join(target, "tracking.mjs"))),
    watchPartyLogic: await import(pathToFileURL(path.join(target, "watchPartyLogic.mjs"))),
  };
}

test("старый конфиг получает новые настройки без потери данных", async () => {
  const { storage } = await loadLibModules();
  const migrated = storage.migrateSnapshot({
    name: "Старый профиль",
    favorites: [10],
    folders: [{ id: "folder", name: "Смотрю", animeIds: [10] }],
    progress: {
      10: {
        episode: "2",
        dub: "AniLibria",
        episodes: {
          "1:2": { position: 600, duration: 1200, percent: 50, updatedAt: 1 },
        },
      },
    },
    tracked: [{ animeId: 10, title: "Тест", knownEpisodes: 2, newEpisodes: 1 }],
    playerPrefs: { autoNext: false },
  });

  assert.deepEqual(migrated.favorites, [10]);
  assert.equal(migrated.progress[10].episodes["1:2"].position, 600);
  assert.equal(migrated.playerPrefs.autoNext, false);
  assert.equal(migrated.playerPrefs.homePreviewMode, "poster");
  assert.equal(migrated.playerPrefs.playerEpisodeCarousel, true);
  assert.deepEqual(migrated.tracked[0].animeIds, [10]);
});

test("состояние сворачиваемых секций сохраняется при миграции профиля", async () => {
  const { storage } = await loadLibModules();
  const migrated = storage.migrateSnapshot({
    libraryExpanded: false,
    watchingExpanded: false,
    historyExpanded: false,
  });

  assert.equal(migrated.libraryExpanded, false);
  assert.equal(migrated.watchingExpanded, false);
  assert.equal(migrated.historyExpanded, false);
});

test("локальное состояние секции не перезаписывается устаревшим снимком профиля", async () => {
  const { storage } = await loadLibModules();

  assert.equal(storage.resolveStoredBoolean(false, true, true), false);
  assert.equal(storage.resolveStoredBoolean(undefined, false, true), false);
  assert.equal(storage.resolveStoredBoolean(undefined, undefined, true), true);
});

test("поиск оставляет только аниме, соответствующие всем словам запроса", async () => {
  const { anime } = await loadLibModules();
  const healer = {
    anime_id: 1,
    title: "Маг-целитель: Новый старт",
    other_titles: ["Redo of Healer"],
  };
  const unrelated = {
    anime_id: 2,
    title: "Реинкарнация безработного",
  };

  assert.equal(anime.matchesAnimeSearch(healer, "Маг Целитель"), true);
  assert.equal(anime.matchesAnimeSearch(healer, "маг-целитель"), true);
  assert.equal(anime.matchesAnimeSearch(unrelated, "Маг Целитель"), false);
  assert.ok(anime.animeSearchScore(healer, "Маг Целитель") > anime.animeSearchScore(unrelated, "Маг Целитель"));
});

test("прогресс считается по времени и завершение требует 100% или явной отметки", async () => {
  const { anime } = await loadLibModules();
  assert.equal(anime.isEpisodeWatched({ percent: 99 }), false);
  assert.equal(anime.isEpisodeWatched({ percent: 100 }), true);
  assert.equal(anime.isEpisodeWatched({ percent: 20, completed: true }), true);
  assert.equal(
    anime.watchTimeProgress({
      episode: "2",
      dub: "",
      totalEpisodes: 2,
      totalDuration: 200,
      episodes: {
        "1:1": { position: 100, duration: 100, percent: 100, completed: true },
        "1:2": { position: 50, duration: 100, percent: 50 },
      },
    }),
    75,
  );
});

test("отслеживание создаёт базу, не дублирует уведомления и подтверждает точную серию", async () => {
  const { tracking } = await loadLibModules();
  const baseline = tracking.reconcileTrackedEpisodes(
    {
      animeId: 10,
      animeIds: [10],
      title: "Тест",
      knownEpisodes: 2,
      newEpisodes: 0,
    },
    [10],
    new Map([
      ["10:1", 1],
      ["10:2", 2],
    ]),
    100,
  );
  assert.equal(baseline.newEpisodes, 0);

  const withNew = tracking.reconcileTrackedEpisodes(
    baseline,
    [10],
    new Map([
      ["10:1", 1],
      ["10:2", 2],
      ["10:3", 300],
    ]),
    400,
  );
  assert.deepEqual(withNew.pendingEpisodeKeys, ["10:3"]);
  assert.equal(withNew.newEpisodes, 1);

  const repeated = tracking.reconcileTrackedEpisodes(
    withNew,
    [10],
    new Map([
      ["10:1", 1],
      ["10:2", 2],
      ["10:3", 300],
    ]),
    500,
  );
  assert.equal(repeated.newEpisodes, 1);
  const acknowledged = tracking.acknowledgeTrackedEpisode(repeated, "10:3");
  assert.equal(acknowledged.newEpisodes, 0);
  assert.deepEqual(acknowledged.pendingEpisodeKeys, []);
});

test("manual watched toggle records full duration and restores partial progress", async () => {
  const { anime } = await loadLibModules();
  const partial = {
    position: 300,
    duration: 1200,
    percent: 25,
    watchedSeconds: 300,
    updatedAt: 10,
  };
  const completed = anime.toggleEpisodeWatched(partial, 1200, 20);

  assert.equal(anime.isEpisodeWatched(completed), true);
  assert.equal(completed.position, 1200);
  assert.equal(completed.watchedSeconds, 1200);
  assert.equal(completed.completions, 1);
  assert.deepEqual(completed.completionHistory, [20]);
  assert.equal(
    anime.watchTimeProgress({
      episode: "1",
      dub: "",
      totalEpisodes: 1,
      totalDuration: 1200,
      episodes: { "1:1": completed },
    }),
    100,
  );

  const restored = anime.toggleEpisodeWatched(completed, 1200, 30);
  assert.equal(anime.isEpisodeWatched(restored), false);
  assert.equal(restored.position, 300);
  assert.equal(restored.watchedSeconds, 300);
  assert.equal(restored.percent, 25);
  assert.deepEqual(restored.completionHistory ?? [], []);
});

test("tracking survives a temporary incomplete API response without a false alert", async () => {
  const { tracking } = await loadLibModules();
  const tracker = {
    animeId: 10,
    animeIds: [10],
    title: "Test",
    knownEpisodes: 3,
    knownEpisodeKeys: ["10:1", "10:2", "10:3"],
    pendingEpisodeKeys: [],
    newEpisodes: 0,
    lastCheckedAt: 100,
  };
  const partial = tracking.reconcileTrackedEpisodes(
    tracker,
    [10],
    new Map([["10:1", 1], ["10:2", 2]]),
    200,
  );
  assert.deepEqual(partial.knownEpisodeKeys, ["10:1", "10:2", "10:3"]);
  assert.equal(partial.newEpisodes, 0);

  const recovered = tracking.reconcileTrackedEpisodes(
    partial,
    [10],
    new Map([["10:1", 1], ["10:2", 2], ["10:3", 3]]),
    300,
  );
  assert.equal(recovered.newEpisodes, 0);
});

test("legacy tracking detects only the episode-count growth", async () => {
  const { tracking } = await loadLibModules();
  const migrated = tracking.reconcileTrackedEpisodes(
    {
      animeId: 10,
      title: "Test",
      knownEpisodes: 2,
      newEpisodes: 0,
      lastCheckedAt: 100,
    },
    [10],
    new Map([["10:1", 1], ["10:2", 2], ["10:3", 3]]),
    200,
  );
  assert.deepEqual(migrated.pendingEpisodeKeys, ["10:3"]);
});

test("tracking counts only playable episodes in the selected dubbing", async () => {
  const { tracking } = await loadLibModules();
  const dates = tracking.collectPlayableEpisodeDates(
    10,
    [
      { number: "1", iframe_url: "https://player/1", date: 1, data: { dubbing: "A", player: "Kodik" } },
      { number: "1", iframe_url: "https://player/1-copy", date: 2, data: { dubbing: "A", player: "Other" } },
      { number: "2", iframe_url: "", date: 3, data: { dubbing: "A", player: "Kodik" } },
      { number: "3", iframe_url: "https://player/3", date: 4, data: { dubbing: "B", player: "Kodik" } },
    ],
    ["A"],
  );
  assert.deepEqual([...dates.keys()], ["10:1"]);
  assert.equal(dates.get("10:1"), 2_000);
});

test("watch-party command settling ignores clock skew and requires the right source", async () => {
  const { watchPartyLogic } = await loadLibModules();
  const target = {
    animeId: 7,
    season: 2,
    episode: "4",
    dub: "AniLibria",
    player: "Kodik",
    position: 80,
    duration: 1440,
    playing: true,
    updatedAt: 1_000,
  };
  assert.equal(
    watchPartyLogic.playbackReachedTarget(target, {
      ...target,
      position: 81,
      updatedAt: 2_000,
    }),
    true,
  );
  assert.equal(
    watchPartyLogic.playbackReachedTarget(target, {
      ...target,
      player: "Other",
      position: 81,
      updatedAt: 2_000,
    }),
    false,
  );
  assert.equal(
    watchPartyLogic.playbackChangedByUser(
      { ...target, updatedAt: 20_000 },
      { ...target, position: 81, updatedAt: 21_000 },
    ),
    false,
  );
  assert.equal(
    watchPartyLogic.playbackChangedByUser(
      { ...target, playing: false, updatedAt: 20_000 },
      { ...target, playing: true, updatedAt: 20_100 },
    ),
    true,
  );
});
