import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Buffer } from "node:buffer";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/home-strip.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { episodeStrip, stripLabel, stripLimit } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const id = (number) => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
const anime = id(1);
const episodes = (count, season = "1") =>
  Array.from({ length: count }, (_, index) => ({
    id: id(100 + index),
    animeId: anime,
    season,
    number: String(index + 1),
    duration: 1440,
  }));
const progress = (index, extra = {}) => ({
  animeId: anime,
  episodeKey: `1:${index + 1}`,
  position: 720,
  duration: 1440,
  watchedSeconds: 720,
  completed: false,
  episode: { id: id(100 + index), season: "1", number: String(index + 1) },
  ...extra,
});

test("the strip marks watched episodes, the one in progress and the unreleased rest of the season", () => {
  const seen = [0, 1, 2].map((index) => progress(index, { completed: true, position: 1440 }));
  const latest = progress(3);
  const strip = episodeStrip(latest, [latest, ...seen], episodes(6), 8);
  assert.deepEqual(
    strip.map((segment) => segment.state),
    ["seen", "seen", "seen", "current", "open", "open", "upcoming", "upcoming"],
  );
  assert.equal(strip[3].percent, 50);
  assert.equal(strip[3].episodeId, id(103));
  assert.equal(strip[7].number, 8);
  assert.equal(strip[7].episodeId, undefined);
});

test("after a finished episode the following one is offered as next", () => {
  const latest = progress(1, { completed: true, position: 1440 });
  const strip = episodeStrip(latest, [latest], episodes(4));
  assert.deepEqual(
    strip.map((segment) => segment.state),
    ["open", "seen", "next", "open"],
  );
  assert.equal(strip[2].percent, 0);
});

test("the strip stays empty when the season is unknown or too long to read", () => {
  assert.deepEqual(episodeStrip(progress(0, { episode: null }), [], episodes(3)), []);
  assert.deepEqual(episodeStrip(progress(0), [], episodes(stripLimit + 1)), []);
  assert.deepEqual(episodeStrip(progress(0), [], episodes(3, "2")), []);
});

test("segment labels describe each state in Russian", () => {
  assert.equal(stripLabel({ number: 4, state: "current", percent: 49.6 }), "Серия 4 · 50%");
  assert.equal(stripLabel({ number: 9, state: "upcoming", percent: 0 }), "Серия 9 · ещё не вышла");
});

test("specials are never padded with unreleased segments", () => {
  const specials = episodes(3, "0");
  const latest = progress(1, { episode: { id: id(101), season: "0", number: "2" } });
  const strip = episodeStrip(latest, [latest], specials, 12);
  assert.equal(strip.length, 3);
  assert.ok(strip.every((segment) => segment.state !== "upcoming"));
});
