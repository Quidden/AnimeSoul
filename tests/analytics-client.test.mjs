import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { trackPage, trackPlayerStart, trackFeature } from "../apps/web/lib/analytics-client.ts";
test("successful-playback telemetry survives rerenders, player switches, reload state and 30-minute visits", async () => {
  const previous = {
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    now: Date.now,
  };
  const sent = [];
  const store = () => {
    const values = new Map();
    return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  };
  let clock = previous.now();
  globalThis.localStorage = store();
  globalThis.sessionStorage = store();
  Date.now = () => clock;
  globalThis.fetch = async (_url, input) => {
    assert.equal(input.keepalive, true);
    assert.equal(input.signal, undefined);
    sent.push(JSON.parse(input.body));
    return { status: 201 };
  };
  try {
    const animeId = randomUUID(),
      episodeId = randomUUID(),
      episode2 = randomUUID(),
      data = { animeId, episodeId, season: "1", episode: "1", player: "kodik" };
    trackPage("/anime/example");
    trackPage("/anime/example");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, "/anime");
    assert.ok(!JSON.stringify(sent[0]).includes("example"));
    trackPlayerStart(data);
    trackPlayerStart(data);
    trackPlayerStart({ ...data, player: "native" });
    assert.equal(sent.filter((e) => e.kind === "player_start").length, 1);
    trackPlayerStart({ ...data, episodeId: episode2, episode: "2" });
    trackPlayerStart(data);
    assert.equal(sent.filter((e) => e.kind === "player_start").length, 3);
    const originalVisit = sent[0].visitId;
    clock += 31 * 60000;
    trackPage("/anime/example");
    assert.notEqual(sent.at(-1).visitId, originalVisit);
    trackFeature("search.frame");
    trackFeature("media.giphy");
    assert.equal(sent.at(-1).feature, "media.giphy");
    globalThis.sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    trackPage("/users/private-name");
    trackPage("/users/private-name");
    assert.equal(sent.filter((e) => e.path === "/users").length, 1);
    assert.ok(!JSON.stringify(sent.at(-1)).includes("private-name"));
    assert.equal(new Set(sent.map((e) => e.id)).size, sent.length);
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.localStorage = previous.localStorage;
    globalThis.sessionStorage = previous.sessionStorage;
    Date.now = previous.now;
  }
});
