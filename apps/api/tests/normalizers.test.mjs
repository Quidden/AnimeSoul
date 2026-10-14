import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeYummyAnime,
  normalizeYummyVideos,
  normalizeKodikVideos,
} from "../dist/providers/normalizers.js";
test("catalog identity stays stable when titles and provider slugs change", () => {
  const first = normalizeYummyAnime({
    anime_id: 123,
    title: "Old name",
    anime_url: "old-name",
    description: "<p>Text</p>",
    remote_ids: { shikimori_id: 456 },
    secret: "do-not-expose",
  });
  const changed = normalizeYummyAnime({ anime_id: 123, title: "New name", anime_url: "new-name" });
  assert.equal(first.anime.id, changed.anime.id);
  assert.equal(first.anime.slug, changed.anime.slug);
  assert.equal(first.anime.description, "Text");
  assert.deepEqual(first.providers, [
    { provider: "yummy", externalId: "123" },
    { provider: "shikimori", externalId: "456" },
  ]);
  assert.equal(JSON.stringify(first).includes("do-not-expose"), false);
});
test("playback normalizes episodes and translations without unsafe or empty sources", () => {
  const videos = normalizeYummyVideos({
    response: [
      {
        video_id: 1,
        number: "1",
        iframe_url: "//kodik.info/seria/1/hash",
        data: { player: "Kodik", dubbing: "Dub" },
        privateKey: "PRIVATE",
      },
      { video_id: 2, number: "2", iframe_url: "javascript:alert(1)" },
      { video_id: 3, iframe_url: "https://kodik.info/a" },
    ],
  });
  assert.equal(videos.length, 1);
  assert.equal(videos[0].episode, "1");
  assert.equal(videos[0].translation, "Dub");
  assert.equal(JSON.stringify(videos).includes("PRIVATE"), false);
  const kodik = normalizeKodikVideos({
    results: [
      {
        id: "serial-1",
        type: "anime-serial",
        translation: { title: "Dub" },
        seasons: { 2: { episodes: { 1: { link: "//kodik.info/seria/1/hash" } } } },
      },
      { id: "serial-2", type: "anime-serial", link: "//kodik.info/season/2/hash" },
      { id: "movie-1", type: "anime", link: "//kodik.info/video/3/hash" },
    ],
  });
  assert.equal(kodik.length, 2);
  assert.equal(kodik[0].season, "2");
  assert.equal(kodik[1].episode, "1");
});
