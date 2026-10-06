import assert from "node:assert/strict";
import { test } from "node:test";
import { giphyReference, giphySearchUrl, giphyUrl, searchGiphy } from "../src/features/account/profileMedia";

test("GIPHY search sends the exact query directly without account credentials and keeps provider URLs intact", async () => {
  const originalFetch = globalThis.fetch;
  const gif = "https://media.giphy.com/media/abc/giphy.gif?cid=provider&rid=giphy.gif";
  const preview = "https://media2.giphy.com/media/abc/200w.gif?cid=provider";
  const requestUrl = new URL(giphySearchUrl("test-key", "Frieren 日本語", 12));
  assert.equal(requestUrl.searchParams.get("q"), "Frieren 日本語");
  assert.equal(requestUrl.searchParams.get("rating"), "pg");
  assert.equal(new URL(giphySearchUrl("test-key", "")).pathname, "/v1/gifs/trending");
  globalThis.fetch = async (input, options) => {
    assert.equal(new URL(String(input)).hostname, "api.giphy.com");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.headers, undefined);
    assert.equal(options?.cache, "no-store");
    return Response.json({ data: [{ id: "abc", title: "Anime", images: { original: { url: gif }, fixed_width: { url: preview } } }], pagination: { offset: 12, count: 1, total_count: 14 } });
  };
  try {
    const result = await searchGiphy("test-key", "Frieren 日本語", 12, new AbortController().signal);
    assert.deepEqual(result.items, [{ id: "abc", title: "Anime", preview, url: gif }]);
    assert.equal(result.nextOffset, 13);
    assert.equal(giphyReference(result.items[0].id), "giphy:abc");
    assert.equal(giphyUrl(gif), gif);
  } finally { globalThis.fetch = originalFetch; }
});

test("untrusted GIF locations and traversal IDs are rejected, and rate limits have an actionable error", async () => {
  for (const url of ["http://media.giphy.com/a.gif", "https://giphy.com.evil.test/a.gif", "https://media.giphy.com@evil.test/a.gif", "javascript:alert(1)"]) assert.throws(() => giphyUrl(url));
  assert.throws(() => giphyReference("../bad"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 429 });
  try { await assert.rejects(searchGiphy("test-key", "anime", 0, new AbortController().signal), /Лимит поиска/); }
  finally { globalThis.fetch = originalFetch; }
});
