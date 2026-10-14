import test from "node:test";
import assert from "node:assert/strict";
import { trustedEmbedUrl, playbackSourceSchema, reconcilePlayback } from "../dist/index.js";
test("playback embeds reject script, credentials, private hosts and domain lookalikes", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://kodik.info/video/1",
    "https://127.0.0.1/a",
    "https://kodik.info.evil.example/a",
    "https://evil-kodik.info/a",
    "https://user:password@kodik.info/a",
    "https://kodik.info:123/a",
    "https://example.org/",
  ])
    assert.equal(trustedEmbedUrl(url), null, url);
  assert.equal(trustedEmbedUrl("//kodik.info/seria/1"), "https://kodik.info/seria/1");
  assert.equal(
    playbackSourceSchema.safeParse({
      id: "1",
      variantId: "a".repeat(24),
      translation: "Dub",
      season: "1",
      episode: "1",
      embedUrl: "https://127.0.0.1/a",
    }).success,
    false,
  );
});

test("Updated playback removes a revoked embed and preserves an unchanged episode", () => {
  const primary = {
    id: "primary",
    variantId: "a".repeat(24),
    translation: "Studio",
    season: "1",
    episode: "1",
    embedUrl: "https://kodik.info/seria/1",
  };
  const reserve = {
    ...primary,
    id: "reserve",
    variantId: "b".repeat(24),
    embedUrl: "https://aniqit.com/seria/1",
  };
  const current = reconcilePlayback([primary], primary);
  assert.equal(current.selected, primary);
  assert.equal(current.keepPlaying, true);
  const removed = reconcilePlayback([primary], reserve);
  assert.equal(removed.selected, primary);
  assert.equal(removed.keepPlaying, false);
  assert.deepEqual(reconcilePlayback([], reserve), { selected: undefined, keepPlaying: false });
  assert.equal(
    reconcilePlayback([{ ...primary, embedUrl: "https://kodik.info/seria/2" }], primary)
      .keepPlaying,
    false,
  );
});
