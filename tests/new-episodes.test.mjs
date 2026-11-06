import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

const compile = (name, replace = (source) => source) =>
  "data:text/javascript;base64," +
  Buffer.from(
    replace(
      stripTypeScriptTypes(readFileSync(`apps/web/lib/${name}.ts`, "utf8"), {
        mode: "transform",
        disableExperimentalWarning: true,
      }),
    ),
  ).toString("base64");
const contracts = JSON.stringify(pathToFileURL(resolve("packages/contracts/dist/index.js")).href);
const viewing = compile("home-viewing", (source) =>
  source.replace('"@animesoul/contracts"', contracts),
);
const { newEpisodeAlerts, trackedSlugs, alertLimit } = await import(
  compile("new-episodes", (source) => source.replace('"./home-viewing"', JSON.stringify(viewing)))
);

const id = (number) => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
const item = (number, published = true) => ({
  animeId: id(number),
  anime: {
    id: id(number),
    slug: "anime-" + number,
    title: "Аниме " + number,
    poster: null,
    published,
  },
});
const progress = (animeNumber, episodeNumber, completed) => ({
  animeId: id(animeNumber),
  episodeKey: "1:" + episodeNumber,
  position: completed ? 1440 : 300,
  duration: 1440,
  watchedSeconds: 300,
  completed,
  episode: {
    id: id(animeNumber * 100 + episodeNumber),
    season: "1",
    number: String(episodeNumber),
  },
});
const episodes = (animeNumber, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: id(animeNumber * 100 + index + 1),
    animeId: id(animeNumber),
    season: "1",
    number: String(index + 1),
    duration: 1440,
  }));

test("a finished episode with a following one on the site becomes an alert", () => {
  const library = { items: [item(1)], progress: [progress(1, 3, true)] };
  const alerts = newEpisodeAlerts(library, { "anime-1": episodes(1, 5) });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].episode.number, "4");
  assert.equal(alerts[0].title, "Аниме 1");
});

test("unfinished episodes, the last episode and unpublished titles raise no alert", () => {
  assert.deepEqual(
    newEpisodeAlerts(
      {
        items: [item(1), item(2), item(3, false)],
        progress: [progress(1, 3, false), progress(2, 5, true), progress(3, 1, true)],
      },
      { "anime-1": episodes(1, 5), "anime-2": episodes(2, 5), "anime-3": episodes(3, 5) },
    ),
    [],
  );
});

test("dismissed episodes are skipped and alerts are limited", () => {
  const library = {
    items: Array.from({ length: 8 }, (_, index) => item(index + 1)),
    progress: Array.from({ length: 8 }, (_, index) => progress(index + 1, 1, true)),
  };
  const lists = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => ["anime-" + (index + 1), episodes(index + 1, 3)]),
  );
  assert.equal(newEpisodeAlerts(library, lists).length, alertLimit);
  const dismissed = new Set([id(102)]);
  const without = newEpisodeAlerts(library, lists, dismissed);
  assert.ok(without.every((alert) => alert.episode.id !== id(102)));
});

test("only titles with a finished latest episode are fetched", () => {
  const library = {
    items: [item(1), item(2)],
    progress: [progress(1, 2, false), progress(2, 4, true)],
  };
  assert.deepEqual(trackedSlugs(library), ["anime-2"]);
});
