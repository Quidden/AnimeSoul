import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/franchise-navigation.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { franchisePartOptions, choosePlaybackSource, playbackRouteAction } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("franchise options preserve title identities and formats without inventing season numbers", () => {
  const franchise = {
    currentAnimeId: "tv-two",
    items: [
      { anime: { id: "tv-one", slug: "first-season", title: "Первая история", format: "tv" } },
      { anime: { id: "movie", slug: "film", title: "Фильм", format: "movie" } },
      { anime: { id: "ova", slug: "ova", title: "OVA", format: "ova" } },
      { anime: { id: "tv-two", slug: "second-season", title: "Продолжение", format: "tv" } },
    ],
  };
  const parts = franchisePartOptions(franchise);
  assert.deepEqual(
    parts.map((part) => part.label),
    ["TV-сериал", "Фильм", "OVA", "TV-сериал"],
  );
  assert.equal(parts[3].anime.id, "tv-two");
  assert.equal(parts[3].href, "/anime/second-season#anime-watch");
});

test("an explicit canonical episode beats a saved season, episode and dubbing", () => {
  const sources = [
    { season: "1", episode: "4", episodeId: "saved", variantId: "voice-a" },
    { season: "2", episode: "1", episodeId: "opened", variantId: "voice-b" },
    { season: "2", episode: "1", episodeId: "opened", variantId: "voice-a" },
  ];
  const saved = { season: "1", episode: "4", choice: "voice-a" };
  assert.equal(choosePlaybackSource(sources, "opened", saved), sources[2]);
  assert.equal(choosePlaybackSource(sources, undefined, saved), sources[0]);
  assert.equal(choosePlaybackSource(sources, "another-title-episode", saved), undefined);
});

test("without a saved choice the story opens before season 0 specials", () => {
  const sources = [
    { season: "0", episode: "1", episodeId: "special", variantId: "voice-a" },
    { season: "1", episode: "1", episodeId: "story", variantId: "voice-a" },
  ];
  assert.equal(choosePlaybackSource(sources, undefined, {}), sources[1]);
  assert.equal(choosePlaybackSource([sources[0]], undefined, {}), sources[0]);
});

test("route acknowledgement preserves active playback; real deep-link changes select or seek", () => {
  assert.equal(playbackRouteAction("next", "next", 100, undefined), "preserve");
  assert.equal(playbackRouteAction("next", "next", undefined, undefined), "preserve");
  assert.equal(playbackRouteAction("next", "next", 100, 100), "preserve");
  assert.equal(playbackRouteAction("next", "other", undefined, undefined), "episode");
  assert.equal(playbackRouteAction("next", "next", undefined, 0), "time");
  assert.equal(playbackRouteAction("next", "next", 100, 10), "time");
});
