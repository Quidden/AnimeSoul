import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
async function helper(name) {
  const source = stripTypeScriptTypes(readFileSync(`apps/web/lib/${name}.ts`, "utf8"), {
    mode: "transform",
    disableExperimentalWarning: true,
  });
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}
const {
  playbackSequence,
  adjacentPlayback,
  adjacentPart,
  parsePlaybackIntent,
  consumePlaybackIntent,
} = await helper("episode-sequence");
const { videoEdgeColors } = await helper("video-ambient");
const source = (season, episode, episodeId, variantId = "voice-a", translation = "Dream Cast") => ({
  season,
  episode,
  episodeId,
  variantId,
  translation,
});

test("episode navigation crosses provider seasons numerically, without visiting alternate dubbings", () => {
  const sources = [
    source("10", "1", "last"),
    source("2", "10", "ten", "voice-b"),
    source("2", "2", "two"),
    source("2", "10", "ten"),
    source("2", "1", "one"),
  ];
  assert.deepEqual(
    playbackSequence(sources, sources[2]).map((s) => s.episodeId),
    ["one", "two", "ten", "last"],
  );
  assert.equal(adjacentPlayback(sources, sources[3], 1), sources[0]);
  assert.equal(adjacentPlayback(sources, sources[0], -1), sources[3]);
  assert.equal(adjacentPlayback(sources, sources[0], 1), undefined);
  assert.equal(adjacentPlayback(sources, source("99", "2", "unknown"), 1), undefined);
});

test("a neighboring title retains the translation when provider variant identifiers differ", () => {
  const sources = [
    source("1", "1", "one", "other", "Other"),
    source("1", "1", "one", "new-id"),
    source("1", "2", "two", "new-id"),
  ];
  const sequence = playbackSequence(sources, source("1", "25", "old", "old-id"));
  assert.equal(sequence[0], sources[1]);
  assert.equal(sequence.at(-1), sources[2]);
});
test("provider season aliases do not replay the same title before the next franchise part", () => {
  const sources = [
    source("0", "1", "zero-first", "provider-zero"),
    source("0", "25", "zero-last", "provider-zero"),
    source("1", "1", "one-first"),
    source("1", "25", "one-last"),
  ];
  assert.equal(adjacentPlayback(sources, sources[1], 1), undefined);
  assert.equal(adjacentPlayback(sources, sources[3], 1), undefined);
  assert.equal(adjacentPlayback(sources, sources[1], -1), sources[0]);
});

test("franchise boundaries respect enabled formats and actual premiere order in both directions", () => {
  const item = (id, airedAt) => ({ anime: { id, year: 2020, details: { airedAt } }, episodes: [] });
  const franchise = {
    items: [
      item("main2", "2021-01-01"),
      item("ova", "2020-06-01"),
      item("main1", "2020-01-01"),
      item("movie", "2020-09-01"),
    ],
  };
  assert.equal(adjacentPart(franchise, "main1", ["main1", "main2"], 1).anime.id, "main2");
  assert.equal(adjacentPart(franchise, "main1", ["main1", "ova", "main2"], 1).anime.id, "ova");
  assert.equal(adjacentPart(franchise, "ova", ["main1", "ova", "main2"], 1).anime.id, "main2");
  assert.equal(adjacentPart(franchise, "main2", ["main1", "ova", "main2"], -1).anime.id, "ova");
  assert.equal(adjacentPart(franchise, "main1", [], 1), undefined);
  assert.equal(adjacentPart(franchise, "main1", ["main1", "main2"], -1), undefined);
});

