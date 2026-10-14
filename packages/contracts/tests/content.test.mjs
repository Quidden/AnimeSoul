import test from "node:test";
import assert from "node:assert/strict";
import {
  postInputSchema,
  commentInputSchema,
  adultPreferenceSchema,
  contentQuerySchema,
} from "../dist/content.js";
import { randomUUID } from "node:crypto";
test("publications validate targets, Unicode hashtags and explicit adult consent", () => {
  const base = {
    kind: "text",
    title: "Вечерняя заметка",
    body: "Думаю о любимой музыке в аниме.",
    audience: "public",
    tags: ["Музыка", "музыка"],
    labels: [],
  };
  assert.deepEqual(postInputSchema.parse(base).tags, ["музыка"]);
  assert.equal(postInputSchema.safeParse({ ...base, authorId: randomUUID() }).success, false);
  assert.equal(
    postInputSchema.safeParse({ ...base, kind: "episode", timestamp: 125 }).success,
    false,
  );
  assert.equal(
    commentInputSchema.safeParse({
      body: "Ответ",
      labels: [],
      animeId: randomUUID(),
      postId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    adultPreferenceSchema.safeParse({ enabled: true, confirmed18: false }).success,
    false,
  );
});
test("combined discussions require one anime context and preserve pagination validation", () => {
  const animeId = randomUUID();
  assert.equal(contentQuerySchema.safeParse({ animeId, discussions: "all" }).success, true);
  for (const value of [
    { discussions: "all" },
    { animeId, discussions: "all", authorId: randomUUID() },
    { animeId, discussions: "all", episodeId: randomUUID() },
    { animeId, discussions: "all", postId: randomUUID() },
    { animeId, discussions: "all", before: new Date().toISOString() },
  ])
    assert.equal(contentQuerySchema.safeParse(value).success, false);
});
