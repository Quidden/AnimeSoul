import test from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import {
  frameFileError,
  frameTimestamp,
  frameWatchHref,
  searchByFrame,
} from "../apps/web/lib/frame-search-client.ts";

test("client validates supported files and formats scene timestamps", () => {
  for (const extension of ["jpg", "jpeg", "png", "webp", "gif"])
    assert.equal(frameFileError(new File(["frame"], "test." + extension)), null);
  for (const file of [
    new File([], "empty.png"),
    new File(["svg"], "test.svg"),
    new File(["fake"], "test.png", { type: "text/html" }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png"),
  ])
    assert.equal(typeof frameFileError(file), "string");
  assert.equal(frameTimestamp(62.9), "1:02");
  assert.equal(frameTimestamp(3662), "1:01:02");
});

test("watch buttons open the matched episode at its timestamp or the series selector", () => {
  const episodeId = "00000000-0000-4000-8000-000000000001";
  const match = { anime: { slug: "frieren" }, timestamp: 62.9, watch: { episodeId } };
  assert.equal(frameWatchHref(match), `/anime/frieren/episodes/${episodeId}?t=62#anime-watch`);
  assert.equal(frameWatchHref({ ...match, watch: null }), "/anime/frieren#anime-watch");
  assert.equal(frameWatchHref({ ...match, anime: null }), null);
});

test("client sends binary file, supports cancellation and shows stable provider errors", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const file = new File(["frame"], "test.png", { type: "image/png" });
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/search/frame");
    assert.equal(options.body, file);
    assert.equal(options.headers["X-AnimeSoul-Request"], "1");
    assert.equal(options.headers["Content-Type"], "application/octet-stream");
    assert.equal(options.credentials, "same-origin");
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return Response.json({ provider: "trace.moe", matches: [] });
  };
  assert.deepEqual(await searchByFrame(file, controller.signal), {
    provider: "trace.moe",
    matches: [],
  });
  for (const [status, body] of [
    [429, "unavailable"],
    [413, "unavailable"],
    [503, JSON.stringify({ message: "trace.moe временно недоступен." })],
  ]) {
    globalThis.fetch = async () => new Response(body, { status });
    await assert.rejects(
      searchByFrame(file, new AbortController().signal),
      (error) => error.message.length > 10 && !error.message.includes("unavailable"),
    );
  }
  globalThis.fetch = async () => Response.json({ provider: "evil", matches: [] });
  await assert.rejects(searchByFrame(file, new AbortController().signal));
});
