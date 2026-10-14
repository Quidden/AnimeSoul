import test from "node:test";
import assert from "node:assert/strict";
import { profileMediaEditSchema } from "../packages/contracts/dist/index.js";

test("GIPHY profile values accept only IDs, never arbitrary URLs or paths", () => {
  for (const kind of ["avatar", "banner"]) {
    assert.equal(profileMediaEditSchema.safeParse({ kind, value: "giphy:AbC123" }).success, true);
    for (const value of [
      "giphy:",
      "giphy:../test",
      "giphy:abc?key=1",
      "giphy:" + "a".repeat(65),
      "https://media.giphy.com/media/abc/giphy.gif",
      "javascript:alert(1)",
    ])
      assert.equal(profileMediaEditSchema.safeParse({ kind, value }).success, false, value);
  }
});

test("GIPHY client searches anime directly, paginates, preserves URLs and deduplicates ID resolution", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const url = "https://media1.giphy.com/media/AbC123/giphy.gif?cid=original&rid=giphy.gif&ct=g";
  const gif = {
    id: "AbC123",
    title: "Anime GIF",
    images: { fixed_height: { url }, downsized_medium: { url }, fixed_width_small: { url } },
  };
  globalThis.fetch = async (input) => {
    const target = String(input);
    requests.push(target);
    if (target === "/api/profile-giphy/config") return Response.json({ apiKey: "test-web-key" });
    const request = new URL(target);
    assert.equal(request.origin, "https://api.giphy.com");
    assert.equal(request.searchParams.get("api_key"), "test-web-key");
    if (request.pathname.endsWith("search")) {
      assert.equal(request.searchParams.get("q"), "anime");
      assert.equal(request.searchParams.get("rating"), "pg-13");
      assert.equal(request.searchParams.get("offset"), "12");
      return Response.json({ data: [gif], pagination: { offset: 12, count: 1, total_count: 30 } });
    }
    return Response.json({ data: gif });
  };
  try {
    const client = await import("../apps/web/lib/profile-giphy.ts?test=client");
    const result = await client.searchAnimeGiphy(12);
    assert.equal(result.nextOffset, 13);
    assert.equal(result.items[0].id, gif.id);
    assert.equal(client.giphyRendition(gif, true), url);
    for (const invalid of [
      "http://media.giphy.com/giphy.gif",
      "https://media.giphy.com.evil.invalid/giphy.gif",
      "https://user@media.giphy.com/giphy.gif",
      "https://media.giphy.com/file.svg",
      "https://127.0.0.1/giphy.gif",
    ])
      assert.equal(client.giphyMediaUrl(invalid), null);
    const resolved = await Promise.all([
      client.getProfileGiphy(gif.id),
      client.getProfileGiphy(gif.id),
    ]);
    assert.equal(resolved[0].id, gif.id);
    assert.equal(resolved[1].id, gif.id);
    assert.equal(requests.filter((target) => target.includes("/v1/gifs/AbC123")).length, 1);
    globalThis.fetch = async () => new Response("", { status: 429 });
    await assert.rejects(client.searchAnimeGiphy(), /Лимит GIPHY/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("unconfigured GIPHY yields a useful error and can retry", async () => {
  const previousFetch = globalThis.fetch;
  let configured = false;
  globalThis.fetch = async () => Response.json({ apiKey: configured ? "test-web-key" : "" });
  try {
    const client = await import("../apps/web/lib/profile-giphy.ts?test=missing");
    await assert.rejects(client.giphyKey(), /GIPHY не настроен/);
    configured = true;
    assert.equal(await client.giphyKey(), "test-web-key");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("GIPHY search preserves a custom query across pages and rejects empty or long input", async () => {
  const previousFetch = globalThis.fetch;
  const searches = [];
  const gif = { id: "Naruto123", title: "Naruto", images: {} };
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/profile-giphy/config")
      return Response.json({ apiKey: "test-web-key" });
    const url = new URL(input);
    searches.push(url);
    return Response.json({ data: [gif], pagination: { total_count: 30 } });
  };
  try {
    const client = await import("../apps/web/lib/profile-giphy.ts?test=custom-query");
    const query = "Наруто & @anime";
    const first = await client.searchGiphy("  " + query + "  ");
    await client.searchGiphy(query, first.nextOffset);
    assert.deepEqual(
      searches.map((url) => url.searchParams.get("q")),
      [query, query],
    );
    assert.deepEqual(
      searches.map((url) => url.searchParams.get("offset")),
      ["0", "1"],
    );
    assert.ok(searches.every((url) => url.searchParams.get("rating") === "pg-13"));
    await assert.rejects(client.searchGiphy("   "), /от 1 до 50/);
    await assert.rejects(client.searchGiphy("a".repeat(51)), /от 1 до 50/);
    assert.equal(searches.length, 2);
    await client.searchGiphy("a".repeat(50));
    assert.equal(searches[2].searchParams.get("q").length, 50);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
