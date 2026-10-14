import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/search-watch.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { searchWatchView } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const anime = {
  status: "released",
  episodes: { total: 12, available: 12 },
  watchProgress: null,
};
const progress = {
  status: "watching",
  completedEpisodes: 3,
  startedEpisodes: 4,
  percent: 29.17,
  lastEpisode: { season: "1", number: "4", percent: 50 },
};

test("search episode counts distinguish planned, available and unknown totals", () => {
  for (const [count, label] of [
    [1, "1 серия"],
    [2, "2 серии"],
    [12, "12 серий"],
    [21, "21 серия"],
  ])
    assert.equal(
      searchWatchView({ ...anime, episodes: { total: count, available: count } }).episodeLabel,
      label,
    );
  assert.equal(
    searchWatchView({ ...anime, status: "ongoing", episodes: { total: 12, available: 7 } })
      .episodeLabel,
    "Вышло 7 из 12 серий",
  );
  assert.equal(
    searchWatchView({ ...anime, status: "ongoing", episodes: { total: null, available: 7 } })
      .episodeLabel,
    "7 серий вышло",
  );
  assert.equal(
    searchWatchView({ ...anime, status: "announced", episodes: { total: null, available: 0 } })
      .episodeLabel,
    "Серии ещё не вышли",
  );
  assert.equal(
    searchWatchView({ ...anime, episodes: { total: null, available: null } }).episodeLabel,
    "Число серий пока неизвестно",
  );
});

test("guest results never imply unwatched; signed-in zero progress is explicit", () => {
  assert.equal(searchWatchView(anime).watch, null);
  const view = searchWatchView({
    ...anime,
    watchProgress: {
      ...progress,
      status: "not_started",
      completedEpisodes: 0,
      startedEpisodes: 0,
      percent: 0,
      lastEpisode: null,
    },
  });
  assert.equal(view.watch.label, "Не смотрели");
  assert.equal(view.watch.percent, 0);
});

test("title progress retains fractional viewing and labels the latest episode separately", () => {
  const view = searchWatchView({ ...anime, watchProgress: progress });
  assert.equal(view.watch.label, "Просмотрено 3 / 12");
  assert.equal(view.watch.percent, 29.17);
  assert.equal(view.watch.detail, "Серия 4 · 50%");
  assert.equal(view.watch.progressLabel, "Прогресс просмотра аниме");
});

test("marked complete and caught-up ongoing titles have distinct wording", () => {
  const complete = searchWatchView({
    ...anime,
    watchProgress: {
      ...progress,
      status: "completed",
      completedEpisodes: 0,
      startedEpisodes: 0,
      percent: 100,
      lastEpisode: null,
    },
  });
  assert.equal(complete.watch.label, "Просмотрено");
  assert.equal(complete.watch.percent, 100);
  const caughtUp = searchWatchView({
    ...anime,
    status: "ongoing",
    episodes: { total: 12, available: 7 },
    watchProgress: {
      ...progress,
      status: "caught_up",
      completedEpisodes: 7,
      startedEpisodes: 7,
      percent: 58.33,
    },
  });
  assert.equal(caughtUp.watch.label, "Вышедшие серии просмотрены");
  assert.equal(caughtUp.watch.percent, 58.33);
});

test("unknown title totals use clearly labelled episode progress without inventing totals", () => {
  const unknown = { ...anime, episodes: { total: null, available: null } };
  const view = searchWatchView({
    ...unknown,
    watchProgress: {
      ...progress,
      percent: null,
      lastEpisode: { season: "2", number: "4", percent: 50 },
    },
  });
  assert.equal(view.watch.label, "Сезон 2 · Серия 4 · 50%");
  assert.equal(view.watch.progressLabel, "Прогресс текущей серии");
  assert.equal(view.watch.percent, 50);
  const legacy = searchWatchView({
    ...unknown,
    watchProgress: { ...progress, completedEpisodes: 0, percent: null, lastEpisode: null },
  });
  assert.equal(legacy.watch.label, "Начали смотреть");
  assert.equal(legacy.watch.percent, null);
});
