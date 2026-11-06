import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/community-feed.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
});
const { communityFeedUrl, communityHref } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("community pagination retains rank zero and all post filters", () => {
  const filters = {
    section: "posts",
    sort: "top",
    tag: "музыка",
    q: "OST & музыка",
    kind: "episode",
    animeId: "anime",
  };
  const url = new URL(
    communityFeedUrl(filters, {
      before: "2026-11-01T00:00:00.000Z",
      beforeId: "post",
      beforeCount: 0,
    }),
    "https://example.test",
  );
  assert.equal(url.searchParams.get("beforeCount"), "0");
  for (const [key, value] of Object.entries(filters))
    assert.equal(url.searchParams.get(key), value);
  assert.equal(url.searchParams.has("pinned"), false);
  assert.equal(
    new URL(communityFeedUrl({ section: "posts", sort: "new" }, null, false), url).searchParams.get(
      "pinned",
    ),
    "false",
  );
  const activity = "2026-11-01T00:00:00.000Z";
  assert.equal(
    new URL(
      communityFeedUrl(
        { section: "posts", sort: "discussed" },
        { before: activity, beforeId: "post", beforeActivity: activity },
      ),
      url,
    ).searchParams.get("beforeActivity"),
    activity,
  );
});

test("global discussions omit post filters and navigation preserves the chosen anime and search", () => {
  const filters = {
    section: "comments",
    sort: "top",
    tag: "музыка",
    kind: "episode",
    animeId: "anime",
    q: "поиск",
  };
  const url = new URL(communityFeedUrl(filters), "https://example.test");
  assert.equal(url.pathname, "/api/account/content/comments");
  assert.equal(url.searchParams.get("discussions"), "all");
  assert.equal(url.searchParams.get("animeId"), "anime");
  assert.equal(url.searchParams.get("q"), "поиск");
  for (const key of ["tag", "sort", "kind", "pinned"])
    assert.equal(url.searchParams.has(key), false);
  const href = new URL(communityHref(filters), url);
  assert.equal(href.searchParams.get("tab"), "comments");
  assert.equal(href.searchParams.get("q"), "поиск");
  assert.equal(href.searchParams.get("animeId"), "anime");
  for (const key of ["tag", "sort", "kind"]) assert.equal(href.searchParams.has(key), false);
});
