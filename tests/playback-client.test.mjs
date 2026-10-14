import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

const source = stripTypeScriptTypes(readFileSync("apps/web/lib/playback-client.ts", "utf8"), {
  mode: "transform",
  disableExperimentalWarning: true,
}).replace(
  '"@animesoul/contracts"',
  JSON.stringify(pathToFileURL(resolve("packages/contracts/dist/index.js")).href),
);
const { createPlaybackClient } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const playback = (state = "ready", revision = "a".repeat(64)) => ({
  animeId: "00000000-0000-4000-8000-000000000001",
  revision,
  state,
  sources: [],
});
const response = (value = playback(), status = 200) => Response.json(value, { status });
const noWait = async () => {};

test("episode remounts share one request and briefly reuse validated episode metadata", async () => {
  let finish,
    requests = 0,
    now = 1000;
  const client = createPlaybackClient(
    () => {
      requests++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    () => now,
    noWait,
  );
  const one = client.get("season-one"),
    two = client.get("season-one");
  assert.equal(one, two);
  assert.equal(client.peek("season-one"), undefined);
  finish(response());
  assert.deepEqual(await one, playback());
  assert.deepEqual(client.peek("season-one"), playback());
  assert.equal(client.peek("another-title"), undefined);
  assert.deepEqual(await client.get("season-one"), playback());
  assert.equal(requests, 1);
  now += 5001;
  assert.equal(client.peek("season-one"), undefined);
  const expired = client.get("season-one");
  assert.equal(requests, 2);
  finish(response());
  await expired;
});

test("temporary server, connection and provider failures retry once before showing an error", async () => {
  for (const first of [
    response({}, 503),
    new TypeError("Connection interrupted"),
    response(playback("unavailable")),
  ]) {
    let requests = 0,
      waits = 0;
    const client = createPlaybackClient(
      async () => {
        if (requests++ === 0) {
          if (first instanceof Error) throw first;
          return first;
        }
        return response();
      },
      Date.now,
      async () => {
        waits++;
      },
    );
    assert.deepEqual(await client.get("season-one"), playback());
    assert.equal(requests, 2);
    assert.equal(waits, 1);
  }
  let requests = 0;
  const failed = createPlaybackClient(
    async () => {
      requests++;
      return response({}, 503);
    },
    Date.now,
    noWait,
  );
  await assert.rejects(failed.get("season-one"), /Playback unavailable/);
  assert.equal(requests, 2);
});

test("missing titles, disabled playback and malformed data do not retry or restore another title", async () => {
  let requests = 0;
  const missing = createPlaybackClient(
    async () => {
      requests++;
      return response({}, 404);
    },
    Date.now,
    noWait,
  );
  await assert.rejects(missing.get("missing-title"));
  assert.equal(requests, 1);
  const disabled = createPlaybackClient(
    async () => response(playback("disabled")),
    Date.now,
    noWait,
  );
  assert.equal((await disabled.get("disabled-title")).state, "disabled");
  const invalid = createPlaybackClient(
    async () => response({ animeId: "invalid" }),
    Date.now,
    noWait,
  );
  await assert.rejects(invalid.get("invalid-title"));
});

test("a fresh provider policy bypasses cached metadata and a late old response cannot overwrite it", async () => {
  const finishes = [];
  const client = createPlaybackClient(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
    Date.now,
    noWait,
  );
  const old = client.get("season-one"),
    changed = client.get("season-one", true);
  finishes[1](response(playback("disabled", "b".repeat(64))));
  await changed;
  finishes[0](response());
  await old;
  assert.equal((await client.get("season-one")).state, "disabled");
  assert.equal((await client.get("season-one")).revision, "b".repeat(64));
  assert.equal(client.peek("season-one").state, "disabled");
  client.carry("season-one", playback());
  assert.equal((await client.get("season-one")).state, "disabled");
});

test("switching after a long watch carries the loaded list without querying the provider again", async () => {
  let now = 1000,
    requests = 0;
  const client = createPlaybackClient(
    async () => {
      requests++;
      return response();
    },
    () => now,
    noWait,
  );
  const loaded = await client.get("season-one");
  now += 30 * 60 * 1000;
  client.carry("season-one", loaded);
  // A route remount can initialize synchronously, before its first paint.
  assert.equal(client.peek("season-one"), loaded);
  assert.deepEqual(await client.get("season-one"), loaded);
  assert.equal(requests, 1);
});
