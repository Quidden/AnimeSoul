import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/home-viewing.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
}).replace(
  '"@animesoul/contracts"',
  JSON.stringify(pathToFileURL(resolve("packages/contracts/dist/index.js")).href),
);
const { recentHomeProgress, homeResumeHref, homeProgressLabel, nextHomeEpisode } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const id = (number) => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
const progress = (animeId, episodeId, extra = {}) => ({
  animeId: id(animeId),
  episodeKey: "1:3",
  position: 300,
  duration: 1440,
  watchedSeconds: 300,
  completed: false,
  episode: { id: id(episodeId), season: "1", number: "3" },
  ...extra,
});

test("home chooses the latest watched title, preserving recency despite duplicate or completed episodes", () => {
  const newest = progress(2, 20, { completed: true });
  const second = progress(1, 10);
  const older = progress(2, 19);
  assert.deepEqual(recentHomeProgress([newest, second, older]), [newest, second]);
  assert.deepEqual(recentHomeProgress([]), []);
  assert.deepEqual(recentHomeProgress([progress(3, 30, { position: 0, watchedSeconds: 0 })]), []);
  assert.equal(
    recentHomeProgress(Array.from({ length: 10 }, (_, index) => progress(index, index))).length,
    6,
  );
});

test("continue links use canonical episodes and resume intent, while legacy or completed records fall back to the title", () => {
  const anime = { slug: "current-title" };
  assert.equal(
    homeResumeHref(anime, progress(1, 10)),
    `/anime/current-title/episodes/${id(10)}?resume=1`,
  );
  assert.equal(homeResumeHref(anime, progress(1, 10, { episode: null })), "/anime/current-title");
  assert.equal(homeResumeHref(anime, progress(1, 10, { completed: true })), "/anime/current-title");
  assert.equal(homeResumeHref(anime), "/anime/current-title");
});

test("a finished episode continues to the next real episode without assuming consecutive numbering", () => {
  const episode = (episodeId, season, number) => ({
    id: id(episodeId),
    animeId: id(1),
    season,
    number,
    duration: 1440,
  });
  const current = progress(1, 10, { completed: true });
  const next = episode(12, "1", "10");
  const episodes = [episode(13, "2", "1"), next, episode(10, "1", "3")];
  assert.deepEqual(nextHomeEpisode(current, episodes), next);
  assert.equal(
    homeResumeHref({ slug: "current-title" }, current, next),
    `/anime/current-title/episodes/${id(12)}?resume=1`,
  );
  assert.equal(nextHomeEpisode(progress(1, 13, { completed: true }), episodes), undefined);
  assert.equal(nextHomeEpisode(progress(1, 99, { completed: true }), episodes), undefined);
  assert.equal(nextHomeEpisode(progress(1, 10), episodes), undefined);
});

test("watching labels bound progress and remaining time, including unknown and completed durations", () => {
  assert.deepEqual(homeProgressLabel(progress(1, 10)), {
    episode: "Сезон 1 · Серия 3",
    time: "Осталось 19 мин",
    percent: (300 / 1440) * 100,
  });
  assert.equal(homeProgressLabel(progress(1, 10, { position: 9999 })).percent, 100);
  assert.equal(homeProgressLabel(progress(1, 10, { position: -30 })).percent, 0);
  assert.equal(homeProgressLabel(progress(1, 10, { duration: 0 })).time, "5 мин просмотрено");
  assert.equal(homeProgressLabel(progress(1, 10, { completed: true })).time, "Серия просмотрена");
  assert.equal(homeProgressLabel(progress(1, 10, { episode: null })).episode, "Последний просмотр");
});
