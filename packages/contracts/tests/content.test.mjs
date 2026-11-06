import test from "node:test";
import assert from "node:assert/strict";
import {
  postInputSchema,
  commentInputSchema,
  adultPreferenceSchema,
  contentQuerySchema,
  contentTagsQuerySchema,
  postListSchema,
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

test("community filters validate ranking cursors, bounded search and tag periods", () => {
  const before = new Date().toISOString(),
    beforeId = randomUUID();
  for (const sort of ["new", "discussed", "top"])
    assert.equal(
      contentQuerySchema.safeParse({
        sort,
        q: "текст",
        kind: "text",
        animeId: randomUUID(),
        pinned: "false",
      }).success,
      true,
    );
  assert.equal(
    contentQuerySchema.safeParse({ sort: "top", before, beforeId, beforeCount: "0" }).success,
    true,
  );
  assert.equal(
    contentQuerySchema.safeParse({ sort: "discussed", before, beforeId, beforeActivity: before })
      .success,
    true,
  );
  for (const input of [
    { sort: "popular" },
    { kind: "news" },
    { q: "x".repeat(201) },
    { pinned: "yes" },
    { sort: "top", before, beforeId },
    { sort: "top", before, beforeId, beforeCount: -1 },
    { sort: "discussed", before, beforeId },
    { beforeCount: 2 },
    { beforeActivity: before },
  ])
    assert.equal(contentQuerySchema.safeParse(input).success, false, JSON.stringify(input));
  assert.deepEqual(contentTagsQuerySchema.parse({}), { period: "week", limit: 16 });
  assert.equal(contentTagsQuerySchema.safeParse({ period: "year" }).success, false);
  assert.equal(contentTagsQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(postInputSchema.safeParse({ pinned: true }).success, false);
  const cursor = { before, beforeId, beforeCount: 0 };
  assert.deepEqual(postListSchema.parse({ items: [], next: cursor }).next, cursor);
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
