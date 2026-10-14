import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFrameHistory,
  parseFrameHistory,
  appendTextHistory,
  parseTextHistory,
} from "../apps/web/lib/frame-search-history.ts";
const result = {
  provider: "trace.moe",
  matches: [
    {
      anilistId: 1,
      title: "Anime Season 2",
      season: "2",
      episode: "1",
      timestamp: 123,
      similarity: 0.95,
      isAdult: false,
      image: "https://api.trace.moe/image/temporary",
      video: "https://api.trace.moe/video/temporary",
      anime: { slug: "anime", title: "Аниме" },
    },
  ],
  quota: { total: 100, used: 1, remaining: 99 },
};
test("frame history keeps bounded results without images, clips or stale quotas", () => {
  let history = [];
  for (let i = 0; i < 25; i++)
    history = appendFrameHistory(
      history,
      { ...result, matches: [{ ...result.matches[0], timestamp: 123 + i * 2 }] },
      Date.now(),
      "history-" + i,
    );
  assert.equal(history.length, 20);
  assert.equal(history[0].id, "history-24");
  assert.equal(history[0].result.matches[0].image, null);
  assert.equal(history[0].result.matches[0].video, null);
  assert.equal(history[0].result.quota, undefined);
  const latest = appendFrameHistory(history, history[0].result, Date.now(), "latest");
  assert.equal(latest.length, 20);
  assert.equal(latest[0].id, "latest");
  assert.deepEqual(parseFrameHistory(JSON.stringify(history)), history);
  assert.deepEqual(
    appendFrameHistory([], { provider: "trace.moe", matches: [] }, Date.now(), "empty"),
    [],
  );
  assert.equal(
    parseFrameHistory(JSON.stringify([{ id: "valid", searchedAt: Date.now(), result }]))[0].result
      .matches[0].image,
    null,
  );
  assert.equal(
    parseFrameHistory(JSON.stringify([{ id: "legacy", searchedAt: Date.now(), result }]))[0].result
      .matches[0].watch,
    null,
  );
  const watch = { episodeId: "00000000-0000-4000-8000-000000000001", season: "1", episode: "1" };
  const saved = appendFrameHistory(
    [],
    { ...result, matches: [{ ...result.matches[0], watch }] },
    Date.now(),
    "watch",
  );
  assert.deepEqual(parseFrameHistory(JSON.stringify(saved))[0].result.matches[0].watch, watch);
});
test("corrupt or excessive history cannot break the page or inject a media URL", () => {
  for (const value of [
    "bad json",
    "{}",
    "x".repeat(256001),
    JSON.stringify([{ id: "bad", searchedAt: 1e300, result }]),
    JSON.stringify([
      {
        id: "bad",
        searchedAt: 1,
        result: {
          ...result,
          matches: [{ ...result.matches[0], image: "https://evil.invalid/image" }],
        },
      },
    ]),
  ])
    assert.deepEqual(parseFrameHistory(value), []);
  assert.deepEqual(parseFrameHistory(null), []);
});
test("text history deduplicates recent searches and bounds query length", () => {
  let history = [];
  for (let i = 0; i < 15; i++) history = appendTextHistory(history, "query " + i);
  assert.equal(history.length, 10);
  assert.equal(history[0], "query 14");
  history = appendTextHistory(history, "  query 10  ");
  assert.equal(history[0], "query 10");
  assert.equal(history.length, 10);
  assert.equal(appendTextHistory(history, " ").length, 10);
  assert.equal(appendTextHistory([], "x".repeat(300))[0].length, 240);
  assert.deepEqual(parseTextHistory(JSON.stringify(history)), history);
  assert.deepEqual(parseTextHistory("not json"), []);
  assert.deepEqual(parseTextHistory("x".repeat(10001)), []);
});