test("autoplay intent only restores a recent, matching canonical destination", () => {
  const intent = {
    slug: "season-two",
    episodeId: "00000000-0000-4000-8000-000000000001",
    translation: "Dream Cast",
    autoplay: true,
    direction: 1,
    createdAt: 1000,
  };
  assert.deepEqual(parsePlaybackIntent(intent, intent.slug, intent.episodeId, 2000), intent);
  assert.equal(parsePlaybackIntent(intent, "another-season", undefined, 2000), null);
  assert.equal(parsePlaybackIntent(intent, intent.slug, "another-episode", 2000), null);
  assert.equal(parsePlaybackIntent(intent, intent.slug, undefined, 31001), null);
  assert.equal(
    parsePlaybackIntent({ ...intent, direction: 100 }, intent.slug, undefined, 2000),
    null,
  );
  assert.equal(
    parsePlaybackIntent({ ...intent, createdAt: NaN }, intent.slug, undefined, 2000),
    null,
  );
  assert.equal(
    parsePlaybackIntent({ ...intent, viewportTop: -120 }, intent.slug, undefined, 2000).viewportTop,
    -120,
  );
  assert.equal(
    parsePlaybackIntent({ ...intent, viewportTop: Infinity }, intent.slug, undefined, 2000),
    null,
  );
  assert.equal(
    parsePlaybackIntent({ ...intent, viewportTop: 10001 }, intent.slug, undefined, 2000),
    null,
  );
});

test("only the destination consumes an entrance animation, exactly once across remounts", () => {
  const intent = {
    slug: "season-two",
    episodeId: "00000000-0000-4000-8000-000000000001",
    translation: "Dream Cast",
    direction: 1,
    autoplay: true,
    createdAt: 1000,
  };
  let stored = JSON.stringify(intent),
    removals = 0;
  const storage = {
    getItem: () => stored,
    removeItem: () => {
      stored = null;
      removals++;
    },
  };
  assert.equal(consumePlaybackIntent(storage, "season-one", undefined, 2000), null);
  assert.equal(removals, 0);
  assert.deepEqual(consumePlaybackIntent(storage, intent.slug, intent.episodeId, 2000), intent);
  assert.equal(consumePlaybackIntent(storage, intent.slug, intent.episodeId, 2000), null);
  assert.equal(removals, 1);
});

test("carousel handoff validates source identity and geometry across delayed route commits", () => {
  const intent = {
    slug: "season-two",
    episodeId: "00000000-0000-4000-8000-000000000001",
    fromAnimeId: "00000000-0000-4000-8000-000000000002",
    fromEpisode: "13",
    travel: 0.55,
    translation: "Dream Cast",
    direction: 1,
    autoplay: true,
    createdAt: 1000,
  };
  // Waiting for server rendering must not consume the one destination animation.
  let stored = JSON.stringify(intent);
  const storage = {
    getItem: () => stored,
    removeItem: () => {
      stored = null;
    },
  };
  assert.equal(consumePlaybackIntent(storage, "season-one", undefined, 8000), null);
  assert.deepEqual(consumePlaybackIntent(storage, intent.slug, intent.episodeId, 8000), intent);
  assert.equal(consumePlaybackIntent(storage, intent.slug, intent.episodeId, 8000), null);
  for (const invalid of [
    { travel: Infinity },
    { travel: -0.5 },
    { travel: 2 },
    { fromAnimeId: "another-title" },
    { fromEpisode: "1".repeat(33) },
  ])
    assert.equal(
      parsePlaybackIntent({ ...intent, ...invalid }, intent.slug, undefined, 8000),
      null,
    );
});

test("ambient light follows each video edge and fades to black on a black frame", () => {
  const pixels = [];
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++)
      pixels.push(...(y < 2 ? [255, 0, 0, 255] : y >= 4 ? [0, 0, 255, 255] : [0, 255, 0, 255]));
  const colors = videoEdgeColors(pixels, 6, 6);
  assert.deepEqual(colors[0], [255, 0, 0]);
  assert.deepEqual(colors[2], [0, 0, 255]);
  assert.deepEqual(colors[1], [85, 85, 85]);
  assert.deepEqual(
    videoEdgeColors(
      Array(6 * 6)
        .fill([0, 0, 0, 255])
        .flat(),
      6,
      6,
    ),
    Array(4).fill([0, 0, 0]),
  );
});
