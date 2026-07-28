import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadLibModules() {
  const target = await mkdtemp(path.join(tmpdir(), "animesoul-domain-"));
  for (const name of ["types", "settings", "storage", "anime", "tracking"]) {
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
